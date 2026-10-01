import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pool } from '../src/db.js'
import { sanitizeHtml } from '../src/lib/html.js'
import { truncateAll, createUser, insertProject, startServer, api, deepKeys } from './helpers.js'

const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())

const DRAFT = sanitizeHtml('<section><h2>핵심 특징</h2><p>가볍고 강력한 흡입력</p></section><section><h3>사용 방법</h3><p>충전 후 버튼</p></section>')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const publish = (token, id, version) => api(base, `/api/projects/${id}/publish`, { method: 'POST', token, body: { version } })
const final = (token, id) => api(base, `/api/projects/${id}/final`, { token })
const generated = (userId, opts = {}) => insertProject(userId, { status: 'GENERATED', draftHtml: DRAFT, ...opts })
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const project = (id) => one('SELECT status, version, draft_html, final_html, published_at FROM projects WHERE id = $1', [id])
const balance = async (userId) => (await one('SELECT topup_balance FROM credit_wallets WHERE user_id = $1', [userId])).topup_balance
const deducts = async (id) => (await one("SELECT count(*)::int AS c FROM credit_ledger WHERE project_id = $1 AND reason = 'DEDUCT'", [id])).c
const records = async (id) => (await pool.query('SELECT final_html_hash, inject_status FROM publish_records WHERE project_id = $1', [id])).rows
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
// 실패한 퍼블리시는 아무것도 바꾸지 않는다
async function assertUnchanged(id, userId, bal, version = 1) {
  const p = await project(id)
  assert.equal(p.status, 'GENERATED')
  assert.equal(p.version, version)
  assert.equal(p.final_html, null)
  assert.equal(p.published_at, null)
  assert.equal(await balance(userId), bal)
  assert.equal(await deducts(id), 0)
}

test('BE-14a ① [P0] PRD-V-3, AC-BR13: 동시 퍼블리시 2건 → DEDUCT 1건, 잔액 −1, 두 응답 finalHtml 해시 동일', async () => {
  const u = await createUser({ balance: 2 })
  const id = await generated(u.userId)
  const [a, b] = await Promise.all([publish(u.token, id, 1), publish(u.token, id, 1)])
  assert.equal(a.status, 200, a.text)
  assert.equal(b.status, 200, b.text)
  assert.equal(typeof a.body.finalHtml, 'string')
  assert.equal(sha256(a.body.finalHtml), sha256(b.body.finalHtml))

  assert.equal(await deducts(id), 1)
  assert.equal(await balance(u.userId), 1)
  const recs = await records(id)
  assert.equal(recs.length, 1)
  assert.equal(recs[0].final_html_hash, sha256(a.body.finalHtml))
  assert.equal(recs[0].inject_status, 'PENDING')

  const p = await project(id)
  assert.equal(p.status, 'PUBLISHED')
  assert.equal(p.version, 2)
  assert.equal(p.final_html, a.body.finalHtml)
  assert.notEqual(p.published_at, null)
  const ledger = await one("SELECT user_id, delta, source FROM credit_ledger WHERE project_id = $1 AND reason = 'DEDUCT'", [id])
  assert.deepEqual(ledger, { user_id: u.userId, delta: -1, source: 'TOPUP' })
})

test('BE-14a ② [P0] AC-BR14: 잔액 0 → 402, DEDUCT 0건, 상태 불변. 미인증 → 403', async () => {
  const u = await createUser({ balance: 0 })
  const id = await generated(u.userId)
  assertError(await publish(u.token, id, 1), 402, 'INSUFFICIENT_CREDIT')
  await assertUnchanged(id, u.userId, 0)
  assert.equal((await records(id)).length, 0)

  const unverified = await createUser({ verified: false, balance: 0 })
  const id2 = await generated(unverified.userId)
  assertError(await publish(unverified.token, id2, 1), 403, 'EMAIL_NOT_VERIFIED')
  await assertUnchanged(id2, unverified.userId, 0)
})

test('BE-14a ③ 잔액 0 + version 불일치 → 402(409 아님)', async () => {
  const u = await createUser({ balance: 0 })
  const id = await generated(u.userId)
  assertError(await publish(u.token, id, 99), 402, 'INSUFFICIENT_CREDIT')
  await assertUnchanged(id, u.userId, 0)
})

test('BE-14a ④ [P0] AC-BR12: publish_records 선삽입으로 TX 중 실패 → 롤백, 잔액·상태 불변, DEDUCT 0건', async (t) => {
  t.mock.method(console, 'log', () => {}) // unhandled_error 로그 억제
  const u = await createUser({ balance: 1 })
  const id = await generated(u.userId)
  await pool.query("INSERT INTO publish_records (project_id, final_html_hash) VALUES ($1, 'x')", [id])

  assertError(await publish(u.token, id, 1), 500, 'INTERNAL')
  await assertUnchanged(id, u.userId, 1)
  assert.deepEqual((await records(id)).map((r) => r.final_html_hash), ['x'])
})

test('BE-14a ⑤ [P0] BR-13: PUBLISHED 재요청(틀린 version, 잔액 0) → 200 기존 결과, 추가 DEDUCT 0건', async () => {
  const u = await createUser({ balance: 1 })
  const id = await generated(u.userId)
  const first = await publish(u.token, id, 1)
  assert.equal(first.status, 200)
  assert.equal(await balance(u.userId), 0)

  for (const v of [99, 1, 2]) {
    const again = await publish(u.token, id, v)
    assert.equal(again.status, 200, again.text)
    assert.equal(again.body.finalHtml, first.body.finalHtml)
  }
  // 미인증으로 바뀌어도 기존 결과(자격 무관)
  await pool.query('UPDATE users SET email_verified = false WHERE id = $1', [u.userId])
  assert.equal((await publish(u.token, id, 99)).status, 200)

  assert.equal(await deducts(id), 1)
  assert.equal(await balance(u.userId), 0)
  assert.equal((await records(id)).length, 1)
  assert.equal((await project(id)).version, 2)
})

