import { query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import { applyTextEdit, applyImageEdit, applyImageStyle } from '../lib/html.js'
import { loadProjectForWrite, assertWritable } from './projects.js'
import { buildPreview } from './preview.js'

const EDIT_STATES = ['GENERATED', 'EDITING'] // FR-17

// 수동 편집 저장: GENERATED → EDITING, version+1(FR-34), edit_operations MANUAL 1행
async function saveManual(projectId, version, draft, blockId, payload) {
  const updated = await withTx(async (client) => {
    const r = await client.query(
      `UPDATE projects SET draft_html = $3, status = 'EDITING', version = version + 1
       WHERE id = $1 AND version = $2 AND active_job_type IS NULL AND status IN ('GENERATED', 'EDITING') RETURNING *`,
      [projectId, version, draft],
    )
    if (r.rowCount === 0) {
      // 검사와 UPDATE 사이 경쟁: 재조회로 409 코드 결정
      assertWritable((await client.query('SELECT * FROM projects WHERE id = $1', [projectId])).rows[0], EDIT_STATES, version)
      throw new AppError(409, 'VERSION_CONFLICT')
    }
    await client.query(
      `INSERT INTO edit_operations (project_id, type, block_id, payload) VALUES ($1, 'MANUAL', $2, $3)`,
      [projectId, blockId, payload],
    )
    return r.rows[0]
  })
  return buildPreview(updated)
}

// FR-17, BR-40: 텍스트 노드만 교체. 무료·횟수 제한 없음
export async function manualEdit(userId, projectId, { blockId, editId, text, version }) {
  const row = await loadProjectForWrite(userId, projectId) // 404 → 409 PUBLISHED(BR-46) → 403 → 402
  assertWritable(row, EDIT_STATES, version)
  const draft = applyTextEdit(row.draft_html, blockId, editId, text)
  if (draft === null) throw new AppError(400, 'VALIDATION_FAILED')
  return saveManual(projectId, version, draft, blockId, { editId, text })
}

// 이미지 교체: 이 프로젝트의 asset으로만. 무료·횟수 제한 없음
export async function manualImageEdit(userId, projectId, { blockId, imageId, assetId, version }) {
  const row = await loadProjectForWrite(userId, projectId)
  assertWritable(row, EDIT_STATES, version)
  const own = await query('SELECT 1 FROM assets WHERE id = $1 AND project_id = $2', [assetId, projectId])
  if (own.rowCount === 0) throw new AppError(400, 'VALIDATION_FAILED')
  const draft = applyImageEdit(row.draft_html, blockId, imageId, assetId)
  if (draft === null) throw new AppError(400, 'VALIDATION_FAILED')
  return saveManual(projectId, version, draft, blockId, { imageId, assetId })
}

// 이미지 크기·정렬. 무료·횟수 제한 없음
export async function manualImageStyle(userId, projectId, { blockId, imageId, widthPct, align, version }) {
  const row = await loadProjectForWrite(userId, projectId)
  assertWritable(row, EDIT_STATES, version)
  const draft = applyImageStyle(row.draft_html, blockId, imageId, widthPct, align)
  if (draft === null) throw new AppError(400, 'VALIDATION_FAILED')
  return saveManual(projectId, version, draft, blockId, { imageId, widthPct, align })
}
