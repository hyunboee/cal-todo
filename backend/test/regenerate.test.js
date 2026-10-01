import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { sanitizeHtml } from '../src/lib/html.js'
import { roleModels, parseModel, semaphores, createSemaphore } from '../src/llm/index.js'
import { LLM_RETRY_AFTER_SEC } from '../src/config.js'
import { truncateAll, createUser, insertProject, startServer, api } from './helpers.js'

const { base, close } = await startServer()
const original = { models: { ...roleModels }, sems: { ...semaphores } }

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())
afterEach(() => {
  Object.assign(roleModels, original.models)
  Object.assign(semaphores, original.sems)
})

// 재생성은 필수값·이미지를 다시 검사하지 않는다[가정] → 이미지 없는 GENERATED 프로젝트로 충분
const DRAFT = sanitizeHtml('<section><h2>이전 제목</h2><p>이전 본문</p></section>')
const regen = (token, id, version) => api(base, `/api/projects/${id}/regenerate`, { method: 'POST', token, body: { version } })
const generated = (userId, opts = {}) => insertProject(userId, { status: 'GENERATED', draftHtml: DRAFT, ...opts })
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const row = (id) => one('SELECT status, version, draft_html, regen_count, active_job_type, active_job_started_at FROM projects WHERE id = $1', [id])
const usageCount = async () => (await one('SELECT count(*)::int AS c FROM llm_usage_logs')).c
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
// 실패·거절 뒤: regen_count 원복, 작업 해제, draft·version 불변
async function assertRestored(id, { regenCount = 0, version = 1, status = 'GENERATED' } = {}) {
  assert.deepEqual(await row(id), {
    status, version, draft_html: DRAFT, regen_count: regenCount, active_job_type: null, active_job_started_at: null,
  })
}

test('BE-11 ① [P0] AC-BR34: 재생성 3회 성공 뒤 4번째 → 429 REGEN_LIMIT, LLM 호출 0회', async () => {
  const u = await createUser()
  const id = await generated(u.userId)
  let version = 1
  for (let i = 1; i <= 3; i++) {
    const r = await regen(u.token, id, version)
    assert.equal(r.status, 200, r.text)
    assert.equal(r.body.version, version + 1)
    assert.equal(cheerio.load(r.body.html, null, false)('[data-watermark="overlay"]').length, 1)
    assert.ok(Array.isArray(r.body.blocks))
    version = r.body.version
    assert.equal((await row(id)).regen_count, i)
  }
  assert.equal(await usageCount(), 3)

  assertError(await regen(u.token, id, version), 429, 'REGEN_LIMIT')
  assert.equal(await usageCount(), 3)
  const p = await row(id)
  assert.equal(p.regen_count, 3)
  assert.equal(p.version, version)
  assert.equal(p.active_job_type, null)
})

test('BE-11 ② [P0] BR-47: mock 실패 → 502, regen_count 원복, active_job_type NULL', async () => {
  roleModels.MAIN = parseModel('mock:fail')
  const u = await createUser()
  const id = await generated(u.userId)
  await pool.query('UPDATE projects SET regen_count = 2 WHERE id = $1', [id])
  assertError(await regen(u.token, id, 1), 502, 'UPSTREAM_FAILED')
  await assertRestored(id, { regenCount: 2 })
  assert.equal(await usageCount(), 1)
})

test('BE-11 ③ AC-BR76: 503 LLM_BUSY + Retry-After → regen_count 원복. 일일 429도 원복', async () => {
  const u = await createUser()
  const id = await generated(u.userId)

  semaphores.MAIN = createSemaphore(1, 0, 1000)
  const release = await semaphores.MAIN.acquire()
  try {
    const r = await regen(u.token, id, 1)
    assertError(r, 503, 'LLM_BUSY')
    assert.equal(r.headers.get('retry-after'), String(LLM_RETRY_AFTER_SEC))
  } finally {
    release()
  }
  await assertRestored(id)

  await pool.query(
    `INSERT INTO llm_usage_logs (user_id, role, provider, model_id, latency_ms, success)
     SELECT $1, 'MAIN', 'mock', 'ok', 1, true FROM generate_series(1, 20)`, [u.userId])
  assertError(await regen(u.token, id, 1), 429, 'DAILY_LLM_LIMIT')
  await assertRestored(id)
})

