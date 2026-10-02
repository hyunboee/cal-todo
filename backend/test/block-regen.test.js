import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { sanitizeHtml, extractBlocks } from '../src/lib/html.js'
import { roleModels, parseModel } from '../src/llm/index.js'
import { releaseExpiredJobs } from '../src/jobs/index.js'
import { truncateAll, createUser, insertProject, startServer, api, makeImage, upload, clearStorage, VALID_FORM } from './helpers.js'

// POST /api/projects/:id/block-regenerate(계약 block-plan.md 백엔드)
const { base, close } = await startServer()
const originalModels = { ...roleModels }
const PNG = await makeImage()

// 가짜 Anthropic: api.anthropic.com 요청만 가로채 프롬프트를 캡처하고 응답 문구를 정한다(SDK는 호출 시점의 globalThis.fetch를 쓴다)
const realFetch = globalThis.fetch
const fake = { reply: '', calls: [] }
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) return realFetch(url, init)
  const { system, messages } = JSON.parse(init.body)
  fake.calls.push({
    system: [system].flat().map((s) => s.text ?? s).join('\n'),
    prompt: messages.flatMap((m) => [m.content].flat().map((c) => c.text ?? c)).join('\n'),
  })
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: fake.reply }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const apiKey = process.env.ANTHROPIC_API_KEY
const useFake = (reply) => {
  process.env.ANTHROPIC_API_KEY = 'test'
  roleModels.MAIN = parseModel('anthropic:claude-test')
  fake.reply = reply
  fake.calls = []
}

