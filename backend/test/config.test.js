import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// config.js는 import 시점에 검증·throw하므로 별도 프로세스로 확인한다. DB 연결 없음(pool 미사용).
const backendDir = fileURLToPath(new URL('..', import.meta.url))
const PRINT = "const c = await import('./src/config.js'); console.log(JSON.stringify(c))"
// 실행 환경에 있으면 기본값 검사가 흔들리는 B1 키
const B1_ENV = ['NODE_ENV', 'FRONTEND_ORIGIN', 'JWT_ACCESS_TTL_SEC', 'TRUST_PROXY', 'LLM_MAIN', 'LLM_LIGHT',
  'GOOGLE_GENERATIVE_AI_API_KEY', 'ANTHROPIC_API_KEY']

function load(overrides) {
  const env = { ...process.env }
  delete env.JOB_RESERVATION_INTERVAL_MS
  delete env.JOB_DAILY_INTERVAL_MS
  delete env.PORT
  for (const k of B1_ENV) delete env[k]
  Object.assign(env, overrides)
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
  return spawnSync(process.execPath, ['--input-type=module', '-e', PRINT], { cwd: backendDir, env, encoding: 'utf8' })
}

test('config OP-01 DB_CONN_STRING 빈 값 → 종료 코드 ≠ 0', () => {
  const r = load({ DB_CONN_STRING: '' })
  assert.notEqual(r.status, 0)
  assert.ok(r.stderr.includes('DB_CONN_STRING is required'), r.stderr)
})

test('config 주기 작업 간격이 양의 정수가 아니면 종료 코드 ≠ 0', () => {
  const cases = [
    ['JOB_DAILY_INTERVAL_MS', 'abc'], ['JOB_DAILY_INTERVAL_MS', '0'],
    ['JOB_RESERVATION_INTERVAL_MS', '-1'], ['JOB_RESERVATION_INTERVAL_MS', '1.5'],
    ['JOB_RESERVATION_INTERVAL_MS', '2147483648'],
  ]
  for (const [key, value] of cases) {
    const r = load({ [key]: value })
    assert.notEqual(r.status, 0, `${key}=${value}`)
    assert.ok(r.stderr.includes(`${key} must be a positive integer`), r.stderr)
  }
})

test('config 정상 값 → 종료 코드 0, 기본값·상수 확인', () => {
  const r = load({ JOB_RESERVATION_INTERVAL_MS: '1000' })
  assert.equal(r.status, 0, r.stderr)
  const c = JSON.parse(r.stdout)
  assert.equal(c.DB_CONN_STRING, process.env.DB_CONN_STRING)
  assert.equal(c.JOB_RESERVATION_INTERVAL_MS, 1000)
  assert.equal(c.JOB_DAILY_INTERVAL_MS, 86400000)
  assert.equal(c.RESERVATION_TTL_MIN, 5)
  assert.equal(c.DB_POOL_MAX, 20)
  assert.equal(c.DB_STATEMENT_TIMEOUT_MS, 5000)
})

test('BE-01a ④ JWT_ACCESS_SECRET 31바이트 → 종료 코드 ≠ 0', () => {
  const r = load({ JWT_ACCESS_SECRET: 'a'.repeat(31) })
  assert.notEqual(r.status, 0)
  assert.ok(r.stderr.includes('JWT_ACCESS_SECRET must be at least 32 bytes'), r.stderr)
})

test('BE-01a ④ JWT_REFRESH_SECRET 누락·두 키 동일 → 종료 코드 ≠ 0', () => {
  assert.notEqual(load({ JWT_REFRESH_SECRET: undefined }).status, 0)
  const same = 'k'.repeat(32)
  const r = load({ JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same })
  assert.notEqual(r.status, 0)
  assert.ok(r.stderr.includes('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ'), r.stderr)
})

test('BE-01a PORT 범위 밖·정수 아님 → 종료 코드 ≠ 0, 미설정 → 3000', () => {
  for (const PORT of ['0', '70000', 'abc']) {
    const r = load({ PORT })
    assert.notEqual(r.status, 0, PORT)
    assert.ok(r.stderr.includes('PORT must be 1-65535'), r.stderr)
  }
  const r = load({})
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).PORT, 3000)
})

