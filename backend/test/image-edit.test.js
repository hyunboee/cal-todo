import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { storage } from '../src/lib/storage.js'
import { sanitizeHtml, extractBlocks, toFinalHtml, applyImageEdit } from '../src/lib/html.js'
import { truncateAll, createUser, insertProject, startServer, api, makeImage, upload, clearStorage } from './helpers.js'

// 이미지 목록(GET /assets)·이미지 교체(POST /image-edits)·lib/html.js data-img-id(계약 image-plan.md 1장)
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
const ops = async (id) => (await pool.query('SELECT type, block_id, payload FROM edit_operations WHERE project_id = $1', [id])).rows
const listAssets = (token, id) => api(base, `/api/projects/${id}/assets`, { token })
const imageEdit = (token, id, body) => api(base, `/api/projects/${id}/image-edits`, { method: 'POST', token, body })
const imgSrcs = (html) => cheerio.load(html, null, false)('img').toArray().map((el) => el.attribs.src ?? '')
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}

// 업로드 n장 → 앞 최대 2장을 첫 블록에 넣은 GENERATED draft(target = 첫 블록 마지막 이미지). 나머지는 draft에 없는 교체 후보
async function projectWithImages(u, n = 3) {
  const id = await insertProject(u.userId)
  const ids = []
  for (let i = 0; i < n; i++) {
    const r = await upload(base, u.token, id, PNG)
    assert.equal(r.status, 201, r.text)
    ids.push(r.body.id)
  }
  const imgs = ids.slice(0, 2).map((a) => `<img src="asset:${a}" alt="">`).join('')
  const draft = sanitizeHtml(`<section><h2>제목</h2>${imgs}</section><section><p>본문</p></section>`)
  await pool.query("UPDATE projects SET status = 'GENERATED', draft_html = $2 WHERE id = $1", [id, draft])
  const [b1] = extractBlocks(draft)
  return { id, ids, draft, target: { blockId: b1.blockId, imageId: b1.images.at(-1).imageId } }
}
const publishedSql = (id) =>
  pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [id])

// ---- lib/html.js ----

test('html: sanitizeHtml이 블록마다 img에 data-img-id 부여(블록별 i1부터), 유효한 기존 값 유지·중복 재부여', () => {
  const a = randomUUID()
  const b = randomUUID()
  const html = sanitizeHtml(`<section><img src="asset:${a}"><p>x</p><img src="asset:${b}"></section>` +
    `<section><img src="asset:${a}" data-img-id="keep"><img src="asset:${b}" data-img-id="keep"></section>` +
    `<section><p data-img-id="i9">글자</p></section>`)
  const $ = cheerio.load(html, null, false)
  const blocks = $.root().children().first().children().toArray()
  const idsOf = (blk) => $(blk).find('img').toArray().map((el) => el.attribs['data-img-id'])
  assert.deepEqual(idsOf(blocks[0]), ['i1', 'i2'])
  const second = idsOf(blocks[1])
  assert.equal(second[0], 'keep')
  assert.ok(second[1] && second[1] !== 'keep', String(second[1]))
  assert.equal($('p[data-img-id]').length, 0, 'img 외 요소의 data-img-id는 제거')
})

test('html: extractBlocks에 images [{imageId, assetId}](assetId는 uuid만), 이미지 없는 블록은 []', () => {
  const a = randomUUID()
  const b = randomUUID()
  const [b1, b2] = extractBlocks(sanitizeHtml(`<section><h2>제목</h2><img src="asset:${a}"><img src="asset:${b}"></section><section><p>본문</p></section>`))
  assert.deepEqual(b1.images, [{ imageId: 'i1', assetId: a, widthPct: 100, align: 'center' }, { imageId: 'i2', assetId: b, widthPct: 100, align: 'center' }])
  assert.deepEqual(b2.images, [])
  assert.equal(JSON.stringify([b1, b2]).includes('asset:'), false)
})

test('html: applyImageEdit은 지정 블록·이미지 src만 asset:새id로 교체, 없는 blockId·imageId → null', () => {
  const a = randomUUID()
  const n = randomUUID()
  const draft = sanitizeHtml(`<section><img src="asset:${a}"><img src="asset:${a}"></section><section><img src="asset:${a}"></section>`)
  const [b1, b2] = extractBlocks(draft)
  const out = applyImageEdit(draft, b1.blockId, 'i2', n)
  assert.equal(typeof out, 'string')
  const [o1, o2] = extractBlocks(out)
  assert.deepEqual(o1.images, [{ imageId: 'i1', assetId: a, widthPct: 100, align: 'center' }, { imageId: 'i2', assetId: n, widthPct: 100, align: 'center' }])
  assert.deepEqual(o2, b2) // 다른 블록의 같은 imageId(i1)는 그대로
  assert.equal(out, draft.replace(`src="asset:${a}" data-img-id="i2"`, `src="asset:${n}" data-img-id="i2"`)
    .replace(`data-img-id="i2" src="asset:${a}"`, `data-img-id="i2" src="asset:${n}"`))

  assert.equal(applyImageEdit(draft, b1.blockId, 'nope', n), null)
  assert.equal(applyImageEdit(draft, 'nope', 'i1', n), null)
  assert.equal(applyImageEdit(draft, b2.blockId, 'i2', n), null)
})

