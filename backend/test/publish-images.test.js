import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { storage } from '../src/lib/storage.js'
import { roleModels, parseModel } from '../src/llm/index.js'
import { PUBLIC_IMAGE_BASE_URL } from '../src/config.js'
import {
  truncateAll, createUser, insertProject, startServer, api, generateViaApi, makeImage, upload, clearStorage, countObjects,
} from './helpers.js'

const { base, close } = await startServer()
const originalModels = { ...roleModels }

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})
afterEach(() => Object.assign(roleModels, originalModels))

const publish = (token, id, version) => api(base, `/api/projects/${id}/publish`, { method: 'POST', token, body: { version } })
const final = (token, id) => api(base, `/api/projects/${id}/final`, { token })
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const balance = async (userId) => (await one('SELECT topup_balance FROM credit_wallets WHERE user_id = $1', [userId])).topup_balance
const deducts = async (id) => (await one("SELECT count(*)::int AS c FROM credit_ledger WHERE project_id = $1 AND reason = 'DEDUCT'", [id])).c
const assets = async (id) => (await pool.query('SELECT id, original_key, public_key FROM assets WHERE project_id = $1 ORDER BY id', [id])).rows
const imgSrcs = (html) => cheerio.load(html, null, false)('img').toArray().map((el) => el.attribs.src)
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}

// 이미지 업로드 → 생성까지(GENERATED, version 2)
async function generatedWithImages(u, images) {
  const id = await insertProject(u.userId)
  for (const [buf, opts] of images) assert.equal((await upload(base, u.token, id, buf, opts)).status, 201)
  const g = await generateViaApi(base, u.token, id, 1)
  assert.equal(g.status, 200, g.text)
  return id
}
const ONE_PNG = async () => [[await makeImage(), undefined]]

test('BE-14b ① FR-35: 재생성 진행 중 퍼블리시 → 409 JOB_IN_PROGRESS, 차감 0건', async () => {
  const u = await createUser({ balance: 1 })
  const id = await insertProject(u.userId, { status: 'GENERATED', draftHtml: '<div style="width:780px;margin:0 auto"><section data-block-id="b1"><p data-edit-id="e1">x</p></section></div>' })
  roleModels.MAIN = parseModel('mock:delay:300')
  const pending = api(base, `/api/projects/${id}/regenerate`, { method: 'POST', token: u.token, body: { version: 1 } })
  await sleep(150)
  assert.equal((await one('SELECT active_job_type FROM projects WHERE id = $1', [id])).active_job_type, 'REGEN')

  assertError(await publish(u.token, id, 1), 409, 'JOB_IN_PROGRESS')
  assert.equal(await deducts(id), 0)
  assert.equal(await balance(u.userId), 1)
  assert.equal((await pending).status, 200)
  assert.equal((await one('SELECT status FROM projects WHERE id = $1', [id])).status, 'GENERATED')
})

