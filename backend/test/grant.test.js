import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/db.js'
import { grantTopup } from '../src/services/credits.js'
import { runGrant } from '../scripts/grant.js'
import { truncateAll, insertUser } from './helpers.js'

const backendDir = fileURLToPath(new URL('..', import.meta.url))
const USAGE = 'usage: node scripts/grant.js <email> <n> (n: 양의 정수)'

const ledgerCount = async () => Number((await pool.query('SELECT count(*) AS c FROM credit_ledger')).rows[0].c)
const wallet = async (id) =>
  (await pool.query('SELECT subscription_balance, topup_balance FROM credit_wallets WHERE user_id = $1', [id])).rows[0]

after(() => pool.end())
beforeEach(() => truncateAll())

test('DB-02 ① 지급 후 잔액 = 원장 합계(AC-BR15), 3 + 2 두 번 지급', async (t) => {
  const log = t.mock.method(console, 'log', () => {})
  const id = await insertUser('a@test.com')

  assert.deepEqual(await grantTopup('a@test.com', 3), { userId: id, topupBalance: 3 })
  assert.equal(await runGrant(['a@test.com', '2']), 0)
  assert.ok(log.mock.calls.some(c =>
    String(c.arguments[0]).includes('granted 2 credits to a@test.com (topup_balance=5)')))

  const w = await wallet(id)
  const sum = (await pool.query('SELECT sum(delta)::int AS s FROM credit_ledger WHERE user_id = $1', [id])).rows[0].s
  assert.equal(w.topup_balance, 5)
  assert.equal(w.subscription_balance, 0)
  assert.equal(sum, 5)
})

test('DB-02 ② 원장 행 reason=PURCHASE, source=TOPUP, pg_tx_id NULL, email_verified=true', async () => {
  const id = await insertUser('b@test.com')
  await grantTopup('b@test.com', 4)
  const { rows } = await pool.query(
    'SELECT user_id, delta, reason, source, pg_tx_id, project_id FROM credit_ledger')
  assert.deepEqual(rows, [{ user_id: id, delta: 4, reason: 'PURCHASE', source: 'TOPUP', pg_tx_id: null, project_id: null }])
  const u = await pool.query('SELECT email_verified FROM users WHERE id = $1', [id])
  assert.equal(u.rows[0].email_verified, true)
})

test('DB-02 ③ 없는 이메일 → 원장·잔액 변화 0건, 종료 코드 ≠ 0(함수)', async (t) => {
  const err = t.mock.method(console, 'error', () => {})
  const other = await insertUser('other@test.com')

  assert.equal(await grantTopup('nobody@test.com', 1), null)
  assert.equal(await runGrant(['nobody@test.com', '1']), 1)
  assert.ok(err.mock.calls.some(c => String(c.arguments[0]).includes('user not found: nobody@test.com')))
  assert.equal(await ledgerCount(), 0)
  assert.deepEqual(await wallet(other), { subscription_balance: 0, topup_balance: 0 })
})

test('DB-02 ③ 없는 이메일 → 종료 코드 1(CLI)', async () => {
  const r = spawnSync(process.execPath, ['--env-file=.env.test', 'scripts/grant.js', 'nobody@test.com', '1'],
    { cwd: backendDir, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.ok(r.stderr.includes('user not found: nobody@test.com'), r.stderr)
  assert.equal(await ledgerCount(), 0)
})

test('DB-02 추가: 잘못된 인자 → 1, usage, DB 변화 0', async (t) => {
  const err = t.mock.method(console, 'error', () => {})
  const id = await insertUser('c@test.com')
  const cases = [
    ['c@test.com', '0'], ['c@test.com', '-1'], ['c@test.com', '1.5'], ['c@test.com', 'abc'],
    ['c@test.com'], [], ['', '1'], ['c@test.com', '1', 'extra'],
  ]
  for (const args of cases) {
    err.mock.resetCalls()
    assert.equal(await runGrant(args), 1, JSON.stringify(args))
    assert.ok(err.mock.calls.some(c => String(c.arguments[0]).includes(USAGE)), JSON.stringify(args))
  }
  assert.equal(await ledgerCount(), 0)
  assert.deepEqual(await wallet(id), { subscription_balance: 0, topup_balance: 0 })
})

test('DB-02 추가: 지갑 없는 사용자 → reject/1, 원장 0, email_verified false 유지', async (t) => {
  const err = t.mock.method(console, 'error', () => {})
  const id = await insertUser('d@test.com', { wallet: false })

  await assert.rejects(grantTopup('d@test.com', 1), /wallet not found/)
  assert.equal(await runGrant(['d@test.com', '1']), 1)
  assert.ok(err.mock.calls.some(c => String(c.arguments[0]).includes('grant failed: wallet not found')))
  assert.equal(await ledgerCount(), 0)
  const u = await pool.query('SELECT email_verified FROM users WHERE id = $1', [id])
  assert.equal(u.rows[0].email_verified, false)
})