test('html: toFinalHtml은 data-img-id를 제거', () => {
  const a = randomUUID()
  const draft = sanitizeHtml(`<section><img src="asset:${a}" alt="x"></section>`)
  assert.ok(draft.includes('data-img-id'))
  const fin = toFinalHtml(draft, () => 'https://img.example/a.png')
  assert.equal(fin.includes('data-img-id'), false, fin)
  assert.deepEqual(imgSrcs(fin), ['https://img.example/a.png'])
})

// ---- GET /api/projects/:id/assets ----

test('assets 목록: [{id, thumbnail}]만, thumbnail = 프리뷰 사본 webp data URI, created_at·id 순', async () => {
  const u = await createUser()
  const { id, ids } = await projectWithImages(u, 3)
  // 정렬 확인: ids[2]가 가장 이르고, ids[0]·ids[1]은 같은 시각(id 순)
  await pool.query("UPDATE assets SET created_at = now() - interval '1 hour' WHERE id = $1", [ids[2]])
  await pool.query('UPDATE assets SET created_at = now() WHERE id = ANY($1)', [[ids[0], ids[1]]])
  const tie = [ids[0], ids[1]].sort()

  const r = await listAssets(u.token, id)
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body.map((a) => a.id), [ids[2], ...tie])
  const keys = (await pool.query('SELECT id, original_key, preview_key FROM assets WHERE project_id = $1', [id])).rows
  for (const a of r.body) {
    assert.deepEqual(Object.keys(a).sort(), ['id', 'thumbnail'])
    assert.match(a.thumbnail, /^data:image\/webp;base64,/)
    const k = keys.find((x) => x.id === a.id)
    assert.equal(a.thumbnail, `data:image/webp;base64,${(await storage.get('private', k.preview_key)).toString('base64')}`)
  }
  for (const s of ['orig/', 'prev/', 'asset:', ...keys.flatMap((k) => [k.original_key, k.preview_key])]) {
    assert.equal(r.text.includes(s), false, s)
  }
})

test('assets 목록: 이미지 없음 → [], 남의 프로젝트·잘못된 id → 404, 자격 무관·PUBLISHED도 200', async () => {
  const u = await createUser()
  const other = await createUser()
  const empty = await insertProject(u.userId)
  const e = await listAssets(u.token, empty)
  assert.equal(e.status, 200, e.text)
  assert.deepEqual(e.body, [])

  const { id } = await projectWithImages(u, 1)
  assertError(await listAssets(other.token, id), 404, 'NOT_FOUND')
  assertError(await listAssets(u.token, 'not-a-uuid'), 404, 'NOT_FOUND')
  assertError(await listAssets(u.token, randomUUID()), 404, 'NOT_FOUND')

  await publishedSql(id)
  const pub = await listAssets(u.token, id)
  assert.equal(pub.status, 200, pub.text)
  assert.equal(pub.body.length, 1)

  await pool.query('UPDATE users SET email_verified = false WHERE id = $1', [u.userId])
  await pool.query('UPDATE credit_wallets SET topup_balance = 0 WHERE user_id = $1', [u.userId])
  assert.equal((await listAssets(u.token, id)).status, 200)
})

// ---- POST /api/projects/:id/image-edits ----

test('image-edits 성공: version+1, EDITING, draft의 해당 img src만 교체, edit_operations MANUAL 1행, 프리뷰 반영', async () => {
  const u = await createUser()
  const { id, ids, draft, target } = await projectWithImages(u, 3)
  const thumbs = new Map((await listAssets(u.token, id)).body.map((a) => [a.id, a.thumbnail]))

  const r = await imageEdit(u.token, id, { ...target, assetId: ids[2], version: 1 })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.version, 2)
  for (const k of ['draftHtml', 'finalHtml']) assert.equal(k in r.body, false, k)

  const p = await row(id)
  assert.equal(p.status, 'EDITING')
  assert.equal(p.version, 2)
  assert.equal(p.active_job_type, null)
  const [b1, b2] = extractBlocks(p.draft_html)
  const [d1, d2] = extractBlocks(draft)
  assert.deepEqual(b1.images, [d1.images[0], { imageId: target.imageId, assetId: ids[2], widthPct: 100, align: 'center' }])
  assert.deepEqual(b1.fields, d1.fields)
  assert.deepEqual(b2, d2)

  assert.deepEqual(r.body.blocks, extractBlocks(p.draft_html))
  assert.deepEqual(imgSrcs(r.body.html), [thumbs.get(ids[0]), thumbs.get(ids[2])])
  assert.equal(cheerio.load(r.body.html, null, false)('[data-watermark="overlay"]').length, 1)

  assert.deepEqual(await ops(id), [{ type: 'MANUAL', block_id: target.blockId, payload: { imageId: target.imageId, assetId: ids[2] } }])

  // EDITING에서 이어서 교체 가능(무료·무제한). draft에 이미 있는 asset으로 되돌리기도 허용
  const again = await imageEdit(u.token, id, { ...target, assetId: ids[1], version: 2 })
  assert.equal(again.status, 200, again.text)
  assert.equal(again.body.version, 3)
  assert.equal((await row(id)).draft_html, draft)
})

