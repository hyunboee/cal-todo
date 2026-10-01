import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { S3Client } from '@aws-sdk/client-s3'
import { pool } from '../src/db.js'
import { storage } from '../src/lib/storage.js'
import { STORAGE_DRIVER, PUBLIC_IMAGE_BASE_URL } from '../src/config.js'
import {
  truncateAll, createUser, insertProject, startServer, deepKeys, makeImage, upload, clearStorage, countObjects, storageDir,
} from './helpers.js'

const { base, close } = await startServer()
const PNG = await makeImage()
// 1x1 GIF89a(sharp 출력 대신 고정 바이트)
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})

const assetRows = async (id) => (await pool.query('SELECT * FROM assets WHERE project_id = $1', [id])).rows
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}

test('BE-06 ① [P1] AC-BR36: 11번째·10MB 초과·gif·가짜 png·필드 없음 → 400, assets 행 증가 0', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  for (let i = 0; i < 10; i++) assert.equal((await upload(base, u.token, id, PNG)).status, 201)
  assertError(await upload(base, u.token, id, PNG), 400, 'VALIDATION_FAILED')
  assert.equal((await assetRows(id)).length, 10)

  const id2 = await insertProject(u.userId)
  const bad = [
    [Buffer.alloc(10485761), { filename: 'big.png', type: 'image/png' }], // ASSET_MAX_BYTES + 1
    [GIF, { filename: 'a.gif', type: 'image/gif' }],
    [GIF, { filename: 'a.png', type: 'image/png' }], // MIME 위장 gif → sharp 형식 검사
    [Buffer.from('this is not an image'), { filename: 'fake.png', type: 'image/png' }],
    [PNG, { field: 'image' }], // file 필드 아님
  ]
  for (const [buf, opts] of bad) assertError(await upload(base, u.token, id2, buf, opts), 400, 'VALIDATION_FAILED')
  assert.equal((await assetRows(id2)).length, 0)
})

test('BE-06 ② D-21: 프리뷰 사본은 webp·폭 ≤ 390, 원본은 그대로', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  const buf = await makeImage({ width: 1200, height: 900 })
  const r = await upload(base, u.token, id, buf)
  assert.equal(r.status, 201, r.text)

  const [a] = await assetRows(id)
  assert.equal(a.id, r.body.id)
  assert.equal(a.mime, 'image/png')
  assert.equal(a.size, buf.length)
  assert.equal(a.original_key, `orig/${id}/${a.id}.png`)
  assert.equal(a.preview_key, `prev/${id}/${a.id}.webp`)

  const prev = await sharp(await storage.get('private', a.preview_key)).metadata()
  assert.equal(prev.format, 'webp')
  assert.ok(prev.width <= 390, String(prev.width))
  assert.ok((await storage.get('private', a.original_key)).equals(buf))
})

test('BE-06 ③ BR-50: 업로드 응답은 {id}만, 키·스토리지 경로·버킷 호스트 0건', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  const r = await upload(base, u.token, id, PNG)
  assert.equal(r.status, 201)
  assert.deepEqual([...deepKeys(r.body)], ['id'])
  assert.match(r.body.id, /^[0-9a-f-]{36}$/)
  const dir = await storageDir()
  for (const s of ['orig/', 'prev/', dir, JSON.stringify(dir).slice(1, -1), PUBLIC_IMAGE_BASE_URL]) assert.equal(r.text.includes(s), false, s)
})

test('BE-06 ④ AC-BR66: 업로드 후 public_key NULL, 공개 버킷 객체 0건', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  for (let i = 0; i < 2; i++) assert.equal((await upload(base, u.token, id, PNG)).status, 201)
  const rows = await assetRows(id)
  assert.equal(rows.length, 2)
  for (const a of rows) assert.equal(a.public_key, null)
  assert.equal(await countObjects('public'), 0)
  assert.equal(await countObjects('private'), 4) // 원본 + 프리뷰 사본
})

test('BE-06 ⑤ QA-04: 테스트는 local 드라이버, S3 호출 0건', async (t) => {
  assert.equal(STORAGE_DRIVER, 'local')
  const send = t.mock.method(S3Client.prototype, 'send')
  const u = await createUser()
  const id = await insertProject(u.userId)
  assert.equal((await upload(base, u.token, id, PNG)).status, 201)
  const [a] = await assetRows(id)
  await storage.get('private', a.preview_key)
  assert.equal(send.mock.callCount(), 0)
})

test('BE-06 추가: jpeg·webp 허용, 판정 순서 404 → 409 → 403 → 402, 업로드는 version·진행 중 작업 무관', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId, { activeJobType: 'GENERATE' })
  assert.equal((await upload(base, u.token, id, await makeImage({ format: 'jpeg' }), { filename: 'a.jpg', type: 'image/jpeg' })).status, 201)
  assert.equal((await upload(base, u.token, id, await makeImage({ format: 'webp' }), { filename: 'a.webp', type: 'image/webp' })).status, 201)
  const exts = (await assetRows(id)).map((a) => a.original_key.split('.').pop()).sort()
  assert.deepEqual(exts, ['jpg', 'webp'])
  const p = (await pool.query('SELECT version, active_job_type FROM projects WHERE id = $1', [id])).rows[0]
  assert.deepEqual(p, { version: 1, active_job_type: 'GENERATE' })

  const other = await createUser()
  assertError(await upload(base, other.token, id, PNG), 404, 'NOT_FOUND')
  assertError(await upload(base, u.token, 'not-a-uuid', PNG), 404, 'NOT_FOUND')

  const published = await insertProject(u.userId)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [published])
  assertError(await upload(base, u.token, published, PNG), 409, 'INVALID_STATE')

  const unverified = await createUser({ verified: false, balance: 0 })
  assertError(await upload(base, unverified.token, await insertProject(unverified.userId), PNG), 403, 'EMAIL_NOT_VERIFIED')
  const poor = await createUser({ balance: 0 })
  const poorId = await insertProject(poor.userId)
  assertError(await upload(base, poor.token, poorId, PNG), 402, 'INSUFFICIENT_CREDIT')
  assert.equal((await assetRows(published)).length + (await assetRows(poorId)).length, 0)
})
