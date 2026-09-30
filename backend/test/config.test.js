import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// config.js는 import 시점에 검증·throw하므로 별도 프로세스로 확인한다. DB 연결 없음(pool 미사용).
const backendDir = fileURLToPath(new URL('..', import.meta.url))
const PRINT = "const c = await import('./src/config.js'); console.log(JSON.stringify(c))"

function load(overrides) {
  const env = { ...process.env }
  delete env.JOB_RESERVATION_INTERVAL_MS
  delete env.JOB_DAILY_INTERVAL_MS
  Object.assign(env, overrides)
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
