import { query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import { sanitizeHtml, blockHtml, replaceBlock } from '../lib/html.js'
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

function productLines(form, usps) {
  const t = (k) => (typeof form[k] === 'string' ? form[k].trim() : '')
  const lines = [`제품명: ${t('productName')}`, `카테고리: ${t('category')}`, `소개: ${t('intro')}`]
  if (t('toneGuide')) lines.push(`톤 가이드: ${t('toneGuide')}`)
  if (usps.length) lines.push(`강조할 USP: ${usps.join(', ')}`) // BR-25: 빈 배열이면 분석 생략
  return lines
}

function buildPrompt(form, usps, assetIds) {
  const lines = productLines(form, usps)
  // LLM이 긴 uuid를 옮겨 적다 틀리므로 짧은 번호를 주고 응답에서 되돌린다(restoreAssetRefs)
  lines.push(`사용할 이미지(각각 <img src="asset:번호">로 배치): ${assetIds.map((_, i) => `asset:${i + 1}`).join(', ')}`)
  return lines.join('\n')
}

// asset:번호 → asset:uuid. 없는 번호는 그대로 두어 정제에서 제거된다(BR-32)
const restoreAssetRefs = (text, assetIds) =>
  text.replace(/asset:(\d+)\b/g, (m, n) => (assetIds[n - 1] ? `asset:${assetIds[n - 1]}` : m))

const stripFence = (text) => text.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '')

// 번호(asset:n)가 호출마다 같은 asset을 가리키도록 정렬
const listAssetIds = async (projectId) =>
  (await query('SELECT id FROM assets WHERE project_id = $1 ORDER BY created_at, id', [projectId])).rows.map((a) => a.id)

// asset:uuid → asset:번호(프롬프트용, restoreAssetRefs의 역)
const aliasAssetRefs = (html, assetIds) =>
  html.replace(/asset:([0-9a-f-]{36})/g, (m, id) => (assetIds.includes(id) ? `asset:${assetIds.indexOf(id) + 1}` : m))

// 선점된 작업 실행. LLM은 TX 밖(커넥션 점유 없음). REGEN은 실패 시 횟수 복원
async function runReserved(row, userId, version, type, assetIds) {
  const restore = type === 'REGEN'
  let draft
  try {
    const prompt = buildPrompt(row.form, row.selected_usps, assetIds)
    const { text } = await callRole('MAIN', { system: SYSTEM, prompt }, { userId, projectId: row.id })
    draft = sanitizeHtml(restoreAssetRefs(stripFence(text), assetIds)) // LY-18, BR-30
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

// 블록 재생성: 현재 draft 전체를 보여 주고 그 블록만 다시 쓰게 한다. 프로젝트당 BLOCK_REGEN_MAX회(성공만), 다른 블록의 편집은 유지
export async function blockRegenerate(userId, projectId, { blockId, version }) {
  const row = await loadProjectForWrite(userId, projectId) // 404 → 409 PUBLISHED → 403 → 402
  assertWritable(row, JOB_STATES.BLOCK_REGEN, version)
  const target = blockHtml(row.draft_html, blockId)
  if (target === null) throw new AppError(400, 'VALIDATION_FAILED')
  await reserveJob(projectId, version, 'BLOCK_REGEN') // 소진 시 429 BLOCK_REGEN_LIMIT

  let updated
  try {
    const assetIds = await listAssetIds(projectId)
    const prompt = [
      ...productLines(row.form, row.selected_usps),
      `사용할 수 있는 이미지: ${assetIds.map((_, i) => `asset:${i + 1}`).join(', ')}`,
      '',
      `아래는 현재 상세페이지 전체 HTML이다. 전체 스타일(색, 글꼴 크기, 여백, 톤)을 유지하면서 data-block-id="${blockId}" 블록만 새로 작성하라. ` +
        '그 블록 하나(<section> 하나)만 출력하라. 다른 블록은 출력하지 마라.',
      '[전체 HTML]',
      aliasAssetRefs(row.draft_html, assetIds),
      '',
      '[다시 작성할 블록]',
      aliasAssetRefs(target, assetIds),
    ].join('\n')
    const { text } = await callRole('MAIN', { system: SYSTEM, prompt }, { userId, projectId })
    const draft = replaceBlock(row.draft_html, blockId, restoreAssetRefs(stripFence(text), assetIds)) // LY-18
    if (draft === null) throw new AppError(502, 'UPSTREAM_FAILED') // 정제 후 빈 블록

    updated = await withTx(async (client) => {
      const r = await client.query(
        `UPDATE projects SET draft_html = $3, status = 'EDITING', version = version + 1,
           active_job_type = NULL, active_job_started_at = NULL
         WHERE id = $1 AND version = $2 AND active_job_type = 'BLOCK_REGEN' RETURNING *`,
        [projectId, version, draft],
      )
      if (r.rowCount === 0) throw new AppError(409, 'VERSION_CONFLICT') // 선점이 풀렸으면 폐기
      await client.query(
        `INSERT INTO edit_operations (project_id, type, block_id, payload) VALUES ($1, 'AI', $2, $3)`,
        [projectId, blockId, { blockId, kind: 'BLOCK_REGEN' }],
      )
      return r.rows[0]
    })
  } catch (e) {
    await releaseJob(projectId, 'BLOCK_REGEN', true) // BR-47: 횟수 복원
    throw e
  }
  return buildPreview(updated)
}
