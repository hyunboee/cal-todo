import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import { pool } from '../src/db.js'
import {
  JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ISSUER, JWT_AUDIENCE, JWT_ACCESS_TTL_SEC, REFRESH_TTL_SEC,
} from '../src/config.js'
import { signAccessToken, verifyAccessToken } from '../src/services/auth.js'
import { requireAuth } from '../src/middleware/require-auth.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { grantTopup } from '../src/services/credits.js'
import { truncateAll, insertUser, createUser, startServer, api, getCookie } from './helpers.js'

// HTTP 로그인은 이 파일에서 6회(레이트 리밋 10/분, 프로세스 단위)
const { base, close } = await startServer()
const closers = [close]

after(async () => {
  for (const c of closers) await c()
  await pool.end()
})
beforeEach(() => truncateAll())

const PASSWORD = 'password123'
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const count = async (table) => (await pool.query(`SELECT count(*)::int AS c FROM ${table}`)).rows[0].c
const signup = (email, password = PASSWORD) =>
  api(base, '/api/auth/signup', { method: 'POST', body: { email, password } })
const login = (email, password = PASSWORD) =>
  api(base, '/api/auth/login', { method: 'POST', body: { email, password } })
const me = (token, headers) => api(base, '/api/me', { token, headers })

// iss·aud·typ·키·알고리즘을 바꿔 가며 Access 형태 토큰을 만든다
const sign = (sub, { typ = 'access', key = JWT_ACCESS_SECRET, algorithm = 'HS256', ...opts } = {}) =>
  jwt.sign({ typ }, key, { algorithm, subject: sub, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 60, ...opts })
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