test('config B1 기본값·상수(개발: FRONTEND_ORIGIN·LLM mock 기본, TTL 900, TRUST_PROXY 0)', () => {
  const r = load({})
  assert.equal(r.status, 0, r.stderr)
  const c = JSON.parse(r.stdout)
  assert.equal(c.FRONTEND_ORIGIN, 'http://localhost:5173')
  assert.equal(c.JWT_ACCESS_TTL_SEC, 900)
  assert.equal(c.TRUST_PROXY, 0)
  assert.equal(c.LLM_MAIN, 'mock:ok')
  assert.equal(c.LLM_LIGHT, 'mock:ok')
  assert.deepEqual(
    [c.JWT_ISSUER, c.JWT_AUDIENCE, c.REFRESH_TTL_SEC, c.REFRESH_FAMILY_MAX_DAYS, c.BCRYPT_ROUNDS],
    ['cal-todo', 'cal-todo', 1209600, 30, 10])
  assert.deepEqual(
    [c.RATE_LIMIT_WINDOW_MS, c.RATE_LIMIT_GENERAL, c.RATE_LIMIT_LOGIN, c.RATE_LIMIT_REFRESH, c.JSON_BODY_LIMIT],
    [60000, 60, 10, 30, '1mb'])
  assert.equal(c.LLM_TIMEOUT_MS, 90000)
  assert.deepEqual(c.LLM_DAILY_LIMIT, { MAIN: 20, LIGHT: 50 })
  assert.deepEqual(c.LLM_CONCURRENCY, { MAIN: 20, LIGHT: 40, IMAGE: 10 })
  assert.deepEqual([c.LLM_QUEUE_MAX, c.LLM_QUEUE_WAIT_MS, c.LLM_RETRY_AFTER_SEC, c.HTML_ROOT_WIDTH_PX], [100, 30000, 10, 780])

  const set = load({ FRONTEND_ORIGIN: 'https://app.example', JWT_ACCESS_TTL_SEC: '60', TRUST_PROXY: '1',
    LLM_MAIN: 'google:gemini-x', GOOGLE_GENERATIVE_AI_API_KEY: 'k', LLM_LIGHT: 'anthropic:claude-x', ANTHROPIC_API_KEY: 'k' })
  assert.equal(set.status, 0, set.stderr)
  const s = JSON.parse(set.stdout)
  assert.deepEqual([s.FRONTEND_ORIGIN, s.JWT_ACCESS_TTL_SEC, s.TRUST_PROXY, s.LLM_MAIN, s.LLM_LIGHT],
    ['https://app.example', 60, 1, 'google:gemini-x', 'anthropic:claude-x'])
})

test('config OP-01 production에서 FRONTEND_ORIGIN·LLM_MAIN·LLM_LIGHT 누락 → 종료 코드 ≠ 0', () => {
  const prod = { NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://app.example', LLM_MAIN: 'mock:ok', LLM_LIGHT: 'mock:ok' }
  for (const key of ['FRONTEND_ORIGIN', 'LLM_MAIN', 'LLM_LIGHT']) {
    const r = load({ ...prod, [key]: undefined })
    assert.notEqual(r.status, 0, key)
    assert.ok(r.stderr.includes(key), r.stderr)
  }
})

test('config LLM_* 형식 오류·provider 키 없음, JWT_ACCESS_TTL_SEC·TRUST_PROXY 형식 오류 → 종료 코드 ≠ 0', () => {
  for (const LLM_MAIN of ['openai:gpt', 'mock', 'google:', 'mock:']) {
    const r = load({ LLM_MAIN })
    assert.notEqual(r.status, 0, LLM_MAIN)
    assert.ok(r.stderr.includes('LLM_MAIN'), r.stderr)
  }
  const g = load({ LLM_MAIN: 'google:gemini-x' })
  assert.notEqual(g.status, 0)
  assert.ok(g.stderr.includes('GOOGLE_GENERATIVE_AI_API_KEY'), g.stderr)
  const a = load({ LLM_LIGHT: 'anthropic:claude-x' })
  assert.notEqual(a.status, 0)
  assert.ok(a.stderr.includes('ANTHROPIC_API_KEY'), a.stderr)

  for (const v of ['abc', '0', '-1']) {
    const r = load({ JWT_ACCESS_TTL_SEC: v })
    assert.notEqual(r.status, 0, v)
    assert.ok(r.stderr.includes('JWT_ACCESS_TTL_SEC must be a positive integer'), r.stderr)
  }
  for (const v of ['-1', 'x', '1.5']) {
    const r = load({ TRUST_PROXY: v })
    assert.notEqual(r.status, 0, v)
    assert.ok(r.stderr.includes('TRUST_PROXY'), r.stderr)
  }
})

test('DoD .env.example에 config 환경변수 키 전부 존재', () => {
  // B1까지의 키. B3에서 S3_*·STORAGE_LOCAL_DIR·PUBLIC_IMAGE_BASE_URL 추가
  const keys = ['DB_CONN_STRING', 'JOB_RESERVATION_INTERVAL_MS', 'JOB_DAILY_INTERVAL_MS', 'NODE_ENV', 'PORT',
    'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'FRONTEND_ORIGIN', 'JWT_ACCESS_TTL_SEC', 'TRUST_PROXY',
    'LLM_MAIN', 'LLM_LIGHT', 'GOOGLE_GENERATIVE_AI_API_KEY', 'ANTHROPIC_API_KEY']
  const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const missing = keys.filter((k) => !new RegExp(`^#?\\s*${k}=`, 'm').test(text))
  assert.deepEqual(missing, [])
})
