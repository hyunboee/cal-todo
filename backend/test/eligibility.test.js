import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../src/db.js'
import { assertEligible } from '../src/services/eligibility.js'
import { truncateAll, createUser, insertProject, startServer, api, generateViaApi, VALID_FORM } from './helpers.js'

const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())

const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && e.code === code)
const usageCount = async () => (await pool.query('SELECT count(*)::int AS c FROM llm_usage_logs')).rows[0].c

test('BE-03b ① [P1] assertEligible: 미인증 403, 인증 + 잔액 0은 402, 미인증 + 잔액 0은 403', async () => {
  const unverified = await createUser({ verified: false, balance: 1 })
  await rejects(assertEligible(unverified.userId), 403, 'EMAIL_NOT_VERIFIED')

  const empty = await createUser({ verified: true, balance: 0 })
  await rejects(assertEligible(empty.userId), 402, 'INSUFFICIENT_CREDIT')

  const both = await createUser({ verified: false, balance: 0 })
  await rejects(assertEligible(both.userId), 403, 'EMAIL_NOT_VERIFIED')
})

test('BE-03b ① 정상 통과, subscription_balance도 합산, db 인자로 받은 커넥션 사용', async () => {
  const ok = await createUser({ balance: 1 })
  await assertEligible(ok.userId)

  const sub = await createUser({ balance: 0 })
  await pool.query('UPDATE credit_wallets SET subscription_balance = 1 WHERE user_id = $1', [sub.userId])
  await assertEligible(sub.userId)

  const client = await pool.connect()
  try {
    await assertEligible(ok.userId, client)
    await rejects(assertEligible((await createUser({ balance: 0 })).userId, client), 402, 'INSUFFICIENT_CREDIT')
  } finally {
    client.release()
  }
})

test('BE-03b ② 잔액 0 사용자: 프로젝트 생성·생성 요청 402(LLM 0회)', async () => {
  const u = await createUser({ balance: 0 })
  const r = await api(base, '/api/projects', { method: 'POST', token: u.token, body: { form: VALID_FORM } })
  assert.equal(r.status, 402)
  assert.equal(r.body.error.code, 'INSUFFICIENT_CREDIT')
  assert.equal((await pool.query('SELECT count(*)::int AS c FROM projects')).rows[0].c, 0)

  const id = await insertProject(u.userId)
  const g = await generateViaApi(base, u.token, id, 1)
  assert.equal(g.status, 402)
  assert.equal(g.body.error.code, 'INSUFFICIENT_CREDIT')
  assert.equal(await usageCount(), 0)
})

test('BE-03b ② 추가: 미인증 사용자 프로젝트 생성·생성 요청 403(잔액 0이어도 403 우선)', async () => {
  const u = await createUser({ verified: false, balance: 0 })
  const r = await api(base, '/api/projects', { method: 'POST', token: u.token, body: {} })
  assert.equal(r.status, 403)
  assert.equal(r.body.error.code, 'EMAIL_NOT_VERIFIED')

  const id = await insertProject(u.userId)
  const g = await generateViaApi(base, u.token, id, 1)
  assert.equal(g.status, 403)
  assert.equal(g.body.error.code, 'EMAIL_NOT_VERIFIED')
  assert.equal(await usageCount(), 0)
})
