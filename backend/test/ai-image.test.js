import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { storage } from '../src/lib/storage.js'
import { sanitizeHtml, extractBlocks } from '../src/lib/html.js'
import { roleModels, parseModel, semaphores, createSemaphore, callRole } from '../src/llm/index.js'
import { AppError } from '../src/lib/errors.js'
import { LLM_RETRY_AFTER_SEC } from '../src/config.js'
import { releaseExpiredJobs } from '../src/jobs/index.js'
import {
  truncateAll, createUser, insertProject, startServer, api, makeImage, upload, clearStorage, countObjects, insertAssetRow,
} from './helpers.js'

// POST /api/projects/:id/ai-images(계약 image-plan.md 1장 services/ai-image.js, 3장 LLM IMAGE)
const { base, close } = await startServer()
const original = { models: { ...roleModels }, sems: { ...semaphores } }
const SRC = await makeImage({ width: 1600, height: 1200 })

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
  roleModels.IMAGE = parseModel('mock:ok')
})
afterEach(() => {
  Object.assign(roleModels, original.models)
  Object.assign(semaphores, original.sems)
})

const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const row = (id) => one(
  'SELECT status, version, draft_html, ai_image_count, active_job_type, active_job_started_at FROM projects WHERE id = $1', [id])
const assetIds = async (id) => (await pool.query('SELECT id FROM assets WHERE project_id = $1', [id])).rows.map((a) => a.id)
const usage = async () => (await pool.query('SELECT role, project_id, success FROM llm_usage_logs')).rows
const usageCount = async () => (await one('SELECT count(*)::int AS c FROM llm_usage_logs')).c
const aiImage = (token, id, body) => api(base, `/api/projects/${id}/ai-images`, { method: 'POST', token, body })
const isAppError = (status, code) => (e) => e instanceof AppError && e.status === status && e.code === code
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
const insertLogs = (userId, role, n) => pool.query(
  `INSERT INTO llm_usage_logs (user_id, role, provider, model_id, latency_ms, success)
   SELECT $1, $2, 'mock', 'ok', 1, true FROM generate_series(1, $3)`, [userId, role, n])

// 업로드 1장 → 그 이미지를 넣은 GENERATED draft
async function projectWithImage(u, { status = 'GENERATED' } = {}) {
  const id = await insertProject(u.userId)
  const up = await upload(base, u.token, id, SRC)
  assert.equal(up.status, 201, up.text)
  const draft = sanitizeHtml(`<section><h2>제목</h2><img src="asset:${up.body.id}" alt=""></section><section><p>본문</p></section>`)
  await pool.query('UPDATE projects SET status = $2, draft_html = $3 WHERE id = $1', [id, status, draft])
  const [b1] = extractBlocks(draft)
  const target = { blockId: b1.blockId, imageId: b1.images[0].imageId }
  return { id, assetId: up.body.id, draft, target, body: (version = 1, prompt = '배경을 흰색으로') => ({ ...target, prompt, version }) }
}
// 실패·거절 뒤: 횟수 복원, 작업 해제, draft·version·asset 불변
async function assertRestored(p, { count = 0, version = 1, status = 'GENERATED', assets = 1 } = {}) {
  assert.deepEqual(await row(p.id), {
    status, version, draft_html: p.draft, ai_image_count: count, active_job_type: null, active_job_started_at: null,
  })
  assert.equal((await assetIds(p.id)).length, assets)
  assert.equal((await one('SELECT count(*)::int AS c FROM edit_operations WHERE project_id = $1', [p.id])).c, 0)
}

