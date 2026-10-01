import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { pool } from '../src/db.js'
import { truncateAll, createUser, startServer, api } from './helpers.js'

const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const KEYS = ['level', 'method', 'ms', 'reqId', 'route', 'status', 'ts', 'userId']

test('BE-01b ① 요청 로그 1줄에 reqId·status·ms, Authorization·쿠키·본문·쿼리 없음, /healthz 로그 0줄', async (t) => {
  const user = await createUser()
  const log = t.mock.method(console, 'log', () => {})

  const health = await fetch(`${base}/healthz`)
  await health.arrayBuffer()
  const me = await api(base, '/api/me?secret=SECRET_QUERY', {
    token: user.token, headers: { Cookie: 'rt=SECRET_COOKIE' },
  })
  assert.equal(me.status, 200)
  const login = await api(base, '/api/auth/login', {
    method: 'POST', body: { email: 'secret_body@test.com', password: 'SECRET_PASSWORD' },
    headers: { Cookie: 'rt=SECRET_COOKIE' },
  })
  assert.equal(login.status, 401)
  await sleep(50) // res 'finish' 이벤트 대기

  const raw = log.mock.calls.map((c) => String(c.arguments[0]))
  const lines = raw.map((s) => JSON.parse(s)).filter((l) => 'reqId' in l && 'route' in l)
  assert.equal(lines.length, 2, raw.join('\n'))
  for (const s of raw) {
    for (const secret of [user.token, 'SECRET_COOKIE', 'SECRET_QUERY', 'SECRET_PASSWORD', 'secret_body']) {
      assert.ok(!s.includes(secret), `${secret} in ${s}`)
    }
  }

  const [a, b] = lines
  for (const l of lines) {
    assert.deepEqual(Object.keys(l).sort(), KEYS)
    assert.equal(l.level, 'info')
    assert.match(l.reqId, UUID)
    assert.equal(typeof l.ms, 'number')
    assert.equal(typeof l.ts, 'string')
  }
  assert.notEqual(a.reqId, b.reqId)
  assert.deepEqual([a.method, a.route, a.status, a.userId], ['GET', '/api/me', 200, user.userId])
  assert.deepEqual([b.method, b.route, b.status, b.userId], ['POST', '/api/auth/login', 401, null])
  assert.ok(!lines.some((l) => l.route === '/healthz'))
})
