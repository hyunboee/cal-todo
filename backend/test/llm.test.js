import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { pool } from '../src/db.js'
import { LLM_DAILY_LIMIT, LLM_RETRY_AFTER_SEC, LLM_CONCURRENCY, LLM_QUEUE_MAX } from '../src/config.js'
import { AppError } from '../src/lib/errors.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import {
  parseModel, roleModels, resolveModel, createSemaphore, semaphores, MOCK_USPS, callRole,
} from '../src/llm/index.js'
import { truncateAll, createUser, startServer } from './helpers.js'

const backendDir = fileURLToPath(new URL('..', import.meta.url))
const original = { models: { ...roleModels }, sems: { ...semaphores } }

after(() => pool.end())
beforeEach(() => truncateAll())
afterEach(() => {
  Object.assign(roleModels, original.models)
  Object.assign(semaphores, original.sems)
})

const usage = async () => (await pool.query(
  'SELECT role, provider, model_id, success, latency_ms, user_id, project_id FROM llm_usage_logs ORDER BY created_at')).rows
const usageCount = async () => (await pool.query('SELECT count(*)::int AS c FROM llm_usage_logs')).rows[0].c
const input = { system: 'SYSTEM_SENTINEL', prompt: 'PROMPT_SENTINEL' }
const isAppError = (status, code) => (e) => e instanceof AppError && e.status === status && e.code === code
// at: SQL 시각 식. Asia/Seoul 오늘 자정 = MIDNIGHT
const MIDNIGHT = "(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')"
const insertLogs = (userId, role, n, at = 'now()') => pool.query(
  `INSERT INTO llm_usage_logs (user_id, role, provider, model_id, latency_ms, success, created_at)
   SELECT $1, $2, 'mock', 'ok', 1, true, ${at} FROM generate_series(1, $3)`, [userId, role, n])
const logLines = (log) => log.mock.calls.map((c) => String(c.arguments[0])).filter((s) => s.startsWith('{')).map((s) => JSON.parse(s))

test('BE-08a ① LLM_MAIN 값만 바꿔 google ↔ anthropic 전환(resolveModel, 실호출 없음)', () => {
  const PRINT = "const { resolveModel } = await import('./src/llm/index.js'); const m = resolveModel('MAIN'); console.log(JSON.stringify({ provider: m.provider, modelId: m.modelId }))"
  const cases = [
    ['google:gemini-test-1', 'google', 'gemini-test-1'],
    ['anthropic:claude-test-1', 'anthropic', 'claude-test-1'],
  ]
  for (const [LLM_MAIN, provider, modelId] of cases) {
    const env = { ...process.env, LLM_MAIN, GOOGLE_GENERATIVE_AI_API_KEY: 'fake', ANTHROPIC_API_KEY: 'fake' }
    delete env.NODE_ENV
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', PRINT], { cwd: backendDir, env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const m = JSON.parse(r.stdout.trim().split('\n').pop())
    assert.ok(m.provider.startsWith(provider), m.provider)
    assert.equal(m.modelId, modelId)
  }
})

test('BE-08a ① parseModel·resolveModel(mock → null)', () => {
  assert.deepEqual(parseModel('mock:delay:300'), { provider: 'mock', modelId: 'delay:300' })
  assert.deepEqual(parseModel('google:gemini-2.5-flash'), { provider: 'google', modelId: 'gemini-2.5-flash' })
  roleModels.MAIN = parseModel('mock:ok')
  assert.equal(resolveModel('MAIN'), null)
})

test('BE-08a ② services/에 provider·모델명 문자열 0건(PP-08)', () => {
  const root = fileURLToPath(new URL('../src/services/', import.meta.url))
  const found = []
  for (const f of existsSync(root) ? readdirSync(root, { recursive: true }) : []) {
    if (!f.endsWith('.js')) continue
    const m = readFileSync(root + f, 'utf8').match(/google|anthropic|gemini|claude|openai/gi)
    if (m) found.push(`${f}: ${m.join(',')}`)
  }
  assert.deepEqual(found, [])
})

