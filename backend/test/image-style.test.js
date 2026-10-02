import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { sanitizeHtml, extractBlocks, toFinalHtml } from '../src/lib/html.js'
import { truncateAll, createUser, insertProject, startServer, api, makeImage, upload, clearStorage } from './helpers.js'

// POST /api/projects/:id/image-styles, extractBlocks images widthPct·align(계약 block-plan.md 백엔드)
const { base, close } = await startServer()
const PNG = await makeImage()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})

const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const row = (id) => one('SELECT status, version, draft_html, active_job_type FROM projects WHERE id = $1', [id])
const ops = async (id) => (await pool.query('SELECT type, block_id, payload FROM edit_operations WHERE project_id = $1 ORDER BY created_at', [id])).rows
const imageStyle = (token, id, body) => api(base, `/api/projects/${id}/image-styles`, { method: 'POST', token, body })
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
// style 속성 → { 속성: 값 }(공백 무시)
const styleOf = (el) => Object.fromEntries((el.attribs.style ?? '').split(';').filter((d) => d.trim())
  .map((d) => d.split(':').map((s) => s.trim())))
const imgStyles = (html) => cheerio.load(html, null, false)('img').toArray().map(styleOf)
const MARGINS = { left: ['0', 'auto'], center: ['auto', 'auto'], right: ['auto', '0'] }
const assertImgStyle = (s, widthPct, align) => {
  assert.equal(s.width, `${widthPct}%`)
  assert.equal(s.height, 'auto')
  assert.equal(s.display, 'block')
  assert.deepEqual([s['margin-left'], s['margin-right']], MARGINS[align], JSON.stringify(s))
}

// 업로드 2장 = draft img 2개(첫 블록). target = 첫 블록 두 번째 이미지. 섹션 2개(하나뿐이면 블록이 쪼개짐)
async function projectWithImages(u, { status = 'GENERATED' } = {}) {
  const id = await insertProject(u.userId)
  const ids = []
  for (let i = 0; i < 2; i++) {
    const r = await upload(base, u.token, id, PNG)
    assert.equal(r.status, 201, r.text)
    ids.push(r.body.id)
  }
  const draft = sanitizeHtml(`<section><h2>제목</h2>${ids.map((a) => `<img src="asset:${a}" alt="">`).join('')}</section>` +
    '<section><p>본문</p></section>')
  await pool.query('UPDATE projects SET status = $2, draft_html = $3 WHERE id = $1', [id, status, draft])
  const [b1] = extractBlocks(draft)
  const target = { blockId: b1.blockId, imageId: b1.images[1].imageId }
  return { id, ids, draft, target, body: (widthPct, align, version = 1) => ({ ...target, widthPct, align, version }) }
}

test('html: extractBlocks images 기본값 widthPct 100·align center, style에서 % 폭과 margin 정렬을 읽는다', () => {
  const a = randomUUID()
  const [b1] = extractBlocks(sanitizeHtml(`<section><img src="asset:${a}">` +
    `<img src="asset:${a}" style="width:40%;height:auto;display:block;margin-left:auto;margin-right:0">` +
    `<img src="asset:${a}" style="width:25%;height:auto;display:block;margin-left:0;margin-right:auto"></section><section><p>x</p></section>`))
  assert.deepEqual(b1.images.map(({ widthPct, align }) => ({ widthPct, align })), [
    { widthPct: 100, align: 'center' }, { widthPct: 40, align: 'right' }, { widthPct: 25, align: 'left' },
  ])
})

