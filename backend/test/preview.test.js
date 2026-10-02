import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as cheerio from 'cheerio'
import sharp from 'sharp'
import { pool } from '../src/db.js'
import { sanitizeHtml } from '../src/lib/html.js'
import { grantTopup } from '../src/services/credits.js'
import {
  truncateAll, createUser, insertProject, startServer, api, generateViaApi, deepKeys, VALID_FORM,
  makeImage, upload, clearStorage, storageDir,
} from './helpers.js'

// HTTP 로그인은 이 파일에서 1회(BE-10a ④)
const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})

const DRAFT = sanitizeHtml('<section><h2>제목</h2><p>본문</p></section><section><h3>사용</h3><p>설명</p></section><div><p>끝</p></div>')
const preview = (token, id, qs = '') => api(base, `/api/projects/${id}/preview${qs}`, { token })
const load = (html) => cheerio.load(html, null, false)
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}

// 오버레이 1 + 블록마다 1(계약 3.1 워터마크 판정)
function assertWatermarked(html) {
  const $ = load(html)
  assert.equal($('[data-watermark="overlay"]').length, 1, html)
  const blocks = $.root().children().first().children('[data-block-id]').toArray()
  assert.ok(blocks.length > 0, html)
  assert.equal($('[data-watermark="block"]').length, blocks.length)
  for (const b of blocks) assert.equal($(b).children('[data-watermark="block"]').length, 1)
}

test('BE-10a ① AC-BR51: 어떤 쿼리 파라미터를 줘도 워터마크 포함(같은 결과)', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId, { status: 'GENERATED', version: 2, draftHtml: DRAFT })
  const plain = await preview(u.token, id)
  assert.equal(plain.status, 200, plain.text)
  for (const qs of ['?watermark=0&raw=1&preview=false', '?watermark=false', '?raw=true&final=1']) {
    const r = await preview(u.token, id, qs)
    assert.equal(r.status, 200)
    assert.equal(r.body.html, plain.body.html)
    assertWatermarked(r.body.html)
  }
})

test('BE-10a ② AC-BR54: 오버레이 1개 + 블록별 워터마크, version 포함, 저장 안 함', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId, { status: 'GENERATED', version: 2, draftHtml: DRAFT })
  const r = await preview(u.token, id)
  assert.equal(r.body.version, 2)
  assertWatermarked(r.body.html)
  assert.equal(load(r.body.html)('[data-watermark="block"]').length, 3)
  assert.equal((await pool.query('SELECT draft_html FROM projects WHERE id = $1', [id])).rows[0].draft_html, DRAFT)
})

test('BE-10a ③ 프리뷰 응답에 finalHtml 키·http(s) 이미지·원본/프리뷰 키 0건', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId, { status: 'GENERATED', draftHtml: DRAFT })
  await pool.query("UPDATE projects SET final_html = 'FINAL_SENTINEL' WHERE id = $1", [id])
  await pool.query(
    "INSERT INTO assets (project_id, original_key, preview_key, mime, size) VALUES ($1, 'orig/x/a.png', 'prev/x/a.webp', 'image/png', 1)", [id])
  const r = await preview(u.token, id)
  assert.equal(r.status, 200)
  const keys = deepKeys(r.body)
  for (const k of ['finalHtml', 'final_html', 'draftHtml', 'originalKey', 'previewKey']) assert.equal(keys.has(k), false, k)
  for (const s of ['FINAL_SENTINEL', 'orig/', 'prev/']) assert.equal(r.text.includes(s), false, s)
  load(r.body.html)('img').each((_, el) => assert.ok(!/^https?:/i.test(el.attribs.src ?? ''), el.attribs.src))
})

test('BE-10a 추가: 생성 전 409 INVALID_STATE, 다른 사용자 404, 잔액 0이어도 200(자격 무관)', async () => {
  const u = await createUser({ balance: 0 })
  const other = await createUser()
  assertError(await preview(u.token, await insertProject(u.userId)), 409, 'INVALID_STATE')
  const id = await insertProject(u.userId, { status: 'GENERATED', draftHtml: DRAFT })
  assertError(await preview(other.token, id), 404, 'NOT_FOUND')
  assertError(await preview(u.token, 'not-a-uuid'), 404, 'NOT_FOUND')
  assert.equal((await preview(u.token, id)).status, 200)
})

