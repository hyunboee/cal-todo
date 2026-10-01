import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// OPS-01, OP-11: 임시 dist를 FRONTEND_DIST로 주입(config보다 먼저 설정해야 해서 동적 import)
const dist = mkdtempSync(join(tmpdir(), 'dist-'))
mkdirSync(join(dist, 'app'))
mkdirSync(join(dist, 'assets'))
writeFileSync(join(dist, 'index.html'), '<p>landing</p>')
writeFileSync(join(dist, 'app', 'index.html'), '<p>spa</p>')
writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
process.env.FRONTEND_DIST = dist

const { startServer, createUser, api } = await import('./helpers.js')
const { pool } = await import('../src/db.js')
let srv
before(async () => { srv = await startServer() })
after(async () => {
  await srv.close()
  await pool.end()
  rmSync(dist, { recursive: true, force: true })
})

test('OPS-01 / → 랜딩 index.html', async () => {
  const res = await api(srv.base, '/')
  assert.equal(res.status, 200)
  assert.equal(res.text, '<p>landing</p>')
})

test('OPS-01 /app, /app/projects/{id}/edit 직접 접근 → app/index.html 폴백', async () => {
  for (const path of ['/app', `/app/projects/${randomUUID()}/edit`]) {
    const res = await api(srv.base, path)
    assert.equal(res.status, 200, path)
    assert.equal(res.text, '<p>spa</p>', path)
  }
})

test('OPS-01 /assets/* 장기 캐시, 그 외 정적 파일은 기본(max-age=0)', async () => {
  const asset = await api(srv.base, '/assets/app-abc123.js')
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('cache-control'), /max-age=31536000, immutable/)
  assert.match((await api(srv.base, '/')).headers.get('cache-control'), /max-age=0/)
})

test('OPS-01 /api 없는 경로와 dist에 없는 경로는 기존 404 JSON 유지', async () => {
  const { token } = await createUser({ balance: 0 })
  for (const [path, t] of [['/api/nope', token], ['/nope.txt', undefined]]) {
    const res = await api(srv.base, path, { token: t })
    assert.equal(res.status, 404, path)
    assert.equal(res.body.error.code, 'NOT_FOUND', path)
  }
})
