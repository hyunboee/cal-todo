import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { pool, query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import { storage, assetKeys } from '../lib/storage.js'
import { REGEN_MAX, ANALYZE_MAX, ASSET_MAX_COUNT, PREVIEW_IMAGE_WIDTH } from '../config.js'
import { assertEligible } from './eligibility.js'

// NM-10, PP-05: 화이트리스트 매퍼. draft_html·final_html은 내보내지 않는다(BR-32)
export const toProject = (row) => ({
  id: row.id,
  status: row.status,
  version: row.version,
  form: row.form,
  selectedUsps: row.selected_usps,
  analyzeCount: row.analyze_count,
  regenCount: row.regen_count,
  aiEditCount: row.ai_edit_count,
  aiEditFailCount: row.ai_edit_fail_count,
  activeJobType: row.active_job_type,
  activeJobStartedAt: row.active_job_started_at,
  publishedAt: row.published_at,
  createdAt: row.created_at,
})

const notFound = () => new AppError(404, 'NOT_FOUND')

// LY-06: 소유(404) → PUBLISHED(409, BR-46) → 자격(403 → 402)
export async function loadProjectForWrite(userId, projectId) {
  const r = await query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId])
  const row = r.rows[0]
  if (!row) throw notFound()
  if (row.status === 'PUBLISHED') throw new AppError(409, 'INVALID_STATE')
  await assertEligible(userId)
  return row
}

// LY-06 뒷부분: 상태 → version(FR-34, BR-48) → 진행 중 작업(FR-35, BR-39)
export function assertWritable(row, states, version) {
  if (!states.includes(row.status)) throw new AppError(409, 'INVALID_STATE')
  if (row.version !== version) throw new AppError(409, 'VERSION_CONFLICT')
  if (row.active_job_type) throw new AppError(409, 'JOB_IN_PROGRESS')
}

export async function createProject(userId, form) {
  const r = await query('INSERT INTO projects (user_id, form) VALUES ($1, $2) RETURNING *', [userId, form])
  return toProject(r.rows[0])
}

// [가정] N-3: 최신순 전체
export async function listProjects(userId) {
  const r = await query('SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [userId])
  return r.rows.map(toProject)
}

export async function getProject(userId, projectId) {
  const r = await query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId])
  if (r.rowCount === 0) throw notFound()
  return toProject(r.rows[0])
}

const FORM_STATES = ['DRAFT', 'ANALYZED'] // FR-10

// FR-10, DEC-05: 필수값 검사 없이 저장(BR-35), version+1
export async function saveForm(userId, projectId, form, version) {
  assertWritable(await loadProjectForWrite(userId, projectId), FORM_STATES, version)
  const r = await query(
    `UPDATE projects SET form = $3, version = version + 1
     WHERE id = $1 AND version = $2 AND active_job_type IS NULL AND status IN ('DRAFT', 'ANALYZED') RETURNING *`,
    [projectId, version, form],
  )
  if (r.rowCount === 0) {
    // 검사와 UPDATE 사이 경쟁: 재조회로 409 코드 결정
    const cur = await query('SELECT * FROM projects WHERE id = $1', [projectId])
    assertWritable(cur.rows[0], FORM_STATES, version)
    throw new AppError(409, 'VERSION_CONFLICT')
  }
  return toProject(r.rows[0])
}

// 허용 상태: GENERATE·ANALYZE = DRAFT·ANALYZED(FR-14, FR-12), REGEN = GENERATED·EDITING(FR-15)
export const JOB_STATES = { GENERATE: ['DRAFT', 'ANALYZED'], REGEN: ['GENERATED', 'EDITING'], ANALYZE: ['DRAFT', 'ANALYZED'] }

