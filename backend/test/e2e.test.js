import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { sanitizeHtml, extractBlocks } from '../src/lib/html.js'
import { crawler } from '../src/lib/crawler.js'
import { MOCK_USPS } from '../src/llm/index.js'
import { grantTopup } from '../src/services/credits.js'
import { PUBLIC_IMAGE_BASE_URL, S3_ENDPOINT } from '../src/config.js'
import {
  truncateAll, createUser, insertProject, startServer, api, deepKeys, VALID_FORM, makeImage, upload, clearStorage, storageDir,
} from './helpers.js'

// HTTP 로그인은 이 파일에서 1회(BE-15 ①)
const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})

const URL_OK = 'https://www.coupang.com/vp/products/7654321'
const PAGE = { text: '무선 청소기 상품 페이지. 리뷰: 가볍고 흡입력이 좋아요.' }
const DRAFT = sanitizeHtml('<section><h2>제목</h2><p>본문</p></section>')
const [BLOCK] = extractBlocks(DRAFT)
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const deducts = async () => (await one("SELECT count(*)::int AS c FROM credit_ledger WHERE reason = 'DEDUCT'")).c
const imgSrcs = (html) => cheerio.load(html, null, false)('img').toArray().map((el) => el.attribs.src ?? '')
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
const ok = (r, status = 200) => {
  assert.equal(r.status, status, r.text)
  return r
}

