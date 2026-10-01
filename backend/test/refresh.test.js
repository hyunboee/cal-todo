import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { pool } from '../src/db.js'
import { FRONTEND_ORIGIN, JWT_REFRESH_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../src/config.js'
import { truncateAll, startServer, api, getCookie } from './helpers.js'

// rt는 signup 응답에서 얻는다(로그인 리밋 회피). refresh 호출은 이 파일에서 19회(리밋 30/분)
const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())

async function signup(email = `r-${randomUUID()}@test.com`) {
  const res = await api(base, '/api/auth/signup', { method: 'POST', body: { email, password: 'password123' } })
  assert.equal(res.status, 201)
  const rt = getCookie(res, 'rt').value
  return { email, rt, fam: jwt.decode(rt).fam }
}
const cookie = (rt) => (rt === undefined ? {} : { Cookie: `rt=${rt}` })
const refresh = (rt, origin = FRONTEND_ORIGIN) =>
  api(base, '/api/auth/refresh', { method: 'POST', headers: { ...cookie(rt), ...(origin ? { Origin: origin } : {}) } })
const logout = (rt, origin = FRONTEND_ORIGIN) =>
  api(base, '/api/auth/logout', { method: 'POST', headers: { ...cookie(rt), ...(origin ? { Origin: origin } : {}) } })
const family = async (fam) =>
  (await pool.query('SELECT jti, revoked_at, replaced_by FROM refresh_tokens WHERE family_id = $1 ORDER BY created_at', [fam])).rows
const assertRefreshInvalid = (res, label) => {
  assert.equal(res.status, 401, label)
  assert.equal(res.body.error.code, 'REFRESH_INVALID', label)
}

test('BE-04 ① [P0] 갱신 응답의 새 rt ≠ 이전 값, 이전 rt로 다시 갱신 → 401(FR-37)', async () => {
  const s = await signup()
  const r1 = await refresh(s.rt)
  assert.equal(r1.status, 200)
  assert.deepEqual(Object.keys(r1.body).sort(), ['accessToken', 'expiresIn'])
  assert.equal((await api(base, '/api/me', { token: r1.body.accessToken })).status, 200)

  const next = getCookie(r1, 'rt')
  assert.notEqual(next.value, s.rt)
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/auth']) {
    assert.ok(next.raw.split(/;\s*/).includes(attr), `${attr}: ${next.raw}`)
  }
  const claims = jwt.decode(next.value)
  assert.equal(claims.fam, s.fam)
  const rows = await family(s.fam)
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].revoked_at, null)
  assert.equal(rows[0].replaced_by, claims.jti)
  assert.equal(rows[1].jti, claims.jti)

  assertRefreshInvalid(await refresh(s.rt), '이전 rt')
})

test('BE-04 ② [P0] 회전 전 토큰 재제출 → 같은 family 모든 행 revoked_at, 최신 rt도 401(FR-38, AC-BR06)', async () => {
  const s = await signup()
  const other = await signup()
  const rt1 = getCookie(await refresh(s.rt), 'rt').value
  const r2 = await refresh(rt1)
  assert.equal(r2.status, 200)
  const rt2 = getCookie(r2, 'rt').value

  assertRefreshInvalid(await refresh(s.rt), '재사용')
  const rows = await family(s.fam)
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.revoked_at !== null), JSON.stringify(rows))
  assertRefreshInvalid(await refresh(rt2), '최신 rt')
  // 다른 패밀리는 영향 없음
  assert.ok((await family(other.fam)).every((r) => r.revoked_at === null))
})

test('BE-04 ② 추가: 같은 rt 동시 갱신 2건 → 200 1건·401 1건, 패밀리 전체 폐기', async () => {
  const s = await signup()
  const results = await Promise.all([refresh(s.rt), refresh(s.rt)])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401])
  assert.ok((await family(s.fam)).every((r) => r.revoked_at !== null))
})

test('BE-04 ③ [P0] 로그아웃 후 갱신 401, 응답 쿠키 Max-Age=0(FR-39)', async () => {
  const s = await signup()
  const res = await logout(s.rt)
  assert.equal(res.status, 204)
  const c = getCookie(res, 'rt')
  assert.equal(c.value, '')
  for (const attr of ['Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/auth']) {
    assert.ok(c.raw.split(/;\s*/).includes(attr), `${attr}: ${c.raw}`)
  }
  assert.ok((await family(s.fam)).every((r) => r.revoked_at !== null))
  assertRefreshInvalid(await refresh(s.rt), '로그아웃 후')
})

test('BE-04 ③ 추가: rt 없음·무효 rt 로그아웃도 204 + Max-Age=0', async () => {
  for (const rt of [undefined, 'garbage']) {
    const res = await logout(rt)
    assert.equal(res.status, 204, String(rt))
    assert.ok(getCookie(res, 'rt').raw.includes('Max-Age=0'), String(rt))
  }
})

test('BE-04 ④ 다른 Origin·Origin 없음의 refresh·logout → 403 ORIGIN_FORBIDDEN, rt는 유효 유지', async () => {
  const s = await signup()
  for (const origin of ['https://evil.example', null]) {
    for (const call of [refresh, logout]) {
      const res = await call(s.rt, origin)
      assert.equal(res.status, 403, `${call.name} ${origin}`)
      assert.equal(res.body.error.code, 'ORIGIN_FORBIDDEN', `${call.name} ${origin}`)
    }
  }
  assert.ok((await family(s.fam)).every((r) => r.revoked_at === null))
  assert.equal((await refresh(s.rt)).status, 200)
})

test('BE-04 ⑤ 패밀리 created_at 31일 전 → 갱신 401, 29일 전은 200', async () => {
  const old = await signup()
  const recent = await signup()
  await pool.query("UPDATE refresh_tokens SET created_at = now() - interval '31 days' WHERE family_id = $1", [old.fam])
  await pool.query("UPDATE refresh_tokens SET created_at = now() - interval '29 days' WHERE family_id = $1", [recent.fam])
  assertRefreshInvalid(await refresh(old.rt), '31일')
  assert.equal((await refresh(recent.rt)).status, 200)
})

test('BE-04 추가: rt 없음·서명 오류·DB에 없는 jti·만료 행·Access 토큰 → 401 REFRESH_INVALID', async () => {
  const s = await signup()
  const forged = jwt.sign({ typ: 'refresh', jti: randomUUID(), fam: randomUUID() }, JWT_REFRESH_SECRET,
    { algorithm: 'HS256', subject: randomUUID(), issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: 60 })
  const acc = await api(base, '/api/auth/signup', { method: 'POST', body: { email: 'acc@test.com', password: 'password123' } })
  for (const [label, rt] of [['없음', undefined], ['서명 오류', 'garbage'], ['DB 없음', forged], ['Access', acc.body.accessToken]]) {
    assertRefreshInvalid(await refresh(rt), label)
  }
  await pool.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE family_id = $1", [s.fam])
  assertRefreshInvalid(await refresh(s.rt), '만료 행')
})