test('BE-10a ④ M1 스모크: 가입 → 지급 → 로그인 → 폼으로 프로젝트 생성 → 생성 → 프리뷰', async () => {
  const email = `m1-${Date.now()}@test.com`
  const password = 'password123'
  assert.equal((await api(base, '/api/auth/signup', { method: 'POST', body: { email, password } })).status, 201)
  await grantTopup(email, 1)
  const login = await api(base, '/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(login.status, 200)
  const token = login.body.accessToken

  const p = await api(base, '/api/projects', { method: 'POST', token, body: { form: VALID_FORM } })
  assert.equal(p.status, 201, p.text)
  assert.equal((await upload(base, token, p.body.id, await makeImage())).status, 201) // BE-09b: 이미지 필수
  const g = await generateViaApi(base, token, p.body.id, p.body.version)
  assert.equal(g.status, 200, g.text)
  const r = await preview(token, p.body.id)
  assert.equal(r.status, 200)
  assert.equal(r.body.version, g.body.version)
  assertWatermarked(r.body.html)
  assert.ok(r.body.html.includes('핵심 특징'))
})

// ---- BE-10b ----

// DEC-01, AC-BR50: 모든 img가 data URI 프리뷰 사본(webp, 폭 ≤ 390). 이미지 수 반환
async function assertDataUriImages(html) {
  const srcs = load(html)('img').toArray().map((el) => el.attribs.src ?? '')
  for (const src of srcs) {
    assert.match(src, /^data:image\/webp;base64,/, src.slice(0, 40))
    const meta = await sharp(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')).metadata()
    assert.equal(meta.format, 'webp')
    assert.ok(meta.width <= 390, String(meta.width))
  }
  return srcs.length
}

// 응답 blocks에서 images를 뺀 것(images는 src가 data URI로 바뀌어 HTML에서 assetId를 알 수 없음)
const fieldsOnly = (blocks) => blocks.map(({ blockId, fields }) => ({ blockId, fields }))

// 응답 HTML에서 기대 blocks를 직접 추출(DEC-08)
function blocksOf(html) {
  const $ = load(html)
  return $.root().children().first().children('[data-block-id]').toArray().map((b) => ({
    blockId: b.attribs['data-block-id'],
    fields: $(b).find('[data-edit-id]').addBack('[data-edit-id]').toArray()
      .map((e) => ({ editId: e.attribs['data-edit-id'], text: $(e).text() })),
  }))
}

async function uploadedProject(u, images) {
  const id = await insertProject(u.userId)
  const assetIds = []
  for (const buf of images) {
    const r = await upload(base, u.token, id, buf)
    assert.equal(r.status, 201, r.text)
    assetIds.push(r.body.id)
  }
  return { id, assetIds }
}

test('BE-10b ① [P0] AC-BR50, DEC-01: 프리뷰 img는 모두 data URI(폭 ≤ 390), 원본·프리뷰 키·http(s) img·스토리지 경로 0건', async () => {
  const u = await createUser()
  const { id } = await uploadedProject(u, [await makeImage({ width: 1200, height: 900 }), await makeImage({ width: 1000, height: 1000 })])
  const g = await generateViaApi(base, u.token, id, 1)
  assert.equal(g.status, 200, g.text)
  const p = await preview(u.token, id)
  assert.equal(p.status, 200)

  const keys = (await pool.query('SELECT original_key, preview_key FROM assets WHERE project_id = $1', [id])).rows
  assert.equal(keys.length, 2)
  const dir = await storageDir()
  for (const r of [g, p]) {
    assert.equal(await assertDataUriImages(r.body.html), 2)
    for (const s of ['orig/', 'prev/', 'asset:', dir, JSON.stringify(dir).slice(1, -1), ...keys.flatMap((k) => [k.original_key, k.preview_key])]) {
      assert.equal(r.text.includes(s), false, s)
    }
    load(r.body.html)('img').each((_, el) => assert.ok(!/^https?:/i.test(el.attribs.src), el.attribs.src))
    assertWatermarked(r.body.html)
  }
})

test('BE-10b ① 추가: assets에 없는 asset 참조는 img 제거', async () => {
  const u = await createUser()
  const draftHtml = sanitizeHtml(`<section><h2>제목</h2><img src="asset:${randomUUID()}" alt=""></section>`)
  assert.ok(draftHtml.includes('asset:'))
  const id = await insertProject(u.userId, { status: 'GENERATED', draftHtml })
  const r = await preview(u.token, id)
  assert.equal(r.status, 200, r.text)
  assert.equal(load(r.body.html)('img').length, 0)
  assert.equal(r.text.includes('asset:'), false)
})

test('BE-10b ② DEC-08: blocks = 프리뷰 HTML의 data-block-id·data-edit-id, text는 현재 텍스트', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId, { status: 'GENERATED', version: 2, draftHtml: DRAFT })
  const r = await preview(u.token, id)
  assert.equal(r.status, 200)
  assert.deepEqual(fieldsOnly(r.body.blocks), blocksOf(r.body.html))
  assert.deepEqual(r.body.blocks.map((b) => b.fields.length), [2, 2, 1])
  assert.deepEqual(r.body.blocks.flatMap((b) => b.fields.map((f) => f.text)), ['제목', '본문', '사용', '설명', '끝'])

  // draft가 바뀌면 text도 현재값
  await pool.query("UPDATE projects SET draft_html = replace(draft_html, '>본문<', '>바뀐 본문<') WHERE id = $1", [id])
  const after = await preview(u.token, id)
  assert.deepEqual(fieldsOnly(after.body.blocks), blocksOf(after.body.html))
  assert.equal(after.body.blocks[0].fields[1].text, '바뀐 본문')
  assert.equal(after.body.blocks[0].fields[1].editId, r.body.blocks[0].fields[1].editId)
})