test('BE-15 ① [P0] PRD-V-4, AC-BR32, AC-BR53: 가입 → 지급 → 로그인 → 프로젝트 → 업로드 → 분석 → USP → 생성 → 프리뷰 → 편집 → 재생성 → 퍼블리시 → final. 퍼블리시 전 모든 응답에 원본 키·버킷 호스트·finalHtml 0건', async (t) => {
  t.mock.method(console, 'log', () => {})
  const crawl = t.mock.method(crawler, 'crawl', async () => PAGE)
  const pre = [] // 퍼블리시 전 모든 응답
  const call = async (path, opts) => {
    const r = await api(base, path, opts)
    pre.push({ path, r })
    return r
  }

  // 가입 → 미인증·잔액 0이라 프로젝트 생성 403
  const email = `e2e-${Date.now()}@test.com`
  const password = 'password123'
  const signup = ok(await call('/api/auth/signup', { method: 'POST', body: { email, password } }), 201)
  assert.deepEqual(ok(await call('/api/me', { token: signup.body.accessToken })).body, { email, emailVerified: false, balance: 0 })
  assertError(await call('/api/projects', { method: 'POST', token: signup.body.accessToken, body: { form: VALID_FORM } }), 403, 'EMAIL_NOT_VERIFIED')

  // 지급(운영자) → 로그인
  await grantTopup(email, 1)
  const login = ok(await call('/api/auth/login', { method: 'POST', body: { email, password } }))
  const token = login.body.accessToken
  assert.deepEqual(ok(await call('/api/me', { token })).body, { email, emailVerified: true, balance: 1 })

  // 프로젝트 → 업로드 2장
  const project = ok(await call('/api/projects', { method: 'POST', token, body: { form: VALID_FORM } }), 201)
  const id = project.body.id
  const P = `/api/projects/${id}`
  const images = [
    [await makeImage({ width: 1200, height: 900 }), undefined],
    [await makeImage({ format: 'jpeg' }), { filename: 'a.jpg', type: 'image/jpeg' }],
  ]
  for (const [buf, opts] of images) {
    const a = ok(await upload(base, token, id, buf, opts), 201)
    pre.push({ path: `${P}/assets`, r: a })
    assert.deepEqual(Object.keys(a.body), ['id'])
  }

  // 분석(대체 크롤러) → USP 선택
  const analysis = ok(await call(`${P}/analyze`, { method: 'POST', token, body: { url: `${URL_OK}?itemId=1`, version: 1 } }))
  assert.equal(crawl.mock.callCount(), 1)
  assert.deepEqual(analysis.body.uspCandidates, MOCK_USPS)
  const afterAnalyze = ok(await call(P, { token }))
  assert.equal(afterAnalyze.body.status, 'DRAFT')
  const usps = ok(await call(`${P}/usps`, { method: 'PUT', token, body: { selectedUsps: [MOCK_USPS[0]], version: afterAnalyze.body.version } }))
  assert.equal(usps.body.status, 'ANALYZED')

  // 생성 → 프리뷰 → 편집 → 재생성 → 프리뷰
  const gen = ok(await call(`${P}/generate`, { method: 'POST', token, body: { version: usps.body.version } }))
  ok(await call(`${P}/preview?raw=1&watermark=0`, { token }))
  const target = gen.body.blocks[0]
  const EDITED = 'E2E_EDITED_TEXT'
  const edited = ok(await call(`${P}/edits`, {
    method: 'POST', token, body: { blockId: target.blockId, editId: target.fields[0].editId, text: EDITED, version: gen.body.version },
  }))
  assert.equal(edited.body.blocks[0].fields[0].text, EDITED)
  const regen = ok(await call(`${P}/regenerate`, { method: 'POST', token, body: { version: edited.body.version } }))
  assert.equal(regen.text.includes(EDITED), false) // BR-34: 재생성은 수동 편집 초기화
  ok(await call(`${P}/preview`, { token }))
  ok(await call('/api/projects', { token }))
  const detail = ok(await call(P, { token }))
  assert.equal(detail.body.status, 'GENERATED')

  // ---- 퍼블리시 전 응답 전수 검사 ----
  const keys = (await pool.query('SELECT original_key, preview_key FROM assets WHERE project_id = $1', [id])).rows
  assert.equal(keys.length, 2)
  const dir = await storageDir()
  const forbidden = [
    'orig/', 'prev/', 'asset:', dir, JSON.stringify(dir).slice(1, -1), PUBLIC_IMAGE_BASE_URL, ...(S3_ENDPOINT ? [S3_ENDPOINT] : []),
    '"finalHtml"', '"final_html"', '"draftHtml"', '"draft_html"', ...keys.flatMap((k) => [k.original_key, k.preview_key]),
  ]
  for (const { path, r } of pre) {
    for (const s of forbidden) assert.equal(r.text.includes(s), false, `${path}: ${s}`)
    for (const k of ['finalHtml', 'draftHtml', 'originalKey', 'previewKey', 'publicKey']) assert.equal(deepKeys(r.body).has(k), false, `${path}: ${k}`)
    if (typeof r.body?.html === 'string') {
      // 프리뷰 이미지는 data URI만, 워터마크 포함
      const srcs = imgSrcs(r.body.html)
      assert.equal(srcs.length, 2, path)
      for (const src of srcs) assert.match(src, /^data:image\/webp;base64,/, path)
      assert.equal(cheerio.load(r.body.html, null, false)('[data-watermark="overlay"]').length, 1, path)
    }
  }
  assert.equal(pre.filter(({ r }) => typeof r.body?.html === 'string').length, 5) // generate, preview, edits, regenerate, preview

  // 퍼블리시 → final
  const pub = ok(await api(base, `${P}/publish`, { method: 'POST', token, body: { version: regen.body.version } }))
  const srcs = imgSrcs(pub.body.finalHtml)
  assert.equal(srcs.length, 2)
  for (const src of srcs) assert.ok(src.startsWith(`${PUBLIC_IMAGE_BASE_URL}/`) && !src.includes('?'), src)
  for (const s of ['data-watermark', 'PREVIEW ONLY', 'data-edit-id', 'data-block-id', 'orig/', 'prev/', 'asset:', EDITED]) {
    assert.equal(pub.body.finalHtml.includes(s), false, s)
  }
  assert.ok(pub.body.finalHtml.includes('핵심 특징'))
  const fin = ok(await api(base, `${P}/final`, { token }))
  assert.equal(fin.body.finalHtml, pub.body.finalHtml)
  assert.deepEqual(ok(await api(base, '/api/me', { token })).body, { email, emailVerified: true, balance: 0 })
  assert.equal(await deducts(), 1)
  assert.equal(crawl.mock.callCount(), 1)
})