test('image-edits: body 형식 오류 → 400(DB 조회 전: 남의 프로젝트여도 400)', async () => {
  const u = await createUser()
  const other = await createUser()
  const { id, ids, target } = await projectWithImages(u, 3)
  const ok = { ...target, assetId: ids[2], version: 1 }
  const bad = [
    {}, { ...target, assetId: ids[2] }, { ...ok, extra: 1 }, { ...ok, editId: 'e1' },
    { ...ok, assetId: 'asset:' + ids[2] }, { ...ok, assetId: 'x'.repeat(36) }, { ...ok, assetId: 1 },
    { ...ok, imageId: '' }, { ...ok, imageId: 'i'.repeat(33) }, { ...ok, blockId: 1 },
    { ...ok, version: 0 }, { ...ok, version: '1' },
  ]
  for (const body of bad) {
    assertError(await imageEdit(u.token, id, body), 400, 'VALIDATION_FAILED')
    assertError(await imageEdit(other.token, id, body), 400, 'VALIDATION_FAILED')
  }
  assert.equal((await row(id)).version, 1)
  assert.equal((await ops(id)).length, 0)
})

test('image-edits: 다른 프로젝트 asset·없는 asset·없는 imageId·blockId → 400, draft·version 불변', async () => {
  const u = await createUser()
  const { id, draft, target, ids } = await projectWithImages(u, 3)
  const { ids: foreign } = await projectWithImages(u, 1) // 같은 사용자의 다른 프로젝트 asset
  const before = await row(id)

  assertError(await imageEdit(u.token, id, { ...target, assetId: foreign[0], version: 1 }), 400, 'VALIDATION_FAILED')
  assertError(await imageEdit(u.token, id, { ...target, assetId: randomUUID(), version: 1 }), 400, 'VALIDATION_FAILED')
  assertError(await imageEdit(u.token, id, { ...target, imageId: 'nope', assetId: ids[2], version: 1 }), 400, 'VALIDATION_FAILED')
  assertError(await imageEdit(u.token, id, { ...target, blockId: 'nope', assetId: ids[2], version: 1 }), 400, 'VALIDATION_FAILED')
  const [, b2] = extractBlocks(draft)
  assertError(await imageEdit(u.token, id, { blockId: b2.blockId, imageId: target.imageId, assetId: ids[2], version: 1 }), 400, 'VALIDATION_FAILED')

  assert.deepEqual(await row(id), before)
  assert.equal((await ops(id)).length, 0)
})

test('image-edits: 404 → PUBLISHED 409 → 403 → 402 → 상태 409 → version 409 → 작업 409', async () => {
  const u = await createUser()
  const other = await createUser()
  const { id, ids, target } = await projectWithImages(u, 3)
  const body = (version = 1, assetId = ids[2]) => ({ ...target, assetId, version })

  assertError(await imageEdit(other.token, id, body()), 404, 'NOT_FOUND')
  assertError(await imageEdit(u.token, 'not-a-uuid', body()), 404, 'NOT_FOUND')
  assertError(await imageEdit(u.token, id, body(2)), 409, 'VERSION_CONFLICT')

  const busy = await projectWithImages(u, 3)
  await pool.query("UPDATE projects SET active_job_type = 'REGEN', active_job_started_at = now() WHERE id = $1", [busy.id])
  assertError(await imageEdit(u.token, busy.id, { ...busy.target, assetId: busy.ids[2], version: 1 }), 409, 'JOB_IN_PROGRESS')

  const draftState = await projectWithImages(u, 3)
  await pool.query("UPDATE projects SET status = 'DRAFT' WHERE id = $1", [draftState.id])
  assertError(await imageEdit(u.token, draftState.id, { ...draftState.target, assetId: draftState.ids[2], version: 1 }), 409, 'INVALID_STATE')

  const pub = await projectWithImages(u, 3)
  await publishedSql(pub.id)
  assertError(await imageEdit(u.token, pub.id, { ...pub.target, assetId: pub.ids[2], version: 1 }), 409, 'INVALID_STATE')

  // PUBLISHED는 자격보다 먼저(잔액 0이어도 409)
  await pool.query('UPDATE credit_wallets SET topup_balance = 0 WHERE user_id = $1', [u.userId])
  assertError(await imageEdit(u.token, pub.id, { ...pub.target, assetId: pub.ids[2], version: 1 }), 409, 'INVALID_STATE')
  assertError(await imageEdit(u.token, id, body()), 402, 'INSUFFICIENT_CREDIT')
  await pool.query('UPDATE users SET email_verified = false WHERE id = $1', [u.userId])
  assertError(await imageEdit(u.token, id, body()), 403, 'EMAIL_NOT_VERIFIED')

  assert.equal((await one('SELECT count(*)::int AS c FROM edit_operations')).c, 0)
  assert.equal((await row(id)).version, 1)
})
