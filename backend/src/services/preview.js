import { query } from '../db.js'
import { AppError } from '../lib/errors.js'
import { addWatermark, listAssetRefs, replaceImages, extractBlocks } from '../lib/html.js'
import { storage } from '../lib/storage.js'

// BR-31, BR-50: 프리뷰는 항상 워터마크 합성본(저장 안 함). 요청 파라미터로 끌 수 없다
export async function buildPreview(row) {
  const r = await query('SELECT id, preview_key FROM assets WHERE project_id = $1', [row.id])
  const previewKeys = new Map(r.rows.map((a) => [a.id, a.preview_key]))
  const refs = listAssetRefs(row.draft_html).filter((id) => previewKeys.has(id))
  // BR-50: 390px 워터마크 사본만 data URI로 인라인. 원본 키·URL은 응답에 넣지 않는다
  const uris = new Map(await Promise.all(refs.map(async (id) =>
    [id, `data:image/webp;base64,${(await storage.get('private', previewKeys.get(id))).toString('base64')}`])))
  const html = addWatermark(replaceImages(row.draft_html, (id) => uris.get(id) ?? null))
  return { version: row.version, html, blocks: extractBlocks(row.draft_html) }
}

// 자격 무관(FR-06 조회)
export async function getPreview(userId, projectId) {
  const r = await query('SELECT id, version, draft_html FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId])
  const row = r.rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND')
  if (row.draft_html === null) throw new AppError(409, 'INVALID_STATE') // [가정] 생성 전
  return buildPreview(row)
}