test('ai-images 성공(mock:ok): asset +1, aiImageCount +1, src가 새 asset, EDITING·version+1, IMAGE 사용 로그 1행', async () => {
  const u = await createUser()
  const p = await projectWithImage(u)
  const objects = await countObjects('private')

  const r = await aiImage(u.token, p.id, p.body(1, '배경을 흰색으로'))
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.version, 2)
  for (const k of ['draftHtml', 'finalHtml']) assert.equal(k in r.body, false, k)

  const ids = await assetIds(p.id)
  assert.equal(ids.length, 2)
  const newId = ids.find((a) => a !== p.assetId)
  const cur = await row(p.id)
  assert.equal(cur.status, 'EDITING')
  assert.equal(cur.version, 2)
  assert.equal(cur.ai_image_count, 1)
  assert.equal(cur.active_job_type, null)
  assert.equal(cur.active_job_started_at, null)
  const [b1, b2] = extractBlocks(cur.draft_html)
  const [d1, d2] = extractBlocks(p.draft)
  assert.deepEqual(b1.images, [{ imageId: p.target.imageId, assetId: newId, widthPct: 100, align: 'center' }])
  assert.deepEqual(b1.fields, d1.fields)
  assert.deepEqual(b2, d2)
  assert.deepEqual(r.body.blocks, extractBlocks(cur.draft_html))

  // 새 asset: 원본과 같은 형식, 긴 변 1024px 이하(입력 축소), 원본·프리뷰 객체 2개 추가
  const a = await one('SELECT original_key, preview_key, mime, size FROM assets WHERE id = $1', [newId])
  assert.equal(a.mime, 'image/png')
  const buf = await storage.get('private', a.original_key)
  assert.equal(a.size, buf.length)
  const meta = await sharp(buf).metadata()
  assert.equal(meta.format, 'png')
  assert.ok(Math.max(meta.width, meta.height) <= 1024, `${meta.width}x${meta.height}`)
  assert.equal(buf.equals(SRC), false)
  assert.equal(await countObjects('private'), objects + 2)
  assert.equal(await countObjects('public'), 0)

  // 프리뷰 반영: 새 asset의 워터마크 사본 data URI
  const thumb = `data:image/webp;base64,${(await storage.get('private', a.preview_key)).toString('base64')}`
  assert.deepEqual(cheerio.load(r.body.html, null, false)('img').toArray().map((el) => el.attribs.src), [thumb])
  assert.equal(cheerio.load(r.body.html, null, false)('[data-watermark="overlay"]').length, 1)

  assert.deepEqual(await usage(), [{ role: 'IMAGE', project_id: p.id, success: true }])
  const ops = (await pool.query('SELECT type, block_id, payload FROM edit_operations WHERE project_id = $1', [p.id])).rows
  assert.deepEqual(ops, [{ type: 'AI', block_id: p.target.blockId, payload: { imageId: p.target.imageId, assetId: newId, prompt: '배경을 흰색으로' } }])

  const detail = await api(base, `/api/projects/${p.id}`, { token: u.token })
  assert.equal(detail.body.aiImageCount, 1)
})

test('ai-images: ai_image_count 9 → 성공(10), 11번째 → 429 AI_IMAGE_LIMIT, LLM 0회', async () => {
  const u = await createUser()
  const p = await projectWithImage(u)
  await pool.query('UPDATE projects SET ai_image_count = 9 WHERE id = $1', [p.id])
  const r = await aiImage(u.token, p.id, p.body(1))
  assert.equal(r.status, 200, r.text)
  assert.equal((await row(p.id)).ai_image_count, 10)
  assert.equal(await usageCount(), 1)

  const before = await row(p.id)
  assertError(await aiImage(u.token, p.id, p.body(2)), 429, 'AI_IMAGE_LIMIT')
  assert.deepEqual(await row(p.id), before)
  assert.equal(await usageCount(), 1)
  assert.equal((await assetIds(p.id)).length, 2)
})

test('ai-images: 프로젝트 이미지 10장 → 400 VALIDATION_FAILED, LLM 0회·횟수 소모 0', async () => {
  const u = await createUser()
  const p = await projectWithImage(u)
  for (let i = 0; i < 9; i++) await insertAssetRow(p.id)
  assertError(await aiImage(u.token, p.id, p.body(1)), 400, 'VALIDATION_FAILED')
  assert.equal(await usageCount(), 0)
  await assertRestored(p, { assets: 10 })
})

test('ai-images: mock:fail → 502 UPSTREAM_FAILED, 횟수 복원, asset·스토리지 증가 0', async () => {
  roleModels.IMAGE = parseModel('mock:fail')
  const u = await createUser()
  const p = await projectWithImage(u)
  const objects = await countObjects('private')
  assertError(await aiImage(u.token, p.id, p.body(1)), 502, 'UPSTREAM_FAILED')
  await assertRestored(p)
  assert.equal(await countObjects('private'), objects)
  assert.deepEqual(await usage(), [{ role: 'IMAGE', project_id: p.id, success: false }])
})

test('ai-images: 503 LLM_BUSY + Retry-After → 횟수 복원', async () => {
  const u = await createUser()
  const p = await projectWithImage(u)
  semaphores.IMAGE = createSemaphore(1, 0, 1000)
  const release = await semaphores.IMAGE.acquire()
  try {
    const r = await aiImage(u.token, p.id, p.body(1))
    assertError(r, 503, 'LLM_BUSY')
    assert.equal(r.headers.get('retry-after'), String(LLM_RETRY_AFTER_SEC))
  } finally {
    release()
  }
  await assertRestored(p)
  assert.equal(await usageCount(), 0)
})

