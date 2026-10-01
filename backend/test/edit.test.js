import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { sanitizeHtml, extractBlocks } from '../src/lib/html.js'
import { roleModels, parseModel } from '../src/llm/index.js'
import { truncateAll, createUser, insertProject, startServer, api } from './helpers.js'

const { base, close } = await startServer()
const originalModels = { ...roleModels }

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())
afterEach(() => Object.assign(roleModels, originalModels))

// 블록 2개 × 편집 필드 2개. ID는 정제 결과에서 읽는다(값을 가정하지 않음)
const DRAFT = sanitizeHtml('<section><h2>제목</h2><p>본문</p></section><section><h3>사용</h3><p>설명</p></section>')
const [B1, B2] = extractBlocks(DRAFT)
const TARGET = { blockId: B1.blockId, editId: B1.fields[1].editId } // '본문'

const edit = (token, id, body) => api(base, `/api/projects/${id}/edits`, { method: 'POST', token, body })
const editBody = (version, text = '새 본문', target = TARGET) => ({ ...target, text, version })
const generated = (userId, opts = {}) => insertProject(userId, { status: 'GENERATED', draftHtml: DRAFT, ...opts })
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const row = (id) => one('SELECT status, version, draft_html, active_job_type FROM projects WHERE id = $1', [id])
const ops = async (id) => (await pool.query('SELECT type, block_id, payload FROM edit_operations WHERE project_id = $1', [id])).rows
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
async function assertUnchanged(id, { status = 'GENERATED', version = 1 } = {}) {
  assert.deepEqual(await row(id), { status, version, draft_html: DRAFT, active_job_type: null })
  assert.equal((await ops(id)).length, 0)
}
async function publishedProject(userId) {
  const id = await generated(userId)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [id])
  return id
}

test('BE-12 ① [P0] AC-BR48: 같은 version 편집 2건 동시 → 200 1건, 409 VERSION_CONFLICT 1건', async () => {
  const u = await createUser()
  const id = await generated(u.userId)
  const rs = await Promise.all([edit(u.token, id, editBody(1, 'A')), edit(u.token, id, editBody(1, 'B'))])
  assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.text).join('\n'))
  assertError(rs.find((r) => r.status !== 200), 409, 'VERSION_CONFLICT')

  const winner = rs.find((r) => r.status === 200)
  const p = await row(id)
  assert.equal(p.version, 2)
  assert.equal(p.status, 'EDITING')
  assert.equal(winner.body.version, 2)
  assert.equal((await ops(id)).length, 1)
  assert.deepEqual(extractBlocks(p.draft_html)[0].fields[1].text, winner.body.blocks[0].fields[1].text)
})

test('BE-12 ② [P1] AC-BR44: text에 HTML 태그 → 400, draft_html·version 불변', async () => {
  const u = await createUser()
  const id = await generated(u.userId)
  for (const text of ['<b>굵게</b>', '앞 </p> 뒤', '<img src=x onerror=alert(1)>', '<!-- 주석 -->', '<SCRIPT>alert(1)</SCRIPT>']) {
    assertError(await edit(u.token, id, editBody(1, text)), 400, 'VALIDATION_FAILED')
  }
  await assertUnchanged(id)
})

test('BE-12 ② 추가: 태그가 아닌 < & 는 텍스트로 저장(이스케이프), 빈 문자열 허용', async () => {
  const u = await createUser()
  const id = await generated(u.userId)
  const r = await edit(u.token, id, editBody(1, '1 < 2 & 3 > 0'))
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.blocks[0].fields[1].text, '1 < 2 & 3 > 0')
  const $ = cheerio.load((await row(id)).draft_html, null, false)
  assert.equal($('*').length, cheerio.load(DRAFT, null, false)('*').length) // 요소가 늘지 않음
  assert.equal($(`[data-edit-id="${TARGET.editId}"]`).first().text(), '1 < 2 & 3 > 0')

  const empty = await edit(u.token, id, editBody(2, ''))
  assert.equal(empty.status, 200, empty.text)
  assert.equal(empty.body.blocks[0].fields.find((f) => f.editId === TARGET.editId)?.text ?? '', '')
})

test('BE-12 ③ [P1] AC-BR46, BR-10: PUBLISHED 편집 → 409 INVALID_STATE(잔액 0·미인증이어도 409)', async () => {
  const poor = await createUser({ balance: 0 })
  const id = await publishedProject(poor.userId)
  assertError(await edit(poor.token, id, editBody(1)), 409, 'INVALID_STATE')

  const unverified = await createUser({ verified: false, balance: 0 })
  assertError(await edit(unverified.token, await publishedProject(unverified.userId), editBody(1)), 409, 'INVALID_STATE')

  const rich = await createUser({ balance: 5 })
  assertError(await edit(rich.token, await publishedProject(rich.userId), editBody(1)), 409, 'INVALID_STATE')
  assert.equal((await one('SELECT count(*)::int AS c FROM edit_operations')).c, 0)
})

