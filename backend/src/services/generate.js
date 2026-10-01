import { query } from '../db.js'
import { AppError } from '../lib/errors.js'
import { sanitizeHtml } from '../lib/html.js'
import { callRole } from '../llm/index.js'
import { FORM_LIMITS, HTML_ROOT_WIDTH_PX } from '../config.js'
import { loadProjectForWrite, assertWritable, reserveJob, releaseJob, JOB_STATES } from './projects.js'
import { buildPreview } from './preview.js'

const SYSTEM = `당신은 한국어 상세페이지 HTML 작성자다. 다음 규격을 지켜 HTML만 출력한다.
- 전체 폭 ${HTML_ROOT_WIDTH_PX}px, 모든 스타일은 인라인 style 속성으로만 쓴다.
- 내용은 의미 단위의 <section> 블록으로 나눈다.
- script, style, link 태그와 class, id, 이벤트 속성은 쓰지 않는다.
- 이미지는 <img src="asset:ID" alt="설명"> 형식만 쓴다. 외부 URL은 쓰지 않는다.
- 설명 문장이나 코드펜스 없이 HTML만 출력한다.`

// D-18, BR-35: 생성 요청 시점 필수값(LLM 호출 전)
function assertRequired(form) {
  const len = (k) => (typeof form[k] === 'string' ? form[k].trim().length : 0)
  const ok = len('productName') >= 1 && len('productName') <= FORM_LIMITS.productName &&
    len('category') >= 1 && len('category') <= FORM_LIMITS.category &&
    len('intro') >= FORM_LIMITS.intro.min && len('intro') <= FORM_LIMITS.intro.max
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
}

function buildPrompt(form, usps, assetIds) {
  const t = (k) => (typeof form[k] === 'string' ? form[k].trim() : '')
  const lines = [`제품명: ${t('productName')}`, `카테고리: ${t('category')}`, `소개: ${t('intro')}`]
  if (t('toneGuide')) lines.push(`톤 가이드: ${t('toneGuide')}`)
  if (usps.length) lines.push(`강조할 USP: ${usps.join(', ')}`) // BR-25: 빈 배열이면 분석 생략
  lines.push(`사용할 이미지(각각 <img src="asset:ID">로 배치): ${assetIds.map((id) => `asset:${id}`).join(', ')}`)
  return lines.join('\n')
}

const stripFence = (text) => text.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '')

const listAssetIds = async (projectId) =>
  (await query('SELECT id FROM assets WHERE project_id = $1', [projectId])).rows.map((a) => a.id)

// 선점된 작업 실행. LLM은 TX 밖(커넥션 점유 없음). REGEN은 실패 시 횟수 복원
async function runReserved(row, userId, version, type, assetIds) {
  const restore = type === 'REGEN'
  let draft
  try {
    const prompt = buildPrompt(row.form, row.selected_usps, assetIds)
    const { text } = await callRole('MAIN', { system: SYSTEM, prompt }, { userId, projectId: row.id })
    draft = sanitizeHtml(stripFence(text)) // LY-18, BR-30
  } catch (e) {
    await releaseJob(row.id, type, restore) // BR-47: 502·503·429는 해제
    throw e
  }
  // FR-34: 대기 중 version이 바뀌었거나 선점이 풀렸으면 결과 폐기. BR-34: 재생성은 수동 편집 초기화(GENERATED)
  const r = await query(
    `UPDATE projects SET draft_html = $3, status = 'GENERATED', version = version + 1,
       active_job_type = NULL, active_job_started_at = NULL
     WHERE id = $1 AND version = $2 AND active_job_type = $4 RETURNING *`,
    [row.id, version, draft, type],
  )
  if (r.rowCount === 0) {
    await releaseJob(row.id, type, restore)
    throw new AppError(409, 'VERSION_CONFLICT')
  }
  return buildPreview(r.rows[0])
}

// FR-14, BE-09b
export async function generate(userId, projectId, version) {
  const row = await loadProjectForWrite(userId, projectId)
  assertWritable(row, JOB_STATES.GENERATE, version) // 사전 검사(409가 400보다 먼저). 최종 판정은 reserveJob
  assertRequired(row.form)
  const assetIds = await listAssetIds(projectId)
  if (assetIds.length === 0) throw new AppError(400, 'VALIDATION_FAILED') // D-18: 이미지 1장 이상
  await reserveJob(projectId, version, 'GENERATE') // FR-35
  return runReserved(row, userId, version, 'GENERATE', assetIds)
}

// FR-15, D-5: 3회까지. [가정] 필수값·이미지 재검사 안 함. 원장·잔액 변화 없음
export async function regenerate(userId, projectId, version) {
  const row = await loadProjectForWrite(userId, projectId)
  await reserveJob(projectId, version, 'REGEN') // FR-35, 4번째는 429 REGEN_LIMIT
  return runReserved(row, userId, version, 'REGEN', await listAssetIds(projectId))
}
