import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { pool } from '../src/db.js'
import { crawler } from '../src/lib/crawler.js'
import { roleModels, parseModel, semaphores, createSemaphore, MOCK_USPS } from '../src/llm/index.js'
import { LLM_RETRY_AFTER_SEC } from '../src/config.js'
import { truncateAll, createUser, insertProject, startServer, api } from './helpers.js'

const { base, close } = await startServer()
const original = { models: { ...roleModels }, sems: { ...semaphores } }

after(async () => {
  await close()
  await pool.end()
})
beforeEach(() => truncateAll())
afterEach(() => {
  Object.assign(roleModels, original.models)
  Object.assign(semaphores, original.sems)
})

const URL_OK = 'https://www.coupang.com/vp/products/7654321'
const URL_WITH_QUERY = `${URL_OK}?itemId=11&vendorItemId=22`
const PAGE = { text: '무선 청소기 상품 페이지. 리뷰: 가볍고 흡입력이 좋아요.' }

const analyze = (token, id, body) => api(base, `/api/projects/${id}/analyze`, { method: 'POST', token, body })
const saveUsps = (token, id, selectedUsps, version) =>
  api(base, `/api/projects/${id}/usps`, { method: 'PUT', token, body: { selectedUsps, version } })
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const row = (id) => one('SELECT status, version, analyze_count, active_job_type, selected_usps FROM projects WHERE id = $1', [id])
const usageCount = async () => (await one('SELECT count(*)::int AS c FROM llm_usage_logs')).c
const analysisRows = async (id) => (await pool.query('SELECT source_url, usp_candidates, analyzed_at FROM analysis_results WHERE project_id = $1', [id])).rows
const assertError = (r, status, code) => {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.error.code, code)
}
const mockCrawl = (t, impl = async () => PAGE) => t.mock.method(crawler, 'crawl', impl)
const quiet = (t) => {
  const lines = []
  for (const m of ['log', 'warn', 'error']) t.mock.method(console, m, (...a) => lines.push(a.map(String).join(' ')))
  return lines
}

test('BE-13 ① [P0] AC-BR26: 실패 포함 3회(크롤 실패·LLM 실패·성공) 뒤 4번째 → 429 ANALYZE_LIMIT, 크롤링·LLM 0회', async (t) => {
  const lines = quiet(t)
  const u = await createUser()
  const id = await insertProject(u.userId)
  let crawlFails = true
  const crawl = mockCrawl(t, async () => {
    if (crawlFails) throw new Error('injected crawl failure')
    return PAGE
  })

  // 1회: 크롤링 실패 → 502, 시도 소모(복원 안 함), 해제, LLM 0
  assertError(await analyze(u.token, id, { url: URL_OK, version: 1 }), 502, 'UPSTREAM_FAILED')
  assert.deepEqual(await row(id), { status: 'DRAFT', version: 1, analyze_count: 1, active_job_type: null, selected_usps: [] })
  assert.equal(await usageCount(), 0)
  const failed = lines.filter((l) => l.includes('"crawl_failed"'))
  assert.equal(failed.length, 1)
  assert.equal(JSON.parse(failed[0]).level, 'error')
  assert.equal(failed[0].includes('injected crawl failure'), false) // error는 name만

  // 2회: LLM 실패 → 502, 시도 소모, usage 1행
  crawlFails = false
  roleModels.LIGHT = parseModel('mock:fail')
  assertError(await analyze(u.token, id, { url: URL_OK, version: 1 }), 502, 'UPSTREAM_FAILED')
  assert.deepEqual(await row(id), { status: 'DRAFT', version: 1, analyze_count: 2, active_job_type: null, selected_usps: [] })
  assert.equal(await usageCount(), 1)

  // 3회: 성공
  roleModels.LIGHT = parseModel('mock:ok')
  const ok = await analyze(u.token, id, { url: URL_OK, version: 1 })
  assert.equal(ok.status, 200, ok.text)
  const p = await row(id)
  assert.equal(p.analyze_count, 3)
  assert.equal(p.version, 2)
  assert.equal(await usageCount(), 2)
  assert.equal(crawl.mock.callCount(), 3)

  // 4회: 상한 → 크롤링·LLM 0회, 상태 불변
  assertError(await analyze(u.token, id, { url: URL_OK, version: 2 }), 429, 'ANALYZE_LIMIT')
  assert.equal(crawl.mock.callCount(), 3)
  assert.equal(await usageCount(), 2)
  assert.deepEqual(await row(id), p)
})