test('BE-12 ④ AC-BR40: 지정 blockId·editId 요소의 텍스트만 변경, 다른 블록·다른 요소 동일', async () => {
  const u = await createUser()
  const id = await generated(u.userId)
  const r = await edit(u.token, id, editBody(1, '바뀐 본문'))
  assert.equal(r.status, 200, r.text)

  const draft = (await row(id)).draft_html
  assert.equal(draft, DRAFT.replace('>본문<', '>바뀐 본문<'))
  const [a, b] = extractBlocks(draft)
  assert.deepEqual(b, B2)
  assert.deepEqual(a.fields[0], B1.fields[0])
  assert.deepEqual(a.fields[1], { editId: TARGET.editId, text: '바뀐 본문' })
})

test('BE-12 ⑤ 응답 = 새 version + 프리뷰(blocks 반영), edit_operations MANUAL 1행, 없는 editId·blockId → 400', async () => {
  const u = await createUser()
  const id = await generated(u.userId)
  const r = await edit(u.token, id, editBody(1, '응답 반영'))
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.version, 2)
  assert.equal(r.body.blocks[0].fields[1].text, '응답 반영')
  assert.deepEqual(r.body.blocks[1], B2)
  const $ = cheerio.load(r.body.html, null, false)
  assert.equal($('[data-watermark="overlay"]').length, 1)
  assert.ok(r.body.html.includes('응답 반영'))
  for (const k of ['draftHtml', 'finalHtml']) assert.equal(k in r.body, false, k)

  assert.deepEqual(await ops(id), [{ type: 'MANUAL', block_id: TARGET.blockId, payload: { editId: TARGET.editId, text: '응답 반영' } }])
  const p = await row(id)
  assert.equal(p.status, 'EDITING')
  assert.equal(p.version, 2)

  // EDITING에서 이어서 편집 가능
  const again = await edit(u.token, id, editBody(2, '두 번째'))
  assert.equal(again.status, 200, again.text)
  assert.equal(again.body.version, 3)

  const before = await row(id)
  assertError(await edit(u.token, id, editBody(3, 'x', { blockId: TARGET.blockId, editId: 'nope' })), 400, 'VALIDATION_FAILED')
  assertError(await edit(u.token, id, editBody(3, 'x', { blockId: 'nope', editId: TARGET.editId })), 400, 'VALIDATION_FAILED')
  assert.deepEqual(await row(id), before)
  assert.equal((await ops(id)).length, 2)
})

test('BE-12 ⑥ FR-35: 재생성 진행 중 편집 → 409 JOB_IN_PROGRESS', async () => {
  roleModels.MAIN = parseModel('mock:delay:300')
  const u = await createUser()
  const id = await generated(u.userId)
  const pending = api(base, `/api/projects/${id}/regenerate`, { method: 'POST', token: u.token, body: { version: 1 } })
  await sleep(150)
  assert.equal((await row(id)).active_job_type, 'REGEN')
  assertError(await edit(u.token, id, editBody(1)), 409, 'JOB_IN_PROGRESS')
  assert.equal((await pending).status, 200)
  assert.equal((await ops(id)).length, 0)

  // SQL로 선점된 상태도 같다
  assertError(await edit(u.token, await generated(u.userId, { activeJobType: 'GENERATE' }), editBody(1)), 409, 'JOB_IN_PROGRESS')
})

test('BE-12 추가: 입력 검증 400(키 정확히 4개, 길이), 판정 순서 404 → 409 → 403 → 402 → 409', async () => {
  const u = await createUser()
  const other = await createUser()
  const id = await generated(u.userId)

  const bad = [
    {}, { ...TARGET, text: 'x' }, { ...editBody(1), extra: 1 }, { ...editBody(1), path: 'p' },
    editBody(1, 1), editBody(1, 'x'.repeat(2001)), { ...editBody(1), blockId: '' }, { ...editBody(1), editId: 'e'.repeat(33) },
    { ...editBody(1), blockId: 1 }, editBody(0), editBody('1'),
  ]
  for (const body of bad) assertError(await edit(u.token, id, body), 400, 'VALIDATION_FAILED')
  assert.equal((await edit(u.token, id, editBody(1, 'x'.repeat(2000)))).status, 200)

  assertError(await edit(other.token, id, editBody(2)), 404, 'NOT_FOUND')
  assertError(await edit(u.token, 'not-a-uuid', editBody(1)), 404, 'NOT_FOUND')
  assertError(await edit(u.token, id, editBody(1)), 409, 'VERSION_CONFLICT')
  assertError(await edit(u.token, await insertProject(u.userId, { draftHtml: DRAFT }), editBody(1)), 409, 'INVALID_STATE') // DRAFT

  const unverified = await createUser({ verified: false, balance: 0 })
  assertError(await edit(unverified.token, await generated(unverified.userId), editBody(1)), 403, 'EMAIL_NOT_VERIFIED')
  const poor = await createUser({ balance: 0 })
  const poorId = await generated(poor.userId)
  assertError(await edit(poor.token, poorId, editBody(1)), 402, 'INSUFFICIENT_CREDIT')
  await assertUnchanged(poorId)
})