test('BE-10b ③ 이미지 10장(1200×1600 노이즈) 프리뷰 응답 크기 측정', async (t) => {
  const u = await createUser()
  const img = await makeImage({ width: 1200, height: 1600, format: 'jpeg', noise: true })
  const { id } = await uploadedProject(u, Array(10).fill(img))
  assert.equal((await generateViaApi(base, u.token, id, 1)).status, 200)
  const r = await preview(u.token, id)
  assert.equal(r.status, 200)
  assert.equal(await assertDataUriImages(r.body.html), 10)
  t.diagnostic(`BE-10b ③ preview response bytes=${Buffer.byteLength(r.text)} (images=10, 1200x1600 synthetic gaussian-noise jpeg ${img.length} bytes each)`)
})

test('BE-10b ④ 스모크: 폼으로 프로젝트 생성 → 업로드 → 생성 → 프리뷰(data URI 이미지·blocks)', async () => {
  const u = await createUser()
  const p = await api(base, '/api/projects', { method: 'POST', token: u.token, body: { form: VALID_FORM } })
  assert.equal(p.status, 201, p.text)
  const a = await upload(base, u.token, p.body.id, await makeImage({ width: 1200, height: 800 }))
  assert.equal(a.status, 201, a.text)

  const g = await generateViaApi(base, u.token, p.body.id, p.body.version)
  assert.equal(g.status, 200, g.text)
  assert.deepEqual(fieldsOnly(g.body.blocks), blocksOf(g.body.html))
  assert.deepEqual(g.body.blocks.map((b) => b.fields.length), [2, 2, 1]) // MOCK_MAIN_HTML(계약 3.1)

  // BE-09b: draft에 업로드한 이미지 참조(asset:ID)
  const draft = (await pool.query('SELECT draft_html FROM projects WHERE id = $1', [p.body.id])).rows[0].draft_html
  assert.ok(draft.includes(`src="asset:${a.body.id}"`), draft)

  const r = await preview(u.token, p.body.id)
  assert.equal(r.status, 200)
  assert.equal(r.body.version, g.body.version)
  assert.equal(r.body.html, g.body.html)
  assert.deepEqual(r.body.blocks, g.body.blocks)
  assertWatermarked(r.body.html)
  assert.equal(await assertDataUriImages(r.body.html), 1)
})