test('BE-08a 추가: mock ok — MAIN은 asset 참조 img 포함 HTML, LIGHT는 MOCK_USPS JSON(프롬프트 미반복)', async () => {
  const { userId } = await createUser()
  const a = randomUUID()
  const main = await callRole('MAIN', { system: 's', prompt: `이미지 asset:${a} 와 asset:${a}` }, { userId })
  assert.equal(typeof main.text, 'string')
  assert.equal(main.text.split(`<img src="asset:${a}"`).length - 1, 1, '중복 제거')
  assert.ok(main.text.includes('<section'))

  const light = await callRole('LIGHT', input, { userId })
  assert.deepEqual(JSON.parse(light.text), MOCK_USPS)
  assert.ok(!light.text.includes('PROMPT_SENTINEL'))

  const rows = await usage()
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => [r.role, r.provider, r.model_id, r.success, r.user_id, r.project_id]),
    [['MAIN', 'mock', 'ok', true, userId, null], ['LIGHT', 'mock', 'ok', true, userId, null]])
  assert.ok(rows.every((r) => Number.isInteger(r.latency_ms) && r.latency_ms >= 0))
})

test('BE-08a 추가: mock fail → 502 UPSTREAM_FAILED, delay → 성공, 타임아웃 → 502', async (t) => {
  const { userId } = await createUser()
  roleModels.MAIN = parseModel('mock:fail')
  await assert.rejects(callRole('MAIN', input, { userId }), isAppError(502, 'UPSTREAM_FAILED'))

  roleModels.MAIN = parseModel('mock:delay:20')
  assert.equal(typeof (await callRole('MAIN', input, { userId })).text, 'string')

  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort())
  roleModels.MAIN = parseModel('mock:delay:10000')
  const started = Date.now()
  await assert.rejects(callRole('MAIN', input, { userId }), isAppError(502, 'UPSTREAM_FAILED'))
  assert.ok(Date.now() - started < 5000, 'abort를 존중해야 한다')

  assert.deepEqual((await usage()).map((r) => [r.model_id, r.success]),
    [['fail', false], ['delay:20', true], ['delay:10000', false]])
})