after(async () => {
  globalThis.fetch = realFetch
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
  roleModels.MAIN = parseModel('mock:ok')
})
afterEach(() => {
  Object.assign(roleModels, originalModels)
  if (apiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = apiKey
})

const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const row = (id) => one(
  'SELECT status, version, draft_html, block_regen_count, active_job_type, active_job_started_at FROM projects WHERE id = $1', [id])
const usage = async () => (await pool.query('SELECT role, project_id, success FROM llm_usage_logs')).rows
const usageCount = async () => (await one('SELECT count(*)::int AS c FROM llm_usage_logs')).c
const opsCount = async (id) => (await one('SELECT count(*)::int AS c FROM edit_operations WHERE project_id = $1', [id])).c
const blockRegen = (token, id, body) => api(base, `/api/projects/${id}/block-regenerate`, { method: 'POST', token, body })
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
const insertLogs = (userId, role, n) => pool.query(
  `INSERT INTO llm_usage_logs (user_id, role, provider, model_id, latency_ms, success)
   SELECT $1, $2, 'mock', 'ok', 1, true FROM generate_series(1, $3)`, [userId, role, n])

// 업로드 1장 = draft img 1개. 섹션 3개(하나뿐이면 sanitize가 감싸개를 벗겨 블록이 쪼개진다)
async function projectWithBlocks(u, { status = 'GENERATED' } = {}) {
  const id = await insertProject(u.userId)
  const up = await upload(base, u.token, id, PNG)
  assert.equal(up.status, 201, up.text)
  const draft = sanitizeHtml(`<section><h2>제목</h2><img src="asset:${up.body.id}" alt=""></section>` +
    '<section><p>본문</p></section><section><p>셋째</p></section>')
  await pool.query('UPDATE projects SET status = $2, draft_html = $3 WHERE id = $1', [id, status, draft])
  const blocks = extractBlocks(draft)
  return { id, assetId: up.body.id, draft, blocks, body: (version = 1, blockId = blocks[0].blockId) => ({ blockId, version }) }
}
// 실패·거절 뒤: 횟수 복원, 작업 해제, draft·version 불변, edit_operations 없음
async function assertRestored(p, { count = 0, version = 1, status = 'GENERATED', draft = p.draft } = {}) {
  assert.deepEqual(await row(p.id), {
    status, version, draft_html: draft, block_regen_count: count, active_job_type: null, active_job_started_at: null,
  })
  assert.equal(await opsCount(p.id), 0)
}
const texts = (block) => block.fields.map((f) => f.text)
const unique = (xs) => new Set(xs).size === xs.length

test('block-regenerate 성공: 대상 블록만 교체, 다른 블록의 수동 편집 유지, version+1, EDITING, blockRegenCount+1', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  const [b1, b2, b3] = p.blocks
  // 다른 블록을 먼저 직접 수정(version 2, EDITING)
  const edited = await api(base, `/api/projects/${p.id}/edits`, {
    method: 'POST', token: u.token, body: { blockId: b3.blockId, editId: b3.fields[0].editId, text: '직접 고친 문구', version: 1 },
  })
  assert.equal(edited.status, 200, edited.text)
  const before = extractBlocks((await row(p.id)).draft_html)

  // 코드펜스·섹션 2개·script·이벤트 속성·asset:번호가 섞인 응답
  useFake('```html\n<section data-block-id="zz"><h2 data-edit-id="e9" onclick="alert(1)">새 제목</h2><p>새 설명</p>' +
    '<img src="asset:1" alt="" data-img-id="i7"><script>alert(1)</script></section>\n<section><p>다른 블록</p></section>\n```')
  const r = await blockRegen(u.token, p.id, p.body(2))
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.version, 3)
  for (const k of ['draftHtml', 'finalHtml']) assert.equal(k in r.body, false, k)

  const cur = await row(p.id)
  assert.equal(cur.status, 'EDITING')
  assert.equal(cur.version, 3)
  assert.equal(cur.block_regen_count, 1)
  assert.equal(cur.active_job_type, null)
  assert.equal(cur.active_job_started_at, null)

  const blocks = extractBlocks(cur.draft_html)
  assert.deepEqual(blocks.map((b) => b.blockId), [b1.blockId, b2.blockId, b3.blockId]) // 블록 수·순서·data-block-id 유지
  assert.deepEqual(blocks[1], before[1])
  assert.deepEqual(blocks[2], before[2])
  assert.deepEqual(texts(blocks[2]), ['직접 고친 문구'])
  // 대상 블록: 첫 섹션만, asset:번호 → uuid 복원, 편집·이미지 ID는 블록 안에서 중복 없이
  assert.deepEqual(texts(blocks[0]), ['새 제목', '새 설명'])
  assert.deepEqual(blocks[0].images.map((i) => i.assetId), [p.assetId])
  assert.ok(unique(blocks[0].fields.map((f) => f.editId)))
  const $ = cheerio.load(cur.draft_html, null, false)
  assert.equal($('script').length, 0)
  assert.equal($('[onclick]').length, 0)
  assert.equal(cur.draft_html.includes('다른 블록'), false)
  assert.equal(cur.draft_html.includes('zz'), false)
  assert.deepEqual(r.body.blocks, blocks)
  assert.equal(cheerio.load(r.body.html, null, false)('[data-watermark="overlay"]').length, 1)

  // 프롬프트: 제품 정보 + 현재 전체 HTML(수동 편집 포함) + 대상 블록. 이미지는 asset:번호(uuid 없음)
  assert.equal(fake.calls.length, 1)
  const { prompt } = fake.calls[0]
  for (const s of [VALID_FORM.productName, '직접 고친 문구', '본문', `data-block-id="${b1.blockId}"`, 'asset:1']) {
    assert.ok(prompt.includes(s), s)
  }
  assert.ok(prompt.split('제목').length - 1 >= 2, '전체 HTML과 대상 블록 HTML에 각각 들어감')
  assert.equal(prompt.includes(p.assetId), false)
  assert.ok(fake.calls[0].system.length > 0)

  assert.deepEqual(await usage(), [{ role: 'MAIN', project_id: p.id, success: true }])
  const ops = (await pool.query("SELECT type, block_id, payload FROM edit_operations WHERE project_id = $1 AND type = 'AI'", [p.id])).rows
  assert.deepEqual(ops, [{ type: 'AI', block_id: b1.blockId, payload: { blockId: b1.blockId, kind: 'BLOCK_REGEN' } }])

  const detail = await api(base, `/api/projects/${p.id}`, { token: u.token })
  assert.equal(detail.body.blockRegenCount, 1)
})

