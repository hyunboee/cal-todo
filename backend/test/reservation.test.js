import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { pool } from '../src/db.js'
import { roleModels, parseModel, semaphores, createSemaphore } from '../src/llm/index.js'
import { releaseExpiredJobs } from '../src/jobs/index.js'
import { truncateAll, createUser, insertProject, startServer, generateViaApi, makeImage, upload, clearStorage } from './helpers.js'

const { base, close } = await startServer()
const original = { models: { ...roleModels }, sems: { ...semaphores } }
const PNG = await makeImage()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})
afterEach(() => {
  Object.assign(roleModels, original.models)
  Object.assign(semaphores, original.sems)
})

const row = async (id) => (await pool.query(
  'SELECT status, version, draft_html, active_job_type, active_job_started_at FROM projects WHERE id = $1', [id])).rows[0]
const usageCount = async () => (await pool.query('SELECT count(*)::int AS c FROM llm_usage_logs')).rows[0].c
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
// 실패·거절 뒤: 작업 해제, status·version·draft 불변
async function assertReleased(id, { status = 'DRAFT', version = 1 } = {}) {
  assert.deepEqual(await row(id), { status, version, draft_html: null, active_job_type: null, active_job_started_at: null })
}
async function ready(u) {
  const id = await insertProject(u.userId)
  assert.equal((await upload(base, u.token, id, PNG)).status, 201)
  return id
}

test('BE-09b ① [P0] AC-BR39: 동시 생성 2건 → LLM 1회, 나머지 409 JOB_IN_PROGRESS', async () => {
  roleModels.MAIN = parseModel('mock:delay:300')
  const u = await createUser()
  const id = await ready(u)
  const rs = await Promise.all([generateViaApi(base, u.token, id, 1), generateViaApi(base, u.token, id, 1)])
  const ok = rs.filter((r) => r.status === 200)
  const rejected = rs.filter((r) => r.status !== 200)
  assert.equal(ok.length, 1, rs.map((r) => r.text).join('\n'))
  assertError(rejected[0], 409, 'JOB_IN_PROGRESS')
  assert.equal(await usageCount(), 1)

  const p = await row(id)
  assert.equal(p.status, 'GENERATED')
  assert.equal(p.version, 2)
  assert.equal(p.active_job_type, null)
  assert.equal(p.active_job_started_at, null)
})

test('BE-09b ② AC-BR35: 이미지 0장 → 400, LLM 호출 0회, 상태 불변', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  assertError(await generateViaApi(base, u.token, id, 1), 400, 'VALIDATION_FAILED')
  await assertReleased(id)
  assert.equal(await usageCount(), 0)
})

test('BE-09b ③ 502·503·일일 429 → active_job_type NULL, status·version 불변, 이후 재시도 가능', async () => {
  const u = await createUser()
  const id = await ready(u)

  roleModels.MAIN = parseModel('mock:fail')
  assertError(await generateViaApi(base, u.token, id, 1), 502, 'UPSTREAM_FAILED')
  await assertReleased(id)

  roleModels.MAIN = parseModel('mock:ok')
  semaphores.MAIN = createSemaphore(1, 0, 1000)
  const release = await semaphores.MAIN.acquire()
  try {
    assertError(await generateViaApi(base, u.token, id, 1), 503, 'LLM_BUSY')
  } finally {
    release()
  }
  await assertReleased(id)

  // 실패 1행 + 오늘 MAIN 19행 = 20 → 일일 상한
  await pool.query(
    `INSERT INTO llm_usage_logs (user_id, role, provider, model_id, latency_ms, success)
     SELECT $1, 'MAIN', 'mock', 'ok', 1, true FROM generate_series(1, 19)`, [u.userId])
  assertError(await generateViaApi(base, u.token, id, 1), 429, 'DAILY_LLM_LIMIT')
  await assertReleased(id)

  await pool.query('DELETE FROM llm_usage_logs')
  assert.equal((await generateViaApi(base, u.token, id, 1)).status, 200)
})

test('BE-09b ④ FR-34: LLM 대기 중 version 변경 → 409, 결과 폐기·작업 해제', async () => {
  roleModels.MAIN = parseModel('mock:delay:300')
  const u = await createUser()
  const id = await ready(u)
  const pending = generateViaApi(base, u.token, id, 1)
  await sleep(150)
  assert.equal((await row(id)).active_job_type, 'GENERATE') // 실제 선점
  await pool.query('UPDATE projects SET version = version + 1 WHERE id = $1', [id])

  assertError(await pending, 409, 'VERSION_CONFLICT')
  await assertReleased(id, { version: 2 })
  assert.equal(await usageCount(), 1)
})

test('BE-09b ⑤ 통합 확인: 실제 선점이 D-30 경과 후 releaseExpiredJobs로 해제, 늦은 결과는 폐기', async () => {
  roleModels.MAIN = parseModel('mock:delay:500')
  const u = await createUser()
  const id = await ready(u)
  const pending = generateViaApi(base, u.token, id, 1)
  await sleep(150)
  const p = await row(id)
  assert.equal(p.active_job_type, 'GENERATE')
  assert.notEqual(p.active_job_started_at, null)

  await pool.query("UPDATE projects SET active_job_started_at = now() - interval '6 minutes' WHERE id = $1", [id])
  assert.equal(await releaseExpiredJobs(), 1)
  await assertReleased(id)

  assertError(await pending, 409, 'VERSION_CONFLICT')
  await assertReleased(id)
})
