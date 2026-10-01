import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../src/db.js'
import { truncateAll, createUser, insertProject, startServer, api, deepKeys, VALID_FORM } from './helpers.js'

const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())

const create = (token, body = { form: VALID_FORM }) => api(base, '/api/projects', { method: 'POST', token, body })
const detail = (token, id) => api(base, `/api/projects/${id}`, { token })
const list = (token) => api(base, '/api/projects', { token })
const saveForm = (token, id, body) => api(base, `/api/projects/${id}/form`, { method: 'PUT', token, body })
const row = async (id) => (await pool.query('SELECT * FROM projects WHERE id = $1', [id])).rows[0]
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}

const FORBIDDEN_KEYS = ['draftHtml', 'finalHtml', 'originalKey', 'previewKey', 'draft_html', 'final_html', 'original_key', 'preview_key']
const FORBIDDEN_TEXT = ['DRAFT_SENTINEL', 'FINAL_SENTINEL', 'orig/', 'prev/']

test('BE-05a ① AC-BR38: 생성 응답 201, status DRAFT, version 1, form 저장', async () => {
  const u = await createUser()
  const r = await create(u.token)
  assert.equal(r.status, 201)
  assert.equal(r.body.status, 'DRAFT')
  assert.equal(r.body.version, 1)
  assert.deepEqual(r.body.form, VALID_FORM)
  const db = await row(r.body.id)
  assert.equal(db.user_id, u.userId)
  assert.deepEqual(db.form, VALID_FORM)

  const empty = await create(u.token, {}) // form은 선택(DEC-05)
  assert.equal(empty.status, 201)
  assert.deepEqual(empty.body.form, {})
})

test('BE-05a ② 상세 응답에 status·version·analyzeCount·regenCount·aiEditCount·aiEditFailCount·activeJobType', async () => {
  const u = await createUser()
  const id = (await create(u.token)).body.id
  const r = await detail(u.token, id)
  assert.equal(r.status, 200)
  assert.equal(r.body.id, id)
  const expected = { status: 'DRAFT', version: 1, analyzeCount: 0, regenCount: 0, aiEditCount: 0, aiEditFailCount: 0, activeJobType: null }
  for (const [k, v] of Object.entries(expected)) {
    assert.ok(Object.hasOwn(r.body, k), k)
    assert.equal(r.body[k], v, k)
  }
})

test('BE-05a ③ 생성·상세·목록 응답에 draftHtml·finalHtml·originalKey·previewKey 키 0건', async () => {
  const u = await createUser()
  const c = await create(u.token)
  const id = c.body.id
  await pool.query("UPDATE projects SET draft_html = '<div>DRAFT_SENTINEL</div>', final_html = 'FINAL_SENTINEL' WHERE id = $1", [id])
  await pool.query(
    "INSERT INTO assets (project_id, original_key, preview_key, mime, size) VALUES ($1, 'orig/x/a.png', 'prev/x/a.webp', 'image/png', 1)", [id])

  for (const r of [c, await detail(u.token, id), await list(u.token)]) {
    assert.ok(r.status < 300, r.text)
    const keys = deepKeys(r.body)
    for (const k of FORBIDDEN_KEYS) assert.equal(keys.has(k), false, k)
    for (const s of FORBIDDEN_TEXT) assert.equal(r.text.includes(s), false, s)
  }
})

test('BE-05a ④ 다른 사용자 프로젝트·없는 id·uuid 아닌 id → 404 NOT_FOUND', async () => {
  const owner = await createUser()
  const other = await createUser()
  const id = await insertProject(owner.userId)
  assertError(await detail(other.token, id), 404, 'NOT_FOUND')
  assertError(await detail(owner.token, randomUUID()), 404, 'NOT_FOUND')
  assertError(await detail(owner.token, 'not-a-uuid'), 404, 'NOT_FOUND')
  assert.equal((await detail(owner.token, id)).status, 200)
})

test('BE-05a 추가: 폼 형식 오류 → 400(객체 아님, 문자열 아님, 상한 초과), 행 0', async () => {
  const u = await createUser()
  for (const form of ['문자열', [1], { productName: 1 }, { productName: 'a'.repeat(101) }, { intro: 'a'.repeat(1001) },
    { category: 'a'.repeat(51) }, { toneGuide: 'a'.repeat(201) }]) {
    assertError(await create(u.token, { form }), 400, 'VALIDATION_FAILED')
  }
  assert.equal((await pool.query('SELECT count(*)::int AS c FROM projects')).rows[0].c, 0)
})