// FR-35, BR-47: 조건부 UPDATE 1건으로 선점(REGEN·ANALYZE는 같은 문장에서 횟수 소모, D-5·D-27)
export async function reserveJob(projectId, version, type) {
  const r = await query(
    `UPDATE projects SET active_job_type = $3::text, active_job_started_at = now(),
       regen_count = regen_count + CASE WHEN $3::text = 'REGEN' THEN 1 ELSE 0 END,
       analyze_count = analyze_count + CASE WHEN $3::text = 'ANALYZE' THEN 1 ELSE 0 END
     WHERE id = $1 AND version = $2 AND active_job_type IS NULL AND status = ANY($4)
       AND ($3::text <> 'REGEN' OR regen_count < $5) AND ($3::text <> 'ANALYZE' OR analyze_count < $6)
     RETURNING *`,
    [projectId, version, type, JOB_STATES[type], REGEN_MAX, ANALYZE_MAX],
  )
  if (r.rowCount === 1) return r.rows[0]
  const cur = (await query('SELECT * FROM projects WHERE id = $1', [projectId])).rows[0]
  assertWritable(cur, JOB_STATES[type], version) // 상태 → version → 작업
  if (type === 'REGEN' && cur.regen_count >= REGEN_MAX) throw new AppError(429, 'REGEN_LIMIT')
  if (type === 'ANALYZE' && cur.analyze_count >= ANALYZE_MAX) throw new AppError(429, 'ANALYZE_LIMIT')
  throw new AppError(409, 'JOB_IN_PROGRESS')
}

// BR-47: 해제. restore면 소모한 횟수 복원. 조건부라 주기 job(releaseExpiredJobs)이 먼저 해제했으면 0행(이중 복원 없음)
export async function releaseJob(projectId, type, restore) {
  await query(
    `UPDATE projects SET active_job_type = NULL, active_job_started_at = NULL,
       regen_count = regen_count - CASE WHEN $3::boolean AND active_job_type = 'REGEN' THEN 1 ELSE 0 END,
       analyze_count = analyze_count - CASE WHEN $3::boolean AND active_job_type = 'ANALYZE' THEN 1 ELSE 0 END
     WHERE id = $1 AND active_job_type = $2`,
    [projectId, type, restore],
  )
}

const FORMAT_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const badImage = () => new AppError(400, 'VALIDATION_FAILED')

// D-21: 390px 축소 + PREVIEW ONLY 합성 webp
async function makePreview(buf) {
  const { data, info } = await sharp(buf).rotate().resize({ width: PREVIEW_IMAGE_WIDTH, withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="50%" y="50%" ` +
    `text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-weight="bold" ` +
    `font-size="${Math.max(8, Math.round(w / 8))}" fill="rgba(255,255,255,0.55)" stroke="rgba(0,0,0,0.35)" ` +
    `transform="rotate(-30 ${w / 2} ${h / 2})">PREVIEW ONLY</text></svg>`
  return sharp(data).composite([{ input: Buffer.from(mark) }]).webp().toBuffer()
}

const countAssets = async (db, projectId) =>
  (await db.query('SELECT count(*)::int AS n FROM assets WHERE project_id = $1', [projectId])).rows[0].n

// FR-11, D-19: 실제 이미지(sharp 판독)만, 프로젝트당 10장. version 불변·진행 중 작업 무관[가정]
export async function uploadAsset(userId, projectId, file) {
  await loadProjectForWrite(userId, projectId)
  let mime, preview
  try {
    mime = FORMAT_MIME[(await sharp(file.buffer).metadata()).format] // 클라이언트 MIME이 아니라 실제 형식
    if (!mime) throw badImage()
    preview = await makePreview(file.buffer)
  } catch {
    throw badImage()
  }
  if (await countAssets(pool, projectId) >= ASSET_MAX_COUNT) throw badImage()

  const id = randomUUID()
  const keys = assetKeys(projectId, id, mime)
  // ponytail: 이후 400·실패 시 이미 올린 객체는 고아로 남음(정리 job은 필요해지면)
  await storage.put('private', keys.original, file.buffer, mime)
  await storage.put('private', keys.preview, preview, 'image/webp')
  await withTx(async (client) => {
    await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]) // 동시 업로드 직렬화
    if (await countAssets(client, projectId) >= ASSET_MAX_COUNT) throw badImage()
    await client.query(
      'INSERT INTO assets (id, project_id, original_key, preview_key, mime, size) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, projectId, keys.original, keys.preview, mime, file.size],
    )
  })
  return { id }
}