test('BE-15 ② FR-06: 퍼블리시 후 잔액 0 → me·목록·상세·final 200, 편집 등 쓰기 409, 퍼블리시 재요청 200(추가 차감 0)', async () => {
  const u = await createUser({ balance: 1 })
  const id = await insertProject(u.userId, { status: 'GENERATED', draftHtml: DRAFT })
  const P = `/api/projects/${id}`
  const pub = ok(await api(base, `${P}/publish`, { method: 'POST', token: u.token, body: { version: 1 } }))

  assert.equal(ok(await api(base, '/api/me', { token: u.token })).body.balance, 0)
  const list = ok(await api(base, '/api/projects', { token: u.token }))
  assert.deepEqual(list.body.map((p) => [p.id, p.status]), [[id, 'PUBLISHED']])
  assert.equal(ok(await api(base, P, { token: u.token })).body.status, 'PUBLISHED')
  assert.equal(ok(await api(base, `${P}/final`, { token: u.token })).body.finalHtml, pub.body.finalHtml)

  const editBody = { blockId: BLOCK.blockId, editId: BLOCK.fields[0].editId, text: 'x', version: 2 }
  assertError(await api(base, `${P}/edits`, { method: 'POST', token: u.token, body: editBody }), 409, 'INVALID_STATE')
  assertError(await api(base, `${P}/regenerate`, { method: 'POST', token: u.token, body: { version: 2 } }), 409, 'INVALID_STATE')
  assertError(await api(base, `${P}/form`, { method: 'PUT', token: u.token, body: { form: VALID_FORM, version: 2 } }), 409, 'INVALID_STATE')
  assertError(await upload(base, u.token, id, await makeImage()), 409, 'INVALID_STATE')

  const again = ok(await api(base, `${P}/publish`, { method: 'POST', token: u.token, body: { version: 99 } }))
  assert.equal(again.body.finalHtml, pub.body.finalHtml)
  assert.equal(await deducts(), 1)
  assert.equal(ok(await api(base, '/api/me', { token: u.token })).body.balance, 0)
  assertError(await api(base, '/api/projects', { method: 'POST', token: u.token, body: { form: VALID_FORM } }), 402, 'INSUFFICIENT_CREDIT')
})

test('BE-15 추가: 자격 통합 — 쓰기 API 전부 미인증 403(잔액 0이어도)·잔액 0은 402, 읽기 API는 자격 무관 200, 부수 효과 0', async (t) => {
  const crawl = t.mock.method(crawler, 'crawl', async () => PAGE)
  const img = await makeImage()
  const writes = (token, id) => {
    const P = `/api/projects/${id}`
    const post = (path, body) => api(base, path, { method: 'POST', token, body })
    return {
      create: () => post('/api/projects', { form: VALID_FORM }),
      form: () => api(base, `${P}/form`, { method: 'PUT', token, body: { form: VALID_FORM, version: 1 } }),
      upload: () => upload(base, token, id, img),
      analyze: () => post(`${P}/analyze`, { url: URL_OK, version: 1 }),
      usps: () => api(base, `${P}/usps`, { method: 'PUT', token, body: { selectedUsps: [MOCK_USPS[0]], version: 1 } }),
      generate: () => post(`${P}/generate`, { version: 1 }),
      regenerate: () => post(`${P}/regenerate`, { version: 1 }),
      edits: () => post(`${P}/edits`, { blockId: BLOCK.blockId, editId: BLOCK.fields[0].editId, text: 'x', version: 1 }),
      publish: () => post(`${P}/publish`, { version: 1 }),
    }
  }

  const cases = [
    [await createUser({ verified: false, balance: 0 }), 403, 'EMAIL_NOT_VERIFIED'],
    [await createUser({ verified: false, balance: 3 }), 403, 'EMAIL_NOT_VERIFIED'],
    [await createUser({ balance: 0 }), 402, 'INSUFFICIENT_CREDIT'],
  ]
  for (const [u, status, code] of cases) {
    const id = await insertProject(u.userId, { status: 'GENERATED', draftHtml: DRAFT })
    for (const [name, fn] of Object.entries(writes(u.token, id))) {
      const r = await fn()
      assert.equal(r.status, status, `${name}: ${r.text}`)
      assert.equal(r.body.error.code, code, name)
    }
    for (const path of ['/api/me', '/api/projects', `/api/projects/${id}`, `/api/projects/${id}/preview`]) {
      assert.equal((await api(base, path, { token: u.token })).status, 200, path)
    }
    assert.deepEqual(await one('SELECT status, version, draft_html FROM projects WHERE id = $1', [id]), { status: 'GENERATED', version: 1, draft_html: DRAFT })
  }

  assert.equal((await one('SELECT count(*)::int AS c FROM projects')).c, cases.length)
  for (const table of ['assets', 'analysis_results', 'edit_operations', 'publish_records', 'llm_usage_logs']) {
    assert.equal((await one(`SELECT count(*)::int AS c FROM ${table}`)).c, 0, table)
  }
  assert.equal(await deducts(), 0)
  assert.equal(crawl.mock.callCount(), 0)
})