test('BE-05b ① 잔액 0 사용자: 생성·폼 저장 402, 목록·상세 200', async () => {
  const u = await createUser({ balance: 0 })
  assertError(await create(u.token), 402, 'INSUFFICIENT_CREDIT')

  const id = await insertProject(u.userId)
  assertError(await saveForm(u.token, id, { form: VALID_FORM, version: 1 }), 402, 'INSUFFICIENT_CREDIT')
  assert.equal((await row(id)).version, 1)

  const l = await list(u.token)
  assert.equal(l.status, 200)
  assert.deepEqual(l.body.map((p) => p.id), [id])
  assert.equal((await detail(u.token, id)).status, 200)
})

test('BE-05b ② DRAFT 폼 저장 200 → 상세에 반영, 필수값이 비어도 저장(BR-35), 모르는 키 무시', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  const form = { productName: '', intro: '짧음' }
  const r = await saveForm(u.token, id, { form: { ...form, unknownKey: 'x' }, version: 1 })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body.form, form)
  const d = await detail(u.token, id)
  assert.deepEqual(d.body.form, form)
  assert.equal(d.body.status, 'DRAFT')

  // ANALYZED에서도 허용
  const analyzed = await insertProject(u.userId, { status: 'ANALYZED' })
  assert.equal((await saveForm(u.token, analyzed, { form: VALID_FORM, version: 1 })).status, 200)
})

test('BE-05b ③ 폼 저장: GENERATED 409, version 불일치 409, 다른 사용자 404, PUBLISHED·작업 중 409', async () => {
  const u = await createUser()
  const other = await createUser()
  const body = { form: VALID_FORM, version: 1 }

  const generated = await insertProject(u.userId, { status: 'GENERATED', draftHtml: '<div></div>' })
  assertError(await saveForm(u.token, generated, body), 409, 'INVALID_STATE')

  const draft = await insertProject(u.userId)
  assertError(await saveForm(u.token, draft, { ...body, version: 2 }), 409, 'VERSION_CONFLICT')
  assertError(await saveForm(other.token, draft, body), 404, 'NOT_FOUND')
  assertError(await saveForm(u.token, 'not-a-uuid', body), 404, 'NOT_FOUND')

  const busy = await insertProject(u.userId, { activeJobType: 'GENERATE' })
  assertError(await saveForm(u.token, busy, body), 409, 'JOB_IN_PROGRESS')

  const published = await insertProject(u.userId)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [published])
  assertError(await saveForm(u.token, published, body), 409, 'INVALID_STATE')

  const d = await row(draft)
  assert.equal(d.version, 1)
  assert.deepEqual(d.form, VALID_FORM)
})

test('BE-05b ④ 폼 저장 성공 응답의 version = 요청 version + 1', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId, { version: 3 })
  const r = await saveForm(u.token, id, { form: VALID_FORM, version: 3 })
  assert.equal(r.status, 200)
  assert.equal(r.body.version, 4)
  assert.equal((await row(id)).version, 4)
})

test('BE-05b 추가: 폼 저장 version·form 형식 오류 → 400', async () => {
  const u = await createUser()
  const id = await insertProject(u.userId)
  for (const body of [{ form: VALID_FORM }, { form: VALID_FORM, version: 0 }, { form: VALID_FORM, version: '1' },
    { form: VALID_FORM, version: 1.5 }, { form: 'x', version: 1 }, { form: { category: 1 }, version: 1 }]) {
    assertError(await saveForm(u.token, id, body), 400, 'VALIDATION_FAILED')
  }
  assert.equal((await row(id)).version, 1)
})

test('BE-05b 추가: 목록은 내 것만, created_at DESC', async () => {
  const u = await createUser()
  const other = await createUser()
  const older = await insertProject(u.userId)
  const newer = await insertProject(u.userId)
  await insertProject(other.userId)
  await pool.query("UPDATE projects SET created_at = now() - interval '1 day' WHERE id = $1", [older])
  const r = await list(u.token)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.map((p) => p.id), [newer, older])
})
