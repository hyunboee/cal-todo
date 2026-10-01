import { query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import { crawler } from '../lib/crawler.js'
import { callRole } from '../llm/index.js'
import { loadProjectForWrite, assertWritable, reserveJob, releaseJob, toProject } from './projects.js'

const SYSTEM = `당신은 이커머스 상품 분석가다. 주어진 경쟁 상품 페이지 텍스트(상품 설명·리뷰)에서 구매자가 중요하게 여기는 장점(USP)을 뽑는다.
- 각 USP는 짧은 한국어 명사구로 쓴다.
- 최대 10개, JSON 문자열 배열만 출력한다. 예: ["가벼운 무게","긴 배터리 수명"]`
const USP_MAX = 10 // [가정]
const USP_LEN = 100 // [가정]
const NOT_CALLED = new Set(['DAILY_LLM_LIMIT', 'LLM_BUSY']) // BR-47: LLM 미호출 거절만 복원

const log = (fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }))
const upstream = () => new AppError(502, 'UPSTREAM_FAILED')

// 출력의 첫 [ ~ 마지막 ] 를 JSON으로. 문자열만, trim, 중복 제거
function parseUsps(text) {
  let arr
  try {
    arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const usps = arr.filter((v) => typeof v === 'string').map((v) => v.trim().slice(0, USP_LEN)).filter(Boolean)
  return [...new Set(usps)].slice(0, USP_MAX)
}

const toAnalysis = (row) => ({ sourceUrl: row.source_url, uspCandidates: row.usp_candidates, analyzedAt: row.analyzed_at })

// FR-12, D-27: 시도 3회(실패 포함). 크롤링·LLM이 실행된 시도는 실패해도 복원하지 않는다(BR-26·BR-47)
export async function analyze(userId, projectId, url, version) {
  await loadProjectForWrite(userId, projectId)
  await reserveJob(projectId, version, 'ANALYZE') // 4번째는 429 ANALYZE_LIMIT(크롤·LLM 0회)
  let usps
  try {
    let page
    try {
      page = await crawler.crawl(url)
    } catch (e) {
      log({ level: 'error', msg: 'crawl_failed', status: e.status ?? null, error: e.name }) // BR-22: 원문·URL 없음
      throw upstream()
    }
    // BR-22: 원문은 LLM 입력으로만 쓰고 저장·로그하지 않는다(callRole도 프롬프트를 남기지 않음)
    const { text } = await callRole('LIGHT', { system: SYSTEM, prompt: page.text }, { userId, projectId })
    usps = parseUsps(text)
    if (usps.length === 0) throw upstream()
  } catch (e) {
    await releaseJob(projectId, 'ANALYZE', NOT_CALLED.has(e.code))
    throw e
  }
  // BR-27: 재분석 성공은 선택을 비우고 DRAFT. FR-34: 대기 중 version이 바뀌었으면 결과 폐기
  const row = await withTx(async (client) => {
    const r = await client.query(
      `UPDATE projects SET selected_usps = '[]', status = 'DRAFT', version = version + 1,
         active_job_type = NULL, active_job_started_at = NULL
       WHERE id = $1 AND version = $2 AND active_job_type = 'ANALYZE'`,
      [projectId, version],
    )
    if (r.rowCount === 0) return null
    // BR-22: 저장은 URL과 USP 후보만
    const a = await client.query(
      `INSERT INTO analysis_results (project_id, source_url, usp_candidates) VALUES ($1, $2, $3)
       ON CONFLICT (project_id) DO UPDATE SET source_url = EXCLUDED.source_url,
         usp_candidates = EXCLUDED.usp_candidates, analyzed_at = now()
       RETURNING *`,
      [projectId, url, JSON.stringify(usps)],
    )
    return a.rows[0]
  })
  if (!row) {
    await releaseJob(projectId, 'ANALYZE', false)
    throw new AppError(409, 'VERSION_CONFLICT')
  }
  return toAnalysis(row)
}

const USP_STATES = ['DRAFT', 'ANALYZED'] // FR-12

// BR-24: 후보 안 값만 1개 이상 → ANALYZED, version+1. E-7(후보 원문 대조)은 하지 않음
export async function saveUsps(userId, projectId, selectedUsps, version) {
  assertWritable(await loadProjectForWrite(userId, projectId), USP_STATES, version)
  const a = await query('SELECT usp_candidates FROM analysis_results WHERE project_id = $1', [projectId])
  const candidates = new Set(a.rows[0]?.usp_candidates ?? [])
  if (!selectedUsps.every((u) => candidates.has(u))) throw new AppError(400, 'VALIDATION_FAILED')
  const r = await query(
    `UPDATE projects SET selected_usps = $3, status = 'ANALYZED', version = version + 1
     WHERE id = $1 AND version = $2 AND active_job_type IS NULL AND status IN ('DRAFT', 'ANALYZED') RETURNING *`,
    [projectId, version, JSON.stringify(selectedUsps)],
  )
  if (r.rowCount === 0) {
    assertWritable((await query('SELECT * FROM projects WHERE id = $1', [projectId])).rows[0], USP_STATES, version)
    throw new AppError(409, 'VERSION_CONFLICT')
  }
  return toProject(r.rows[0])
}