test('BE-14a ⑥ AC-BR52: 미퍼블리시 GET /final → 403 NOT_PUBLISHED. AC-BR10: 잔액 0에서 GET /final 200', async () => {
  const u = await createUser({ balance: 1 })
  const other = await createUser()
  const id = await generated(u.userId)
  assertError(await final(u.token, id), 403, 'NOT_PUBLISHED')

  const p = await publish(u.token, id, 1)
  assert.equal(await balance(u.userId), 0)
  for (let i = 0; i < 2; i++) {
    const r = await final(u.token, id)
    assert.equal(r.status, 200)
    assert.equal(r.body.finalHtml, p.body.finalHtml)
  }
  assertError(await final(other.token, id), 404, 'NOT_FOUND')
  assertError(await final(u.token, 'not-a-uuid'), 404, 'NOT_FOUND')
})

test('BE-14a ⑦ final_html에 워터마크·비공개 키 0건', async () => {
  const u = await createUser({ balance: 1 })
  const id = await generated(u.userId)
  await pool.query(
    "INSERT INTO assets (project_id, original_key, preview_key, mime, size) VALUES ($1, 'orig/x/a.png', 'prev/x/a.webp', 'image/png', 1)", [id])
  const r = await publish(u.token, id, 1)
  assert.equal(r.status, 200)
  for (const html of [r.body.finalHtml, (await project(id)).final_html]) {
    for (const s of ['data-watermark', 'PREVIEW ONLY', '무단 복제 금지', 'orig/', 'prev/']) assert.equal(html.includes(s), false, s)
    assert.ok(html.includes('핵심 특징'))
  }
})

test('BE-14a ⑧ 최종 HTML에 data-edit-id·data-block-id 0건, draft_html에는 유지', async () => {
  assert.ok(DRAFT.includes('data-block-id') && DRAFT.includes('data-edit-id'))
  const u = await createUser({ balance: 1 })
  const id = await generated(u.userId)
  const r = await publish(u.token, id, 1)
  const p = await project(id)
  for (const html of [r.body.finalHtml, p.final_html, (await final(u.token, id)).body.finalHtml]) {
    assert.equal(html.includes('data-edit-id'), false)
    assert.equal(html.includes('data-block-id'), false)
  }
  assert.equal(p.draft_html, DRAFT)
})

test('BE-14a 추가: 409 VERSION_CONFLICT·JOB_IN_PROGRESS·INVALID_STATE, 404, version 400 — 모두 차감 0', async () => {
  const u = await createUser({ balance: 1 })
  const other = await createUser({ balance: 1 })

  const id = await generated(u.userId, { version: 3 })
  assertError(await publish(u.token, id, 2), 409, 'VERSION_CONFLICT')
  assertError(await publish(other.token, id, 3), 404, 'NOT_FOUND')
  assertError(await publish(u.token, 'not-a-uuid', 1), 404, 'NOT_FOUND')
  for (const body of [{}, { version: 0 }, { version: '3' }]) {
    assertError(await api(base, `/api/projects/${id}/publish`, { method: 'POST', token: u.token, body }), 400, 'VALIDATION_FAILED')
  }
  await assertUnchanged(id, u.userId, 1, 3)

  const busy = await generated(u.userId, { activeJobType: 'REGEN' })
  assertError(await publish(u.token, busy, 1), 409, 'JOB_IN_PROGRESS')
  await assertUnchanged(busy, u.userId, 1)

  const draft = await insertProject(u.userId)
  assertError(await publish(u.token, draft, 1), 409, 'INVALID_STATE')
  assert.equal(await deducts(draft), 0)

  // EDITING은 퍼블리시 가능
  const editing = await generated(u.userId, { status: 'EDITING' })
  assert.equal((await publish(u.token, editing, 1)).status, 200)
  assert.equal(await balance(u.userId), 0)
})

test('BE-14a 추가: 퍼블리시 전 모든 응답에 draftHtml·finalHtml 키와 원본·프리뷰 키 0건', async () => {
  const u = await createUser({ balance: 0 })
  const id = await generated(u.userId)
  await pool.query(
    "INSERT INTO assets (project_id, original_key, preview_key, mime, size) VALUES ($1, 'orig/x/a.png', 'prev/x/a.webp', 'image/png', 1)", [id])

  const responses = [
    await api(base, '/api/projects', { token: u.token }),
    await api(base, `/api/projects/${id}`, { token: u.token }),
    await api(base, `/api/projects/${id}/preview`, { token: u.token }),
    await publish(u.token, id, 1), // 402
    await final(u.token, id), // 403
  ]
  for (const r of responses) {
    const keys = deepKeys(r.body)
    for (const k of ['draftHtml', 'finalHtml', 'draft_html', 'final_html', 'originalKey', 'previewKey']) assert.equal(keys.has(k), false, `${k} ${r.text}`)
    for (const s of ['orig/', 'prev/']) assert.equal(r.text.includes(s), false, s)
  }
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 402, 403])
})