test('image-styles 성공: 정렬 3종 style, version+1, EDITING, extractBlocks 반영, 다른 이미지·블록 불변, MANUAL 기록', async () => {
  const u = await createUser()
  const p = await projectWithImages(u)
  const [d1, d2] = extractBlocks(p.draft)
  let version = 1
  for (const [widthPct, align] of [[50, 'left'], [10, 'center'], [100, 'right'], [35, 'center']]) {
    const r = await imageStyle(u.token, p.id, p.body(widthPct, align, version))
    assert.equal(r.status, 200, r.text)
    version += 1
    assert.equal(r.body.version, version)
    for (const k of ['draftHtml', 'finalHtml']) assert.equal(k in r.body, false, k)

    const cur = await row(p.id)
    assert.equal(cur.status, 'EDITING')
    assert.equal(cur.version, version)
    assert.equal(cur.active_job_type, null)
    const [s0, s1] = imgStyles(cur.draft_html)
    assertImgStyle(s1, widthPct, align)
    assert.equal(s0.width, undefined, '다른 이미지는 그대로')
    const [b1, b2] = extractBlocks(cur.draft_html)
    assert.deepEqual(b1.images, [d1.images[0], { ...d1.images[1], widthPct, align }])
    assert.deepEqual(b1.fields, d1.fields)
    assert.deepEqual(b2, d2)
    assert.deepEqual(r.body.blocks, extractBlocks(cur.draft_html))
    assertImgStyle(imgStyles(r.body.html)[1], widthPct, align) // 프리뷰에도 반영
  }
  assert.deepEqual((await ops(p.id)).at(-1), {
    type: 'MANUAL', block_id: p.target.blockId, payload: { imageId: p.target.imageId, widthPct: 35, align: 'center' },
  })
  assert.equal((await ops(p.id)).length, 4)

  // 재정제·최종 HTML에도 style 유지
  const draft = (await row(p.id)).draft_html
  assertImgStyle(imgStyles(sanitizeHtml(draft))[1], 35, 'center')
  assertImgStyle(imgStyles(toFinalHtml(draft, () => 'https://img.example/a.png'))[1], 35, 'center')
})

test('image-styles: widthPct·align·형식 오류 → 400(DB 조회 전: 남의 프로젝트여도 400)', async () => {
  const u = await createUser()
  const other = await createUser()
  const p = await projectWithImages(u)
  const ok = p.body(50, 'center')
  const bad = [
    p.body(9, 'center'), p.body(105, 'center'), p.body(12, 'center'), p.body(0, 'center'), p.body(5, 'center'),
    p.body('50', 'center'), p.body(50.5, 'center'), p.body(null, 'center'),
    p.body(50, 'top'), p.body(50, ''), p.body(50, 'Center'), p.body(50, 1),
    {}, { ...p.target, widthPct: 50, version: 1 }, { ...ok, extra: 1 }, { ...ok, assetId: p.ids[0] },
    { ...ok, imageId: '' }, { ...ok, blockId: 1 }, { ...ok, version: 0 }, { ...ok, version: '1' },
  ]
  for (const body of bad) {
    assertError(await imageStyle(u.token, p.id, body), 400, 'VALIDATION_FAILED')
    assertError(await imageStyle(other.token, p.id, body), 400, 'VALIDATION_FAILED')
  }
  assert.deepEqual(await row(p.id), { status: 'GENERATED', version: 1, draft_html: p.draft, active_job_type: null })
  assert.equal((await ops(p.id)).length, 0)
})

test('image-styles: 없는 imageId·blockId, 다른 블록의 imageId → 400, draft·version 불변', async () => {
  const u = await createUser()
  const p = await projectWithImages(u)
  const [, b2] = extractBlocks(p.draft)
  for (const target of [{ ...p.target, imageId: 'nope' }, { ...p.target, blockId: 'nope' }, { blockId: b2.blockId, imageId: p.target.imageId }]) {
    assertError(await imageStyle(u.token, p.id, { ...target, widthPct: 50, align: 'left', version: 1 }), 400, 'VALIDATION_FAILED')
  }
  assert.deepEqual(await row(p.id), { status: 'GENERATED', version: 1, draft_html: p.draft, active_job_type: null })
  assert.equal((await ops(p.id)).length, 0)
})

test('image-styles: PUBLISHED·DRAFT 409 INVALID_STATE, version 불일치 409, 진행 중 작업 409, 남의 것 404', async () => {
  const u = await createUser()
  const other = await createUser()
  const pub = await projectWithImages(u)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [pub.id])
  assertError(await imageStyle(u.token, pub.id, pub.body(50, 'left')), 409, 'INVALID_STATE')
  const draftState = await projectWithImages(u, { status: 'DRAFT' })
  assertError(await imageStyle(u.token, draftState.id, draftState.body(50, 'left')), 409, 'INVALID_STATE')

  const p = await projectWithImages(u)
  assertError(await imageStyle(other.token, p.id, p.body(50, 'left')), 404, 'NOT_FOUND')
  assertError(await imageStyle(u.token, p.id, p.body(50, 'left', 2)), 409, 'VERSION_CONFLICT')
  await pool.query("UPDATE projects SET active_job_type = 'REGEN', active_job_started_at = now() WHERE id = $1", [p.id])
  assertError(await imageStyle(u.token, p.id, p.body(50, 'left')), 409, 'JOB_IN_PROGRESS')
  assert.equal((await one('SELECT count(*)::int AS c FROM edit_operations')).c, 0)
})
