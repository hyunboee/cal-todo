import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { pool } from '../src/db.js'
import { createApp } from '../src/app.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { AppError } from '../src/lib/errors.js'

const servers = []
async function listen(app) {
  const server = app.listen(0)
  await once(server, 'listening')
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r))
  await pool.end()
})

const base = await listen(createApp())

test('BE-01a ③ app.listen(0) /healthz 200 {status:ok}', async () => {
  const res = await fetch(`${base}/healthz`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'ok' })
})

test('BE-01a ③ DB 중단 시 /healthz 503 {status:unavailable}', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('down') })
  const res = await fetch(`${base}/healthz`)
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { status: 'unavailable' })
})

test('BE-01a ⑤ 없는 경로 404 {error:{code:NOT_FOUND}}', async () => {
  const res = await fetch(`${base}/nope`)
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.equal(body.error.code, 'NOT_FOUND')
  assert.equal(typeof body.error.message, 'string')
})

test('BE-01a ⑤ 처리되지 않은 오류 500 INTERNAL(스택·원래 메시지 미노출), AppError는 status·code 그대로', async (t) => {
  const app = express()
  app.get('/boom', () => { throw new Error('secret detail') })
  app.get('/conflict', () => { throw new AppError(409, 'VERSION_CONFLICT') })
  app.use(errorHandler)
  const url = await listen(app)
  const log = t.mock.method(console, 'log', () => {})

  const res = await fetch(`${url}/boom`)
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.deepEqual(JSON.parse(text), { error: { code: 'INTERNAL', message: 'Internal Server Error' } })
  assert.ok(!text.includes('secret detail') && !text.includes('at '), text)

  assert.equal(log.mock.callCount(), 1)
  const line = JSON.parse(log.mock.calls[0].arguments[0])
  assert.equal(line.level, 'error')
  assert.equal(line.msg, 'unhandled_error')
  assert.equal(line.error, 'secret detail')
  assert.equal(line.stack, undefined)

  const c = await fetch(`${url}/conflict`)
  assert.equal(c.status, 409)
  assert.deepEqual(await c.json(), { error: { code: 'VERSION_CONFLICT', message: 'VERSION_CONFLICT' } })
})

test('BE-01a ⑤ 응답 전송 후 오류는 next(err)로 넘긴다', () => {
  const err = new Error('late')
  let passed
  errorHandler(err, {}, { headersSent: true }, (e) => { passed = e })
  assert.equal(passed, err)
})

test('BE-01a ⑥ 어떤 Origin에도 Access-Control-Allow-* 헤더 없음, x-powered-by 없음', async () => {
  const headers = { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' }
  for (const method of ['GET', 'OPTIONS']) {
    const res = await fetch(`${base}/healthz`, { method, headers })
    await res.arrayBuffer()
    const cors = [...res.headers.keys()].filter((k) => k.startsWith('access-control-allow-'))
    assert.deepEqual(cors, [], method)
    assert.equal(res.headers.get('x-powered-by'), null, method)
  }
})

test('BE-01a ⑦ config.js 밖 process.env 0건(src/, scripts/)', () => {
  const found = []
  for (const dir of ['src', 'scripts']) {
    const root = fileURLToPath(new URL(`../${dir}/`, import.meta.url))
    for (const f of readdirSync(root, { recursive: true })) {
      if (!f.endsWith('.js')) continue
      if (readFileSync(root + f, 'utf8').includes('process.env')) found.push(`${dir}/${f.replaceAll('\\', '/')}`)
    }
  }
  assert.deepEqual(found, ['src/config.js'])
})
