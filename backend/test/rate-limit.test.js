import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../src/db.js'
import { FRONTEND_ORIGIN, RATE_LIMIT_LOGIN, RATE_LIMIT_REFRESH, RATE_LIMIT_GENERAL } from '../src/config.js'
import { truncateAll, createUser, startServer, api } from './helpers.js'

// 리밋 저장소는 프로세스 단위다. 이 파일만 리밋을 소진한다(파일 = 별도 프로세스).
const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())

const assertLimited = (res) => {
  assert.equal(res.status, 429)
  assert.equal(res.body.error.code, 'RATE_LIMITED')
}

test('BE-02b ① 1분 안 11번째 로그인 → 429 RATE_LIMITED', async () => {
  assert.equal(RATE_LIMIT_LOGIN, 10)
  const login = () => api(base, '/api/auth/login', {
    method: 'POST', body: { email: 'nobody@test.com', password: 'password123' },
  })
  for (let i = 1; i <= 10; i++) assert.equal((await login()).status, 401, `${i}번째`)
  assertLimited(await login())
})

test('BE-02b ① 추가: 31번째 refresh → 429 RATE_LIMITED', async () => {
  assert.equal(RATE_LIMIT_REFRESH, 30)
  const refresh = () => api(base, '/api/auth/refresh', { method: 'POST', headers: { Origin: FRONTEND_ORIGIN } })
  for (let i = 1; i <= 30; i++) assert.equal((await refresh()).status, 401, `${i}번째`)
  assertLimited(await refresh())
})

test('BE-02b ① 추가: 일반 리밋은 사용자당 60/분, 61번째 429, 다른 사용자는 200', async () => {
  assert.equal(RATE_LIMIT_GENERAL, 60)
  const a = await createUser()
  const b = await createUser()
  for (let i = 1; i <= 60; i++) assert.equal((await api(base, '/api/me', { token: a.token })).status, 200, `${i}번째`)
  assertLimited(await api(base, '/api/me', { token: a.token }))
  assert.equal((await api(base, '/api/me', { token: b.token })).status, 200)
})