test('BE-13 ① 추가: 성공 응답 {sourceUrl(쿼리 제거), uspCandidates, analyzedAt}, analysis_results 1행, 크롤러는 정규화 URL로 호출', async (t) => {
  const crawl = mockCrawl(t)
  const u = await createUser()
  const id = await insertProject(u.userId)
  const r = await analyze(u.token, id, { url: URL_WITH_QUERY, version: 1 })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(Object.keys(r.body).sort(), ['analyzedAt', 'sourceUrl', 'uspCandidates'])
  assert.equal(r.body.sourceUrl, URL_OK)
  assert.deepEqual(r.body.uspCandidates, MOCK_USPS)
  assert.ok(!Number.isNaN(Date.parse(r.body.analyzedAt)))
  assert.equal(crawl.mock.calls[0].arguments[0], URL_OK)

  const rows = await analysisRows(id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source_url, URL_OK)
  assert.deepEqual(rows[0].usp_candidates, MOCK_USPS)
  assert.deepEqual(await row(id), { status: 'DRAFT', version: 2, analyze_count: 1, active_job_type: null, selected_usps: [] })

  // m. 도메인도 허용
  const m = await analyze(u.token, id, { url: 'https://m.coupang.com/vp/products/1', version: 2 })
  assert.equal(m.status, 200, m.text)
  assert.equal((await analysisRows(id)).length, 1) // 덮어쓰기
})

test('BE-13 ② D-15, BR-26: URL 형식 오류 → 400, analyze_count 불변, 크롤링·LLM 0회', async (t) => {
  const crawl = mockCrawl(t)
  const u = await createUser()
  const id = await insertProject(u.userId)
  const urls = [
    'http://www.coupang.com/vp/products/1', // https 아님
    'https://evil.example/vp/products/1', // 다른 도메인
    'https://www.coupang.com.evil.example/vp/products/1',
    'https://www.coupang.com/vp/products/abc', // 숫자 아님
    'https://coupang.com/vp/products/1', // www/m 없음
    'https://www.coupang.com/vp/products/', 'https://www.coupang.com/np/search?q=1',
    '', 123, null,
  ]
  for (const url of urls) assertError(await analyze(u.token, id, { url, version: 1 }), 400, 'VALIDATION_FAILED')
  assertError(await analyze(u.token, id, { version: 1 }), 400, 'VALIDATION_FAILED')
  assertError(await analyze(u.token, id, { url: URL_OK }), 400, 'VALIDATION_FAILED')
  assertError(await analyze(u.token, id, { url: URL_OK, version: 0 }), 400, 'VALIDATION_FAILED')
  assert.equal(crawl.mock.callCount(), 0)
  assert.equal(await usageCount(), 0)
  assert.deepEqual(await row(id), { status: 'DRAFT', version: 1, analyze_count: 0, active_job_type: null, selected_usps: [] })
})

test('BE-13 ③ BR-47: LLM 미호출 거절(503 LLM_BUSY·429 DAILY_LLM_LIMIT) → analyze_count 복원, 해제', async (t) => {
  quiet(t)
  mockCrawl(t)
  const u = await createUser()
  const id = await insertProject(u.userId)
  const restored = { status: 'DRAFT', version: 1, analyze_count: 0, active_job_type: null, selected_usps: [] }

  semaphores.LIGHT = createSemaphore(1, 0, 1000)
  const release = await semaphores.LIGHT.acquire()
  try {
    const r = await analyze(u.token, id, { url: URL_OK, version: 1 })
    assertError(r, 503, 'LLM_BUSY')
    assert.equal(r.headers.get('retry-after'), String(LLM_RETRY_AFTER_SEC))
  } finally {
    release()
  }
  assert.deepEqual(await row(id), restored)

  await pool.query(
    `INSERT INTO llm_usage_logs (user_id, role, provider, model_id, latency_ms, success)
     SELECT $1, 'LIGHT', 'mock', 'ok', 1, true FROM generate_series(1, 50)`, [u.userId])
  assertError(await analyze(u.token, id, { url: URL_OK, version: 1 }), 429, 'DAILY_LLM_LIMIT')
  assert.deepEqual(await row(id), restored)
  assert.equal(await usageCount(), 50)
  assert.equal((await analysisRows(id)).length, 0)
})