test('block-regenerate: 감싸개 없는 섹션 하나 응답 → 섹션 통째로 한 블록(쪼개지지 않음)', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  useFake('<section style="padding:40px"><h2>하나</h2><p>둘</p></section>')
  const r = await blockRegen(u.token, p.id, p.body(1, p.blocks[1].blockId))
  assert.equal(r.status, 200, r.text)
  const blocks = extractBlocks((await row(p.id)).draft_html)
  assert.equal(blocks.length, 3)
  assert.deepEqual(blocks.map((b) => b.blockId), p.blocks.map((b) => b.blockId))
  assert.deepEqual(texts(blocks[1]), ['하나', '둘'])
  assert.deepEqual(blocks[0], p.blocks[0])
  assert.deepEqual(blocks[2], p.blocks[2])
})

test('block-regenerate(mock:ok): 섹션 여러 개·script 응답에서 첫 블록만 정제해 넣는다', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  const r = await blockRegen(u.token, p.id, p.body(1, p.blocks[2].blockId))
  assert.equal(r.status, 200, r.text)
  const html = (await row(p.id)).draft_html
  const blocks = extractBlocks(html)
  assert.deepEqual(blocks.map((b) => b.blockId), p.blocks.map((b) => b.blockId))
  assert.deepEqual(texts(blocks[2]), ['핵심 특징', '가볍고 강력한 흡입력']) // MOCK_MAIN_HTML 첫 섹션
  assert.deepEqual(blocks.slice(0, 2), p.blocks.slice(0, 2))
  assert.equal(cheerio.load(html, null, false)('script, link, style, [class], [onclick]').length, 0)
  assert.equal(html.includes('사용 방법'), false)
})

test('block-regenerate: 정제 후 빈 블록 → 502 UPSTREAM_FAILED, 횟수 복원·draft 불변', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  useFake('<script>alert(1)</script>')
  assertError(await blockRegen(u.token, p.id, p.body(1)), 502, 'UPSTREAM_FAILED')
  await assertRestored(p)
})

test('block-regenerate: block_regen_count 9 → 성공(10), 11번째 → 429 BLOCK_REGEN_LIMIT, LLM 0회', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  await pool.query('UPDATE projects SET block_regen_count = 9 WHERE id = $1', [p.id])
  assert.equal((await blockRegen(u.token, p.id, p.body(1))).status, 200)
  assert.equal((await row(p.id)).block_regen_count, 10)
  assert.equal(await usageCount(), 1)

  const before = await row(p.id)
  assertError(await blockRegen(u.token, p.id, p.body(2)), 429, 'BLOCK_REGEN_LIMIT')
  assert.deepEqual(await row(p.id), before)
  assert.equal(await usageCount(), 1)
})

test('block-regenerate: mock:fail → 502 UPSTREAM_FAILED, 횟수 복원, draft 불변', async () => {
  roleModels.MAIN = parseModel('mock:fail')
  const u = await createUser()
  const p = await projectWithBlocks(u)
  assertError(await blockRegen(u.token, p.id, p.body(1)), 502, 'UPSTREAM_FAILED')
  await assertRestored(p)
  assert.deepEqual(await usage(), [{ role: 'MAIN', project_id: p.id, success: false }])
})

test('block-regenerate: 일일 상한 공유 — MAIN 20회 뒤 429 DAILY_LLM_LIMIT, 횟수 복원', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  await insertLogs(u.userId, 'MAIN', 20)
  assertError(await blockRegen(u.token, p.id, p.body(1)), 429, 'DAILY_LLM_LIMIT')
  await assertRestored(p)
  assert.equal(await usageCount(), 20)
})