test('BE-08a 추가: 실제 provider 경로 + API 키 없음 → 502, usage 1행 success=false(외부 호출 없음)', async () => {
  const { userId } = await createUser()
  const saved = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  try {
    roleModels.MAIN = { provider: 'google', modelId: 'x' }
    await assert.rejects(callRole('MAIN', input, { userId }), isAppError(502, 'UPSTREAM_FAILED'))
  } finally {
    if (saved !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = saved
  }
  assert.deepEqual((await usage()).map((r) => [r.role, r.provider, r.model_id, r.success]), [['MAIN', 'google', 'x', false]])
})

test('BE-08b ① [P1] AC-BR75 오늘 MAIN 20행 → 21번째 429 DAILY_LLM_LIMIT, 호출 0(행 20 유지), LIGHT는 통과', async (t) => {
  assert.equal(LLM_DAILY_LIMIT.MAIN, 20)
  const log = t.mock.method(console, 'log', () => {})
  const { userId } = await createUser()
  const other = await createUser()
  await insertLogs(userId, 'MAIN', 20)

  await assert.rejects(callRole('MAIN', input, { userId }), isAppError(429, 'DAILY_LLM_LIMIT'))
  assert.equal(await usageCount(), 20)
  const rejected = logLines(log).find((l) => l.msg === 'llm_rejected')
  assert.equal(rejected.level, 'warn')
  assert.equal(rejected.code, 'DAILY_LLM_LIMIT')
  assert.equal(rejected.role, 'MAIN')
  assert.equal(rejected.userId, userId)

  await callRole('LIGHT', input, { userId })
  await callRole('MAIN', input, { userId: other.userId })
  assert.equal(await usageCount(), 22)
})

test('BE-08b ② [P1] FR-28 성공·실패 섞어 N회 → llm_usage_logs N행, llm_call 로그에 입출력 없음', async (t) => {
  const log = t.mock.method(console, 'log', () => {})
  const { userId } = await createUser()
  const plan = [['MAIN', 'mock:ok'], ['MAIN', 'mock:fail'], ['LIGHT', 'mock:ok'], ['LIGHT', 'mock:fail'], ['MAIN', 'mock:delay:5']]
  for (const [role, model] of plan) {
    roleModels[role] = parseModel(model)
    await callRole(role, input, { userId }).catch((e) => assert.equal(e.code, 'UPSTREAM_FAILED'))
  }
  const rows = await usage()
  assert.equal(rows.length, plan.length)
  assert.deepEqual(rows.map((r) => [r.role, r.success]),
    [['MAIN', true], ['MAIN', false], ['LIGHT', true], ['LIGHT', false], ['MAIN', true]])

  const calls = logLines(log).filter((l) => l.msg === 'llm_call')
  assert.equal(calls.length, plan.length)
  for (const l of calls) {
    for (const k of ['ts', 'level', 'userId', 'projectId', 'role', 'provider', 'model', 'ms', 'success', 'queue', 'active']) {
      assert.ok(k in l, `${k}: ${JSON.stringify(l)}`)
    }
    assert.equal(l.level, l.success ? 'info' : 'error')
    if (!l.success) assert.equal(typeof l.error, 'string')
  }
  const all = log.mock.calls.map((c) => String(c.arguments[0])).join('\n')
  assert.ok(!all.includes('PROMPT_SENTINEL') && !all.includes('SYSTEM_SENTINEL') && !all.includes('가벼운 무게'))
})

test('BE-08b ③ [P1] DEC-10 전날(Asia/Seoul) 23:59 로그 제외, 당일 0:00 이후만 상한 포함', async () => {
  const { userId } = await createUser()
  await insertLogs(userId, 'MAIN', 19, `${MIDNIGHT} - interval '1 minute'`)
  await insertLogs(userId, 'MAIN', 19, MIDNIGHT)
  await callRole('MAIN', input, { userId }) // 오늘 19 → 통과, 20행
  await assert.rejects(callRole('MAIN', input, { userId }), isAppError(429, 'DAILY_LLM_LIMIT'))
  assert.equal(await usageCount(), 39)
})

test('BE-08b ④ [P1] AC-BR76 MAIN 20 실행 + 대기열 100 → 121번째 503 LLM_BUSY + retryAfter, usage 0행', async (t) => {
  assert.equal(LLM_CONCURRENCY.MAIN, 20)
  assert.equal(LLM_QUEUE_MAX, 100)
  const log = t.mock.method(console, 'log', () => {})
  const { userId } = await createUser()
  const sem = semaphores.MAIN
  const held = []
  for (let i = 0; i < 20; i++) held.push(await sem.acquire())
  const waiting = Array.from({ length: 100 }, () => sem.acquire())
  try {
    assert.equal(sem.active, 20)
    assert.equal(sem.queued, 100)
    await assert.rejects(callRole('MAIN', input, { userId }),
      (e) => isAppError(503, 'LLM_BUSY')(e) && e.retryAfter === LLM_RETRY_AFTER_SEC)
    await assert.rejects(sem.acquire(), isAppError(503, 'LLM_BUSY'))
    assert.equal(await usageCount(), 0)
    const rejected = logLines(log).find((l) => l.msg === 'llm_rejected')
    assert.equal(rejected.code, 'LLM_BUSY')
    assert.equal(rejected.queue, 100)
  } finally {
    for (const release of held) release()
    for (const p of waiting) (await p)()
  }
  assert.equal(sem.active, 0)
  assert.equal(sem.queued, 0)
})

test('BE-08b ④ 추가: 대기 시간 초과·대기열 초과 → 503, 해제 시 다음 대기자에게 넘김', async () => {
  const s = createSemaphore(1, 1, 50)
  const r1 = await s.acquire()
  const p2 = s.acquire()
  await assert.rejects(s.acquire(), (e) => isAppError(503, 'LLM_BUSY')(e) && e.retryAfter === LLM_RETRY_AFTER_SEC)
  await assert.rejects(p2, (e) => isAppError(503, 'LLM_BUSY')(e) && e.retryAfter === LLM_RETRY_AFTER_SEC)
  assert.equal(s.queued, 0)
  r1()
  ;(await s.acquire())()

  const h = createSemaphore(1, 10, 1000)
  const first = await h.acquire()
  const next = h.acquire()
  assert.equal(h.queued, 1)
  first()
  const second = await next
  assert.equal(h.active, 1)
  second()
  assert.equal(h.active, 0)
})

test('BE-08b ④ 추가: callRole이 세마포어 점유 시 503(createSemaphore(1,0) 교체)', async () => {
  const { userId } = await createUser()
  semaphores.MAIN = createSemaphore(1, 0, 1000)
  const release = await semaphores.MAIN.acquire()
  try {
    await assert.rejects(callRole('MAIN', input, { userId }), isAppError(503, 'LLM_BUSY'))
  } finally {
    release()
  }
  assert.equal(await usageCount(), 0)
})

test('BE-08b ④ 추가: errorHandler가 err.retryAfter를 Retry-After 헤더로', async () => {
  const app = express()
  app.get('/busy', () => {
    const e = new AppError(503, 'LLM_BUSY')
    e.retryAfter = LLM_RETRY_AFTER_SEC
    throw e
  })
  app.use(errorHandler)
  const { base, close } = await startServer(app)
  try {
    const res = await fetch(`${base}/busy`)
    assert.equal(res.status, 503)
    assert.equal(res.headers.get('retry-after'), String(LLM_RETRY_AFTER_SEC))
    assert.equal((await res.json()).error.code, 'LLM_BUSY')
  } finally {
    await close()
  }
})