test('BE-13 ④ BR-27: GENERATED·EDITING·PUBLISHED에서 analyze·usps → 409 INVALID_STATE, 크롤링 0회', async (t) => {
  const crawl = mockCrawl(t)
  const u = await createUser()
  for (const status of ['GENERATED', 'EDITING']) {
    const id = await insertProject(u.userId, { status, draftHtml: '<div style="width:780px;margin:0 auto"><section data-block-id="b1"><p data-edit-id="e1">x</p></section></div>' })
    await pool.query('INSERT INTO analysis_results (project_id, source_url, usp_candidates) VALUES ($1, $2, $3)', [id, URL_OK, JSON.stringify(MOCK_USPS)])
    assertError(await analyze(u.token, id, { url: URL_OK, version: 1 }), 409, 'INVALID_STATE')
    assertError(await saveUsps(u.token, id, [MOCK_USPS[0]], 1), 409, 'INVALID_STATE')
    assert.equal((await row(id)).analyze_count, 0)
  }
  const poor = await createUser({ balance: 0 })
  const pub = await insertProject(poor.userId, { status: 'GENERATED', draftHtml: '<div></div>' })
  await pool.query("UPDATE projects SET status = 'PUBLISHED', final_html = '<div></div>', published_at = now() WHERE id = $1", [pub])
  assertError(await analyze(poor.token, pub, { url: URL_OK, version: 1 }), 409, 'INVALID_STATE') // 잔액 0이어도 409
  assertError(await saveUsps(poor.token, pub, [MOCK_USPS[0]], 1), 409, 'INVALID_STATE')
  assert.equal(crawl.mock.callCount(), 0)
})

test('BE-13 ⑤ AC-BR24: USP 저장 → ANALYZED, selected_usps = 선택값, version+1. 재분석 → 선택 비우고 DRAFT', async (t) => {
  mockCrawl(t)
  const u = await createUser()
  const id = await insertProject(u.userId)

  // 분석 전 저장 → 400(analysis_results 없음)
  assertError(await saveUsps(u.token, id, [MOCK_USPS[0]], 1), 400, 'VALIDATION_FAILED')
  assert.equal((await analyze(u.token, id, { url: URL_OK, version: 1 })).status, 200)

  for (const bad of [[], ['후보에 없는 USP'], [MOCK_USPS[0], MOCK_USPS[0]], [1], 'x', null]) {
    assertError(await saveUsps(u.token, id, bad, 2), 400, 'VALIDATION_FAILED')
  }
  assertError(await saveUsps(u.token, id, [MOCK_USPS[0]], 1), 409, 'VERSION_CONFLICT')
  assert.equal((await row(id)).version, 2)

  const selected = [MOCK_USPS[2], MOCK_USPS[0]]
  const r = await saveUsps(u.token, id, selected, 2)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.status, 'ANALYZED')
  assert.equal(r.body.version, 3)
  assert.deepEqual(r.body.selectedUsps, selected)
  assert.deepEqual(await row(id), { status: 'ANALYZED', version: 3, analyze_count: 1, active_job_type: null, selected_usps: selected })

  // ANALYZED에서 다시 선택 저장 가능
  const r2 = await saveUsps(u.token, id, [MOCK_USPS[1]], 3)
  assert.equal(r2.status, 200, r2.text)
  assert.deepEqual(r2.body.selectedUsps, [MOCK_USPS[1]])

  // 재분석(ANALYZED → DRAFT, 선택 비움), analysis_results 덮어쓰기
  const first = (await analysisRows(id))[0].analyzed_at
  const re = await analyze(u.token, id, { url: 'https://www.coupang.com/vp/products/999', version: 4 })
  assert.equal(re.status, 200, re.text)
  assert.deepEqual(await row(id), { status: 'DRAFT', version: 5, analyze_count: 2, active_job_type: null, selected_usps: [] })
  const rows = await analysisRows(id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source_url, 'https://www.coupang.com/vp/products/999')
  assert.ok(rows[0].analyzed_at >= first)
})