test('block-regenerate: 없는 blockId → 400, LLM 0회·횟수 소모 0', async () => {
  const u = await createUser()
  const p = await projectWithBlocks(u)
  assertError(await blockRegen(u.token, p.id, p.body(1, 'nope')), 400, 'VALIDATION_FAILED')
  assert.equal(await usageCount(), 0)
  await assertRestored(p)
})

test('block-regenerate: body 형식 오류 → 400(DB 조회 전: 남의 프로젝트여도 400)', async () => {
  const u = await createUser()
  const other = await createUser()
  const p = await projectWithBlocks(u)
  const ok = p.body(1)
  const bad = [
    {}, { blockId: ok.blockId }, { version: 1 }, { ...ok, extra: 1 }, { ...ok, prompt: 'x' },
    { ...ok, blockId: '' }, { ...ok, blockId: 'b'.repeat(33) }, { ...ok, blockId: 1 },
    { ...ok, version: 0 }, { ...ok, version: '1' }, { ...ok, version: 1.5 },
  ]
  for (const body of bad) {
    assertError(await blockRegen(u.token, p.id, body), 400, 'VALIDATION_FAILED')
    assertError(await blockRegen(other.token, p.id, body), 400, 'VALIDATION_FAILED')
  }
  assert.equal(await usageCount(), 0)
  await assertRestored(p)
})

test('block-regenerate: DRAFT·ANALYZED·PUBLISHED 409 INVALID_STATE, version 409, 진행 중 작업 409, 남의 것 404, LLM 0회', async () => {
  const u = await createUser()
  const other = await createUser()
  for (const status of ['DRAFT', 'ANALYZED']) {
    const p = await projectWithBlocks(u, { status })
    assertError(await blockRegen(u.token, p.id, p.body(1)), 409, 'INVALID_STATE')
  }
  const pub = await projectWithBlocks(u)
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [pub.id])
  assertError(await blockRegen(u.token, pub.id, pub.body(1)), 409, 'INVALID_STATE')

  const p = await projectWithBlocks(u)
  assertError(await blockRegen(other.token, p.id, p.body(1)), 404, 'NOT_FOUND')
  assertError(await blockRegen(u.token, 'not-a-uuid', p.body(1)), 404, 'NOT_FOUND')
  assertError(await blockRegen(u.token, p.id, p.body(2)), 409, 'VERSION_CONFLICT')
  await pool.query("UPDATE projects SET active_job_type = 'REGEN', active_job_started_at = now() WHERE id = $1", [p.id])
  assertError(await blockRegen(u.token, p.id, p.body(1)), 409, 'JOB_IN_PROGRESS')
  assert.equal((await row(p.id)).block_regen_count, 0)
  assert.equal(await usageCount(), 0)

  // EDITING도 허용
  const editing = await projectWithBlocks(u, { status: 'EDITING' })
  assert.equal((await blockRegen(u.token, editing.id, editing.body(1))).status, 200)
})

test('block-regenerate: 5분 넘은 BLOCK_REGEN 선점은 releaseExpiredJobs가 해제하며 횟수 복원, 1분 전은 유지', async () => {
  const u = await createUser()
  const expired = await projectWithBlocks(u)
  const fresh = await projectWithBlocks(u)
  const reserve = (id, ago) => pool.query(
    `UPDATE projects SET block_regen_count = 1, active_job_type = 'BLOCK_REGEN', active_job_started_at = now() - $2::interval WHERE id = $1`,
    [id, ago])
  await reserve(expired.id, '6 minutes')
  await reserve(fresh.id, '1 minute')

  assert.equal(await releaseExpiredJobs(), 1)
  await assertRestored(expired)
  const f = await row(fresh.id)
  assert.equal(f.block_regen_count, 1)
  assert.equal(f.active_job_type, 'BLOCK_REGEN')
})