test('BE-14b ② [P0] AC-BR66: 퍼블리시 전 공개 객체 0건, 커밋 뒤 복사, final img는 서명 없는 공개 URL', async (t) => {
  const u = await createUser({ balance: 1 })
  const id = await generatedWithImages(u, [
    [await makeImage(), undefined],
    [await makeImage({ format: 'jpeg' }), { filename: 'a.jpg', type: 'image/jpeg' }],
  ])
  assert.equal((await api(base, `/api/projects/${id}/preview`, { token: u.token })).status, 200)
  assert.equal(await countObjects('public'), 0)
  for (const a of await assets(id)) assert.equal(a.public_key, null)

  // 복사 시점에 별도 커넥션으로 PUBLISHED가 보이면 = COMMIT 뒤(withTx 안 스토리지 0, BE-14a ⑦)
  const realCopy = storage.copy
  const seen = []
  t.mock.method(storage, 'copy', async (...args) => {
    seen.push((await one('SELECT status FROM projects WHERE id = $1', [id])).status)
    return realCopy.apply(storage, args)
  })
  const r = await publish(u.token, id, 2)
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(seen, ['PUBLISHED', 'PUBLISHED'])

  const rows = await assets(id)
  const expected = rows.map((a) => `${PUBLIC_IMAGE_BASE_URL}/${a.public_key}`).sort()
  for (const a of rows) {
    assert.match(a.public_key, new RegExp(`^${a.id}\\.(png|jpg)$`))
    assert.ok((await storage.get('public', a.public_key)).equals(await storage.get('private', a.original_key)))
  }
  assert.equal(await countObjects('public'), 2)

  const srcs = imgSrcs(r.body.finalHtml)
  assert.deepEqual([...srcs].sort(), expected)
  for (const src of srcs) {
    assert.ok(src.startsWith(`${PUBLIC_IMAGE_BASE_URL}/`), src)
    assert.equal(src.includes('?'), false, src)
    assert.equal(/x-amz/i.test(src), false, src)
  }
  for (const s of ['asset:', 'data:', 'orig/', 'prev/']) assert.equal(r.body.finalHtml.includes(s), false, s)
  assert.equal((await final(u.token, id)).body.finalHtml, r.body.finalHtml)
})

test('BE-14b ③ 복사 실패 주입 → 크레딧 차감 유지·public_key NULL, mock 해제 후 GET /final 재시도로 채워짐', async (t) => {
  const logs = []
  t.mock.method(console, 'log', (line) => logs.push(String(line)))
  const u = await createUser({ balance: 1 })
  const id = await generatedWithImages(u, await ONE_PNG())

  const copy = t.mock.method(storage, 'copy', async () => { throw new Error('injected copy failure') })
  const r = await publish(u.token, id, 2)
  assert.equal(r.status, 200, r.text)
  assert.equal(copy.mock.callCount(), 3) // 최대 3회 시도
  assert.equal(await balance(u.userId), 0)
  assert.equal(await deducts(id), 1)
  assert.equal((await one('SELECT status FROM projects WHERE id = $1', [id])).status, 'PUBLISHED')
  assert.equal((await assets(id))[0].public_key, null)
  assert.equal(await countObjects('public'), 0)

  const failed = logs.filter((l) => l.includes('"public_copy_failed"'))
  assert.equal(failed.length, 1)
  const entry = JSON.parse(failed[0])
  assert.equal(entry.level, 'error')
  assert.equal(entry.projectId, id)
  for (const s of ['orig/', PUBLIC_IMAGE_BASE_URL]) assert.equal(failed[0].includes(s), false, s)

  copy.mock.restore()
  const f = await final(u.token, id)
  assert.equal(f.status, 200)
  assert.equal(f.body.finalHtml, r.body.finalHtml)
  const [a] = await assets(id)
  assert.equal(a.public_key, imgSrcs(r.body.finalHtml)[0].slice(PUBLIC_IMAGE_BASE_URL.length + 1))
  assert.equal(await countObjects('public'), 1)
  assert.equal(await balance(u.userId), 0)
  assert.equal(await deducts(id), 1)
})

test('BE-14b ③ 추가: PUBLISHED 재퍼블리시도 재시도 경로, 추가 차감 0', async (t) => {
  t.mock.method(console, 'log', () => {})
  const u = await createUser({ balance: 1 })
  const id = await generatedWithImages(u, await ONE_PNG())
  const copy = t.mock.method(storage, 'copy', async () => { throw new Error('x') })
  assert.equal((await publish(u.token, id, 2)).status, 200)
  assert.equal((await assets(id))[0].public_key, null)

  copy.mock.restore()
  assert.equal((await publish(u.token, id, 99)).status, 200)
  assert.notEqual((await assets(id))[0].public_key, null)
  assert.equal(await countObjects('public'), 1)
  assert.equal(await deducts(id), 1)
})