test('BE-13 ⑥ [P2] AC-BR22: 크롤링 원문(고유 리뷰 문장)이 DB 전 테이블·로그에 0건', async (t) => {
  const SENTINEL = 'SENTINEL_REVIEW_7f3a'
  const lines = quiet(t)
  const crawl = mockCrawl(t, async () => ({ text: `상품명 무선 청소기. 리뷰: "${SENTINEL} 배터리가 오래가고 정말 가벼워요"` }))
  const u = await createUser()
  const id = await insertProject(u.userId)

  const ok = await analyze(u.token, id, { url: URL_OK, version: 1 })
  assert.equal(ok.status, 200, ok.text)
  roleModels.LIGHT = parseModel('mock:fail') // 실패 로그 경로도 확인
  assertError(await analyze(u.token, id, { url: URL_OK, version: 2 }), 502, 'UPSTREAM_FAILED')
  assert.equal(crawl.mock.callCount(), 2)
  assert.equal(ok.text.includes(SENTINEL), false)

  const tables = (await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows
  assert.ok(tables.length >= 11)
  for (const { table_name: name } of tables) {
    const c = (await one(`SELECT count(*)::int AS c FROM "${name}" t WHERE row_to_json(t)::text LIKE $1`, [`%${SENTINEL}%`])).c
    assert.equal(c, 0, name)
  }
  assert.ok(lines.length > 0)
  for (const l of lines) assert.equal(l.includes(SENTINEL), false, l)
})

test('BE-13 추가: 판정 순서(404, 403, 402, version 409, 작업 409) — 시도 미소모, 크롤링 0회', async (t) => {
  const crawl = mockCrawl(t)
  const u = await createUser()
  const other = await createUser()
  const id = await insertProject(u.userId)
  assertError(await analyze(other.token, id, { url: URL_OK, version: 1 }), 404, 'NOT_FOUND')
  assertError(await saveUsps(other.token, id, [MOCK_USPS[0]], 1), 404, 'NOT_FOUND')
  assertError(await analyze(u.token, id, { url: URL_OK, version: 2 }), 409, 'VERSION_CONFLICT')
  const busy = await insertProject(u.userId, { activeJobType: 'GENERATE' })
  assertError(await analyze(u.token, busy, { url: URL_OK, version: 1 }), 409, 'JOB_IN_PROGRESS')
  assertError(await saveUsps(u.token, busy, [MOCK_USPS[0]], 1), 409, 'JOB_IN_PROGRESS')

  const unverified = await createUser({ verified: false, balance: 0 })
  const uid = await insertProject(unverified.userId)
  assertError(await analyze(unverified.token, uid, { url: URL_OK, version: 1 }), 403, 'EMAIL_NOT_VERIFIED')
  assertError(await saveUsps(unverified.token, uid, [MOCK_USPS[0]], 1), 403, 'EMAIL_NOT_VERIFIED')
  const poor = await createUser({ balance: 0 })
  const pid = await insertProject(poor.userId)
  assertError(await analyze(poor.token, pid, { url: URL_OK, version: 1 }), 402, 'INSUFFICIENT_CREDIT')
  assertError(await saveUsps(poor.token, pid, [MOCK_USPS[0]], 1), 402, 'INSUFFICIENT_CREDIT')

  assert.equal(crawl.mock.callCount(), 0)
  assert.equal(await usageCount(), 0)
  for (const p of [id, busy, uid, pid]) assert.equal((await row(p)).analyze_count, 0)
})

// crawler 단위: 로컬 HTTP 서버(외부 네트워크 없음)
test('BE-13 추가: crawler.crawl — title·meta description·본문 텍스트, script·style 제외, 공백 압축, 비 200 → throw', async () => {
  const long = '가'.repeat(30000)
  const server = createServer((req, res) => {
    if (req.url === '/500') return res.writeHead(500).end('error')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (req.url === '/long') return res.end(`<html><body><p>${long}</p></body></html>`)
    res.end(`<html><head><title>테스트 상품</title><meta name="description" content="상품 설명 문구">
      <style>.x{color:red}</style><script>var SCRIPT_SECRET = 1</script></head>
      <body><h1>무선   청소기</h1>

      <div class="review">리뷰 문장 하나</div><script>alert("SCRIPT_SECRET")</script></body></html>`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const host = `http://127.0.0.1:${server.address().port}`
  try {
    const { text } = await crawler.crawl(`${host}/ok`)
    for (const s of ['테스트 상품', '상품 설명 문구', '무선 청소기', '리뷰 문장 하나']) assert.ok(text.includes(s), s)
    for (const s of ['SCRIPT_SECRET', 'color:red', '<']) assert.equal(text.includes(s), false, s)
    assert.equal(/\s{2,}/.test(text), false, text)

    assert.ok((await crawler.crawl(`${host}/long`)).text.length <= 20000)
    await assert.rejects(crawler.crawl(`${host}/500`))
  } finally {
    await new Promise((r) => server.close(r))
  }
})