test('ai-images: 일일 상한은 MAIN과 공유 — MAIN 20회 뒤 IMAGE 429 DAILY_LLM_LIMIT(횟수 복원), IMAGE 20회 뒤 MAIN 429', async () => {
  const u = await createUser()
  const p = await projectWithImage(u)
  await insertLogs(u.userId, 'MAIN', 20)
  assertError(await aiImage(u.token, p.id, p.body(1)), 429, 'DAILY_LLM_LIMIT')
  await assertRestored(p)
  assert.equal(await usageCount(), 20)

  const v = await createUser()
  await insertLogs(v.userId, 'IMAGE', 20)
  await assert.rejects(callRole('MAIN', { system: 's', prompt: 'p' }, { userId: v.userId }), isAppError(429, 'DAILY_LLM_LIMIT'))
  await callRole('LIGHT', { system: 's', prompt: 'p' }, { userId: v.userId }) // LIGHT는 별도 버킷
})

test('ai-images: prompt 501자(trim 기준)·HTML 태그·빈 값·형식 오류 → 400(DB 전), LLM 0회', async () => {
  const u = await createUser()
  const other = await createUser()
  const p = await projectWithImage(u)
  const ok = p.body(1)
  const bad = [
    p.body(1, 'x'.repeat(501)), p.body(1, `  ${'x'.repeat(501)}  `), p.body(1, ''), p.body(1, '   '),
    p.body(1, '<b>굵게</b>'), p.body(1, '앞 </p> 뒤'), p.body(1, '<!-- 주석 -->'), p.body(1, 1),
    {}, { ...p.target, version: 1 }, { ...ok, extra: 1 }, { ...ok, assetId: p.assetId },
    { ...ok, imageId: '' }, { ...ok, blockId: 1 }, { ...ok, version: 0 }, { ...ok, version: '1' },
  ]
  for (const body of bad) {
    assertError(await aiImage(u.token, p.id, body), 400, 'VALIDATION_FAILED')
    assertError(await aiImage(other.token, p.id, body), 400, 'VALIDATION_FAILED')
  }
  assert.equal(await usageCount(), 0)
  await assertRestored(p)
})

test('ai-images: 대상 이미지 없음(imageId·blockId) → 400, LLM 0회', async () => {
  const u = await createUser()
  const p = await projectWithImage(u)
  const [, b2] = extractBlocks(p.draft)
  for (const target of [{ ...p.target, imageId: 'nope' }, { ...p.target, blockId: 'nope' }, { blockId: b2.blockId, imageId: p.target.imageId }]) {
    assertError(await aiImage(u.token, p.id, { ...target, prompt: 'x', version: 1 }), 400, 'VALIDATION_FAILED')
  }
  assert.equal(await usageCount(), 0)
  await assertRestored(p)
})

test('ai-images: GENERATED·EDITING 외 상태 409 INVALID_STATE, version 409, 진행 중 작업 409, 남의 것 404, LLM 0회', async () => {
  const u = await createUser()
  const other = await createUser()
  for (const status of ['DRAFT', 'ANALYZED']) {
    const p = await projectWithImage(u, { status })
    assertError(await aiImage(u.token, p.id, p.body(1)), 409, 'INVALID_STATE')
  }
  const pub = await projectWithImage(u)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [pub.id])
  assertError(await aiImage(u.token, pub.id, pub.body(1)), 409, 'INVALID_STATE')

  const p = await projectWithImage(u)
  assertError(await aiImage(other.token, p.id, p.body(1)), 404, 'NOT_FOUND')
  assertError(await aiImage(u.token, 'not-a-uuid', p.body(1)), 404, 'NOT_FOUND')
  assertError(await aiImage(u.token, p.id, p.body(2)), 409, 'VERSION_CONFLICT')
  await pool.query("UPDATE projects SET active_job_type = 'REGEN', active_job_started_at = now() WHERE id = $1", [p.id])
  assertError(await aiImage(u.token, p.id, p.body(1)), 409, 'JOB_IN_PROGRESS')
  assert.equal((await row(p.id)).ai_image_count, 0)

  // EDITING도 허용
  const editing = await projectWithImage(u, { status: 'EDITING' })
  assert.equal((await aiImage(u.token, editing.id, editing.body(1))).status, 200)
  assert.equal(await usageCount(), 1)
})

test('ai-images: 5분 넘은 AI_IMAGE 선점은 releaseExpiredJobs가 해제하며 ai_image_count 복원, 1분 전은 유지', async () => {
  const u = await createUser()
  const expired = await projectWithImage(u)
  const fresh = await projectWithImage(u)
  const reserve = (id, ago) => pool.query(
    `UPDATE projects SET ai_image_count = 1, active_job_type = 'AI_IMAGE', active_job_started_at = now() - $2::interval WHERE id = $1`,
    [id, ago])
  await reserve(expired.id, '6 minutes')
  await reserve(fresh.id, '1 minute')

  assert.equal(await releaseExpiredJobs(), 1)
  await assertRestored(expired)
  const f = await row(fresh.id)
  assert.equal(f.ai_image_count, 1)
  assert.equal(f.active_job_type, 'AI_IMAGE')
})
