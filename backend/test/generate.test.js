import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { roleModels, parseModel } from '../src/llm/index.js'
import {
  truncateAll, createUser, insertProject, startServer, api, generateViaApi, VALID_FORM,
  makeImage, upload, clearStorage, insertAssetRow,
} from './helpers.js'

const { base, close } = await startServer()
const originalModels = { ...roleModels }
const PNG = await makeImage()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})
afterEach(() => Object.assign(roleModels, originalModels))

const row = async (id) => (await pool.query('SELECT * FROM projects WHERE id = $1', [id])).rows[0]
const usage = async () => (await pool.query('SELECT role, project_id, success FROM llm_usage_logs')).rows
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
// BE-09b: 생성에는 이미지 1장 이상이 필수
async function withImage(u, opts) {
  const id = await insertProject(u.userId, opts)
  assert.equal((await upload(base, u.token, id, PNG)).status, 201)
  return id
}

test('BE-09a ① AC-BR25: selectedUsps=[]로 DRAFT → GENERATED, version+1, 응답은 워터마크 프리뷰', async () => {
  const u = await createUser()
  const id = await withImage(u)
  assert.deepEqual((await row(id)).selected_usps, [])

  const r = await generateViaApi(base, u.token, id, 1)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.version, 2)
  assert.equal(cheerio.load(r.body.html, null, false)('[data-watermark="overlay"]').length, 1)

  const p = await row(id)
  assert.equal(p.status, 'GENERATED')
  assert.equal(p.version, 2)
  assert.ok(p.draft_html)
  assert.deepEqual(await usage(), [{ role: 'MAIN', project_id: id, success: true }])
})

test('BE-09a ② AC-BR35: 텍스트 필수값 누락·범위 밖 → 400, LLM 호출 0회, 상태 불변', async () => {
  const u = await createUser()
  const forms = [
    {},
    { ...VALID_FORM, productName: '   ' },
    { ...VALID_FORM, category: undefined },
    { ...VALID_FORM, intro: '123456789' }, // 9자
    { ...VALID_FORM, intro: 'a'.repeat(1001) },
  ]
  for (const form of forms) {
    const id = await insertProject(u.userId, { form })
    await insertAssetRow(id) // 이미지 조건은 채워 텍스트 필수값만 검사
    assertError(await generateViaApi(base, u.token, id, 1), 400, 'VALIDATION_FAILED')
    const p = await row(id)
    assert.equal(p.status, 'DRAFT')
    assert.equal(p.version, 1)
    assert.equal(p.draft_html, null)
  }
  assert.equal((await usage()).length, 0)
})

test('BE-09a ③ FR-14: 저장된 draft_html에 script·link·style·class 0, 모든 섹션 data-block-id', async () => {
  const u = await createUser()
  const id = await withImage(u)
  assert.equal((await generateViaApi(base, u.token, id, 1)).status, 200)

  const html = (await row(id)).draft_html
  const $ = cheerio.load(html, null, false)
  assert.equal($('script, link, style').length, 0, html)
  assert.equal($('[class]').length, 0, html)
  $('*').each((_, el) => {
    for (const name of Object.keys(el.attribs)) assert.ok(!name.startsWith('on'), name)
  })
  const roots = $.root().children()
  assert.equal(roots.length, 1)
  const blocks = roots.first().children().toArray()
  assert.equal(blocks.length, 3) // MOCK_MAIN_HTML 정제 결과(계약 3.1)
  const ids = blocks.map((b) => b.attribs['data-block-id'])
  for (const b of ids) assert.ok(b, html)
  assert.equal(new Set(ids).size, ids.length)
  $('section').each((_, el) => assert.ok(el.attribs['data-block-id'], html))
})

test('BE-09a ④ LY-03: LLM 대기 중 체크아웃된 DB 커넥션 0(withTx 안 callRole 없음)', async () => {
  roleModels.MAIN = parseModel('mock:delay:300')
  const u = await createUser()
  const id = await withImage(u)
  const pending = generateViaApi(base, u.token, id, 1)
  await sleep(150)
  assert.equal(pool.totalCount - pool.idleCount, 0)
  assert.equal((await pending).status, 200)
})

test('BE-09a 추가: 판정 순서·상태 오류(version 400, 404, 409, 502)', async () => {
  const u = await createUser()
  const other = await createUser()
  const id = await insertProject(u.userId)
  await insertAssetRow(id) // 이미지 조건 충족(아래 409·502 경로는 프리뷰까지 가지 않음)

  for (const body of [{}, { version: 0 }, { version: '1' }]) {
    assertError(await api(base, `/api/projects/${id}/generate`, { method: 'POST', token: u.token, body }), 400, 'VALIDATION_FAILED')
  }
  assertError(await generateViaApi(base, other.token, id, 1), 404, 'NOT_FOUND')
  assertError(await generateViaApi(base, u.token, 'not-a-uuid', 1), 404, 'NOT_FOUND')
  assertError(await generateViaApi(base, u.token, id, 2), 409, 'VERSION_CONFLICT')

  // version 확인이 필수값 검사보다 먼저
  const empty = await insertProject(u.userId, { form: {} })
  assertError(await generateViaApi(base, u.token, empty, 9), 409, 'VERSION_CONFLICT')

  const generated = await insertProject(u.userId, { status: 'GENERATED', draftHtml: '<div></div>' })
  await insertAssetRow(generated)
  assertError(await generateViaApi(base, u.token, generated, 1), 409, 'INVALID_STATE')

  const busy = await insertProject(u.userId, { activeJobType: 'ANALYZE' })
  await insertAssetRow(busy)
  assertError(await generateViaApi(base, u.token, busy, 1), 409, 'JOB_IN_PROGRESS')

  const published = await insertProject(u.userId)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [published])
  assertError(await generateViaApi(base, u.token, published, 1), 409, 'INVALID_STATE')

  assert.equal((await usage()).length, 0)

  roleModels.MAIN = parseModel('mock:fail')
  assertError(await generateViaApi(base, u.token, id, 1), 502, 'UPSTREAM_FAILED')
  const p = await row(id)
  assert.equal(p.status, 'DRAFT')
  assert.equal(p.version, 1)
  assert.equal(p.draft_html, null)
})

test('BE-09a 추가: ANALYZED + selectedUsps 있는 프로젝트도 GENERATED', async () => {
  const u = await createUser()
  const id = await withImage(u, { status: 'ANALYZED' })
  await pool.query(`UPDATE projects SET selected_usps = '["가벼운 무게"]' WHERE id = $1`, [id])
  assert.equal((await generateViaApi(base, u.token, id, 1)).status, 200)
  assert.equal((await row(id)).status, 'GENERATED')
})