test('BE-11 ④ [P0] AC-BR39: 동시 재생성 2건 → LLM 1회, 1건 409 JOB_IN_PROGRESS', async () => {
  roleModels.MAIN = parseModel('mock:delay:300')
  const u = await createUser()
  const id = await generated(u.userId)
  const rs = await Promise.all([regen(u.token, id, 1), regen(u.token, id, 1)])
  assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.text).join('\n'))
  assertError(rs.find((r) => r.status !== 200), 409, 'JOB_IN_PROGRESS')
  assert.equal(await usageCount(), 1)
  const p = await row(id)
  assert.equal(p.regen_count, 1)
  assert.equal(p.version, 2)
  assert.equal(p.active_job_type, null)
})

test('BE-11 ⑤ BR-11: 재생성 후 DEDUCT 0건, 잔액·원장 불변', async () => {
  const u = await createUser({ balance: 1 })
  const id = await generated(u.userId)
  const ledger = async () => (await one('SELECT count(*)::int AS c FROM credit_ledger WHERE user_id = $1', [u.userId])).c
  const before = await ledger()
  assert.equal((await regen(u.token, id, 1)).status, 200)
  assert.equal((await regen(u.token, id, 2)).status, 200)
  assert.equal((await one("SELECT count(*)::int AS c FROM credit_ledger WHERE reason = 'DEDUCT'")).c, 0)
  assert.equal(await ledger(), before)
  assert.equal((await one('SELECT topup_balance FROM credit_wallets WHERE user_id = $1', [u.userId])).topup_balance, 1)
})

test('BE-11 추가: EDITING → GENERATED(BR-34, draft 교체), edit_operations 유지(E-13)', async () => {
  const u = await createUser()
  const id = await generated(u.userId, { status: 'EDITING' })
  await pool.query(
    `INSERT INTO edit_operations (project_id, type, block_id, payload) VALUES ($1, 'MANUAL', 'b1', '{"editId":"e1","text":"x"}')`, [id])
  const r = await regen(u.token, id, 1)
  assert.equal(r.status, 200, r.text)
  const p = await row(id)
  assert.equal(p.status, 'GENERATED')
  assert.notEqual(p.draft_html, DRAFT)
  assert.ok(p.draft_html.includes('핵심 특징')) // MOCK_MAIN_HTML
  assert.equal((await one('SELECT count(*)::int AS c FROM edit_operations WHERE project_id = $1', [id])).c, 1)
})

test('BE-11 추가: LLM 대기 중 version 변경 → 409, regen_count 원복·결과 폐기(FR-34)', async () => {
  roleModels.MAIN = parseModel('mock:delay:300')
  const u = await createUser()
  const id = await generated(u.userId)
  const pending = regen(u.token, id, 1)
  await sleep(150)
  const mid = await row(id)
  assert.equal(mid.active_job_type, 'REGEN')
  assert.equal(mid.regen_count, 1)
  await pool.query('UPDATE projects SET version = version + 1 WHERE id = $1', [id])
  assertError(await pending, 409, 'VERSION_CONFLICT')
  await assertRestored(id, { version: 2 })
})

test('BE-11 추가: 판정 순서·상태 오류(400, 404, 409, 403, 402) — LLM 0회, regen_count 불변', async () => {
  const u = await createUser()
  const other = await createUser()
  const id = await generated(u.userId)

  for (const body of [{}, { version: 0 }, { version: '1' }]) {
    assertError(await api(base, `/api/projects/${id}/regenerate`, { method: 'POST', token: u.token, body }), 400, 'VALIDATION_FAILED')
  }
  assertError(await regen(other.token, id, 1), 404, 'NOT_FOUND')
  assertError(await regen(u.token, 'not-a-uuid', 1), 404, 'NOT_FOUND')
  assertError(await regen(u.token, id, 2), 409, 'VERSION_CONFLICT')
  assertError(await regen(u.token, await insertProject(u.userId), 1), 409, 'INVALID_STATE') // DRAFT
  assertError(await regen(u.token, await generated(u.userId, { activeJobType: 'GENERATE' }), 1), 409, 'JOB_IN_PROGRESS')

  const published = await generated(u.userId)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [published])
  assertError(await regen(u.token, published, 1), 409, 'INVALID_STATE')

  const unverified = await createUser({ verified: false, balance: 0 })
  assertError(await regen(unverified.token, await generated(unverified.userId), 1), 403, 'EMAIL_NOT_VERIFIED')
  const poor = await createUser({ balance: 0 })
  assertError(await regen(poor.token, await generated(poor.userId), 1), 402, 'INSUFFICIENT_CREDIT')

  assert.equal(await usageCount(), 0)
  await assertRestored(id)
})