test('BE-02a ① [P0] 만료 → TOKEN_EXPIRED, alg none·다른 키·typ(refresh·ext)·iss/aud 불일치·헤더 없음 → TOKEN_INVALID', async () => {
  const { userId } = await createUser()
  assert.equal((await me(sign(userId))).status, 200)

  const now = Math.floor(Date.now() / 1000)
  const expired = jwt.sign({ typ: 'access', exp: now - 60 }, JWT_ACCESS_SECRET,
    { algorithm: 'HS256', subject: userId, issuer: JWT_ISSUER, audience: JWT_AUDIENCE })
  const r = await me(expired)
  assert.equal(r.status, 401)
  assert.equal(r.body.error.code, 'TOKEN_EXPIRED')

  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub: userId, typ: 'access', iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: now, exp: now + 60,
  })}.`
  const invalid = {
    none,
    otherKey: sign(userId, { key: 'x'.repeat(32) }),
    hs512: sign(userId, { algorithm: 'HS512' }),
    typRefresh: sign(userId, { typ: 'refresh' }),
    refreshKey: sign(userId, { typ: 'refresh', key: JWT_REFRESH_SECRET, jwtid: randomUUID() }),
    typExt: sign(userId, { typ: 'ext' }),
    iss: sign(userId, { issuer: 'other' }),
    aud: sign(userId, { audience: 'other' }),
    garbage: 'not-a-jwt',
  }
  for (const [name, token] of Object.entries(invalid)) {
    const res = await me(token)
    assert.equal(res.status, 401, name)
    assert.equal(res.body.error.code, 'TOKEN_INVALID', name)
  }
  for (const headers of [{}, { Authorization: `Basic ${sign(userId)}` }, { Authorization: 'Bearer ' }]) {
    const res = await me(undefined, headers)
    assert.equal(res.status, 401, JSON.stringify(headers))
    assert.equal(res.body.error.code, 'TOKEN_INVALID', JSON.stringify(headers))
  }
})

test('BE-02a ① verifyAccessToken: 정상 → {userId}, 만료 TOKEN_EXPIRED, typ 불일치 TOKEN_INVALID', () => {
  const id = randomUUID()
  assert.deepEqual(verifyAccessToken(signAccessToken(id)), { userId: id })
  const now = Math.floor(Date.now() / 1000)
  const expired = jwt.sign({ typ: 'access', exp: now - 1 }, JWT_ACCESS_SECRET,
    { algorithm: 'HS256', subject: id, issuer: JWT_ISSUER, audience: JWT_AUDIENCE })
  assert.throws(() => verifyAccessToken(expired), (e) => e.status === 401 && e.code === 'TOKEN_EXPIRED')
  assert.throws(() => verifyAccessToken(sign(id, { typ: 'ext' })), (e) => e.status === 401 && e.code === 'TOKEN_INVALID')
})

test('BE-02a ② requireAuth 통과 요청에서 DB 쿼리 0회', async (t) => {
  const app = express()
  app.get('/x', requireAuth, (req, res) => res.json({ userId: req.userId }))
  app.use(errorHandler)
  const s = await startServer(app)
  closers.push(s.close)

  const id = randomUUID()
  const q = t.mock.method(pool, 'query')
  const c = t.mock.method(pool, 'connect')
  const res = await api(s.base, '/x', { token: signAccessToken(id) })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { userId: id })
  assert.equal(q.mock.callCount(), 0)
  assert.equal(c.mock.callCount(), 0)
})

test('BE-02a ③ 토큰 클레임에 이메일 인증·잔액 없음(Access = sub·typ·iss·aud·iat·exp, Refresh = +jti·fam)', async () => {
  const id = randomUUID()
  const access = jwt.decode(signAccessToken(id))
  assert.deepEqual(Object.keys(access).sort(), ['aud', 'exp', 'iat', 'iss', 'sub', 'typ'])
  assert.deepEqual([access.sub, access.typ, access.iss, access.aud], [id, 'access', JWT_ISSUER, JWT_AUDIENCE])
  assert.equal(access.exp - access.iat, JWT_ACCESS_TTL_SEC)
  assert.equal(jwt.decode(signAccessToken(id), { complete: true }).header.alg, 'HS256')

  const res = await signup('claims@test.com')
  assert.equal(res.status, 201)
  const refresh = jwt.decode(getCookie(res, 'rt').value)
  assert.deepEqual(Object.keys(refresh).sort(), ['aud', 'exp', 'fam', 'iat', 'iss', 'jti', 'sub', 'typ'])
  assert.equal(refresh.typ, 'refresh')
  assert.equal(refresh.exp - refresh.iat, REFRESH_TTL_SEC)
  assert.deepEqual(Object.keys(jwt.decode(res.body.accessToken)).sort(), ['aud', 'exp', 'iat', 'iss', 'sub', 'typ'])
})

test('BE-03a ① [P1] AC-BR05 가입 1회 → users 1행, credit_wallets 1행(잔액 0), email_verified=false', async () => {
  const res = await signup('  New@Test.com ')
  assert.equal(res.status, 201)
  assert.equal(typeof res.body.accessToken, 'string')
  assert.equal(res.body.expiresIn, JWT_ACCESS_TTL_SEC)
  assert.ok(getCookie(res, 'rt'))

  const { rows } = await pool.query('SELECT id, email, email_verified, password_hash FROM users')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].email, 'new@test.com')
  assert.equal(rows[0].email_verified, false)
  assert.ok(rows[0].password_hash && rows[0].password_hash !== PASSWORD)
  const w = await pool.query('SELECT user_id, subscription_balance, topup_balance FROM credit_wallets')
  assert.deepEqual(w.rows, [{ user_id: rows[0].id, subscription_balance: 0, topup_balance: 0 }])
  assert.equal(await count('refresh_tokens'), 1)
})

test('BE-03a ① 추가: 가입 입력 오류·중복 이메일 → 400 VALIDATION_FAILED, 행 증가 0', async () => {
  assert.equal((await signup('dup@test.com')).status, 201)
  const cases = [
    ['DUP@test.com', PASSWORD], ['not-an-email', PASSWORD], ['a@b', PASSWORD],
    [`${'a'.repeat(250)}@t.com`, PASSWORD], ['x@test.com', 'short77'], ['x@test.com', 'a'.repeat(73)],
    ['x@test.com', 12345678], [undefined, PASSWORD],
  ]
  for (const [email, password] of cases) {
    const res = await api(base, '/api/auth/signup', { method: 'POST', body: { email, password } })
    assert.equal(res.status, 400, JSON.stringify([email, password]))
    assert.equal(res.body.error.code, 'VALIDATION_FAILED', JSON.stringify([email, password]))
  }
  assert.equal(await count('users'), 1)
  assert.equal(await count('credit_wallets'), 1)
})

test('BE-03a ① 추가: 잘못된 JSON·1mb 초과 본문 → 400 VALIDATION_FAILED', async () => {
  for (const body of ['{bad json', JSON.stringify({ email: 'a@test.com', password: 'x'.repeat(1024 * 1024 + 1) })]) {
    const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, 'VALIDATION_FAILED')
  }
  assert.equal(await count('users'), 0)
})

test('BE-03a ② 틀린 비밀번호·없는 이메일·password_hash NULL → 401 INVALID_CREDENTIALS, refresh_tokens 증가 0', async () => {
  assert.equal((await signup('pw@test.com')).status, 201)
  await insertUser('oauth@test.com')
  const before = await count('refresh_tokens')

  for (const [email, password] of [['pw@test.com', 'wrong-password'], ['nobody@test.com', PASSWORD], ['oauth@test.com', PASSWORD]]) {
    const res = await login(email, password)
    assert.equal(res.status, 401, email)
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS', email)
    assert.equal(getCookie(res, 'rt'), null, email)
  }
  const bad = await login('not-an-email')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'VALIDATION_FAILED')
  assert.equal(await count('refresh_tokens'), before)
})

test('BE-03a ③ FR-36 로그인 응답 accessToken, rt 쿠키 HttpOnly·Secure·SameSite=Strict·Path=/api/auth, DB 행 +1', async () => {
  assert.equal((await signup('fr36@test.com')).status, 201)
  const before = await count('refresh_tokens')

  const res = await login('FR36@test.com')
  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['accessToken', 'expiresIn'])
  assert.equal(res.body.expiresIn, JWT_ACCESS_TTL_SEC)
  assert.equal((await me(res.body.accessToken)).status, 200)

  const rt = getCookie(res, 'rt')
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/auth', `Max-Age=${REFRESH_TTL_SEC}`]) {
    assert.ok(rt.raw.split(/;\s*/).includes(attr), `${attr}: ${rt.raw}`)
  }
  assert.equal(await count('refresh_tokens'), before + 1)
  const { rows } = await pool.query(
    `SELECT r.jti, r.family_id, r.revoked_at, r.expires_at > now() + interval '13 days' AS ttl_ok
     FROM refresh_tokens r WHERE token_hash = $1`, [sha256(rt.value)])
  assert.equal(rows.length, 1)
  const claims = jwt.decode(rt.value)
  assert.deepEqual(rows[0], { jti: claims.jti, family_id: claims.fam, revoked_at: null, ttl_ok: true })
})

test('BE-03a ④ 로그인 → /api/me 잔액 0·미인증 → DB-02 지급 후 잔액 n·emailVerified true', async (t) => {
  t.mock.method(console, 'log', () => {})
  assert.equal((await signup('day1@test.com')).status, 201)
  const { body } = await login('day1@test.com')

  const r0 = await me(body.accessToken)
  assert.equal(r0.status, 200)
  assert.deepEqual(r0.body, { email: 'day1@test.com', emailVerified: false, balance: 0 })

  await grantTopup('day1@test.com', 3)
  const r1 = await me(body.accessToken)
  assert.deepEqual(r1.body, { email: 'day1@test.com', emailVerified: true, balance: 3 })

  // balance = topup + subscription
  await pool.query("UPDATE credit_wallets SET subscription_balance = 2 WHERE user_id = (SELECT id FROM users WHERE email = 'day1@test.com')")
  assert.equal((await me(body.accessToken)).body.balance, 5)
})

test('BE-03a ④ 추가: 토큰은 유효하지만 사용자 없음 → /api/me 404', async () => {
  const res = await me(signAccessToken(randomUUID()))
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'NOT_FOUND')
})
