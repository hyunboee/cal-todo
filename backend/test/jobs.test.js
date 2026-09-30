import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { pool } from '../src/db.js'
import {
  releaseExpiredJobs, deleteExpiredRefreshTokens, reconcileLedger, runJob, startJobs, stopJobs,
} from '../src/jobs/index.js'
import { truncateAll, insertUser } from './helpers.js'

// startedAgo: DB now() 기준 interval 문자열
async function insertProject(userId, { type, startedAgo, regen = 0, analyze = 0 }) {
  const { rows } = await pool.query(
    `INSERT INTO projects (user_id, regen_count, analyze_count, active_job_type, active_job_started_at)
     VALUES ($1, $2, $3, $4, now() - $5::interval) RETURNING id`,
    [userId, regen, analyze, type, startedAgo])
  return rows[0].id
}
const project = async (id) => (await pool.query(
  'SELECT regen_count, analyze_count, active_job_type, active_job_started_at FROM projects WHERE id = $1', [id])).rows[0]

after(() => pool.end())
beforeEach(() => truncateAll())

test('DB-03 ① AC-BR47 5분 넘은 REGEN → regen_count - 1, active_job_type NULL, 1분 전 행 유지', async () => {
  const uid = await insertUser('j1@test.com')
  const expired = await insertProject(uid, { type: 'REGEN', startedAgo: '6 minutes', regen: 1 })
  const fresh = await insertProject(uid, { type: 'REGEN', startedAgo: '1 minute', regen: 1 })

  assert.equal(await releaseExpiredJobs(), 1)
  assert.deepEqual(await project(expired),
    { regen_count: 0, analyze_count: 0, active_job_type: null, active_job_started_at: null })
  const f = await project(fresh)
  assert.equal(f.regen_count, 1)
  assert.equal(f.active_job_type, 'REGEN')
  assert.notEqual(f.active_job_started_at, null)
})

test('DB-03 ② ANALYZE는 analyze_count 유지·표시만 해제(BR-26), GENERATE도 표시만 해제', async () => {
  const uid = await insertUser('j2@test.com')
  const analyze = await insertProject(uid, { type: 'ANALYZE', startedAgo: '6 minutes', analyze: 1 })
  const generate = await insertProject(uid, { type: 'GENERATE', startedAgo: '6 minutes', regen: 1 })

  assert.equal(await releaseExpiredJobs(), 2)
  assert.deepEqual(await project(analyze),
    { regen_count: 0, analyze_count: 1, active_job_type: null, active_job_started_at: null })
  assert.deepEqual(await project(generate),
    { regen_count: 1, analyze_count: 0, active_job_type: null, active_job_started_at: null })
})

test('DB-03 ③ job 2회 동시 실행해도 regen_count는 1만 감소', async () => {
  const uid = await insertUser('j3@test.com')
  const pid = await insertProject(uid, { type: 'REGEN', startedAgo: '6 minutes', regen: 2 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    assert.equal(await releaseExpiredJobs(client), 1)
    let settled = false
    const p2 = releaseExpiredJobs().finally(() => { settled = true })
    await sleep(200)
    assert.equal(settled, false, '두 번째 호출은 행 잠금을 기다려야 한다')
    await client.query('COMMIT')
    assert.equal(await p2, 0)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  const p = await project(pid)
  assert.equal(p.regen_count, 1)
  assert.equal(p.active_job_type, null)
})

test('DB-03 ④ 만료 refresh 행만 삭제, 유효 행·폐기됐지만 유효한 행 유지', async () => {
  const uid = await insertUser('j4@test.com')
  const insert = (hash, expires, revoked) => pool.query(
    `INSERT INTO refresh_tokens (jti, user_id, family_id, token_hash, expires_at, revoked_at)
     VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, now() + $3::interval,
             CASE WHEN $4::boolean THEN now() END)`,
    [uid, hash, expires, revoked])
  await insert('expired', '-1 minute', false)
  await insert('valid', '1 day', false)
  await insert('revoked-valid', '1 day', true)

  assert.equal(await deleteExpiredRefreshTokens(), 1)
  const { rows } = await pool.query('SELECT token_hash FROM refresh_tokens ORDER BY token_hash')
  assert.deepEqual(rows.map(r => r.token_hash), ['revoked-valid', 'valid'])
})

test('DB-03 ⑤ 잔액 ≠ 원장 합계 → error 로그 1줄(NFR-14), 정합이면 로그 0줄', async (t) => {
  const log = t.mock.method(console, 'log', () => {})
  const a = await insertUser('j5a@test.com')
  await insertUser('j5b@test.com') // 원장 없음 + 잔액 0 = 정합
  await pool.query('UPDATE credit_wallets SET topup_balance = 3 WHERE user_id = $1', [a])
  await pool.query(
    "INSERT INTO credit_ledger (user_id, delta, reason, source) VALUES ($1, 3, 'PURCHASE', 'TOPUP')", [a])

  assert.equal(await reconcileLedger(), 0)
  assert.equal(log.mock.callCount(), 0)

  await pool.query('UPDATE credit_wallets SET topup_balance = 4 WHERE user_id = $1', [a])
  assert.equal(await reconcileLedger(), 1)
  assert.equal(log.mock.callCount(), 1)
  const line = JSON.parse(log.mock.calls[0].arguments[0])
  assert.equal(typeof line.ts, 'string')
  assert.equal(line.level, 'error')
  assert.equal(line.msg, 'ledger_mismatch')
  assert.equal(line.count, 1)
})

test('DB-03 추가: runJob은 실패해도 reject하지 않고 job_failed 로그, 성공 시 로그 없음', async (t) => {
  const log = t.mock.method(console, 'log', () => {})
  async function failingJob() { throw new Error('boom') }
  async function okJob() { return 0 }

  await runJob(okJob)
  assert.equal(log.mock.callCount(), 0)

  await runJob(failingJob)
  assert.equal(log.mock.callCount(), 1)
  const line = JSON.parse(log.mock.calls[0].arguments[0])
  assert.equal(typeof line.ts, 'string')
  assert.equal(line.level, 'error')
  assert.equal(line.msg, 'job_failed')
  assert.equal(line.job, 'failingJob')
  assert.equal(line.error, 'boom')
})

test('DB-03 추가: startJobs가 시작 시 1회 실행, stopJobs 후 정상 종료', async (t) => {
  t.mock.method(console, 'log', () => {})
  const uid = await insertUser('j6@test.com')
  const pid = await insertProject(uid, { type: 'REGEN', startedAgo: '6 minutes', regen: 1 })
  try {
    await startJobs()
  } finally {
    stopJobs()
  }
  assert.equal((await project(pid)).active_job_type, null)
})
