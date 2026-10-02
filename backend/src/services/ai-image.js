import sharp from 'sharp'
import { pool, query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import { storage } from '../lib/storage.js'
import { extractBlocks, applyImageEdit } from '../lib/html.js'
import { callRole } from '../llm/index.js'
import { ASSET_MAX_COUNT, AI_IMAGE_INPUT_PX } from '../config.js'
import {
  loadProjectForWrite, assertWritable, reserveJob, releaseJob, JOB_STATES, countAssets, prepareAsset, insertAsset,
} from './projects.js'
import { buildPreview } from './preview.js'

const INSTRUCTION = '상품 상세페이지용 이미지를 아래 요청대로 편집하라. 글자·로고·워터마크는 추가하지 않는다.'
const FORMAT = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }
const invalid = () => new AppError(400, 'VALIDATION_FAILED')

// 선택한 이미지를 LLM으로 변환해 새 asset으로 저장하고 그 자리에 넣는다. 성공만 횟수 소모(실패는 복원)
export async function aiImage(userId, projectId, { blockId, imageId, prompt, version }) {
  const row = await loadProjectForWrite(userId, projectId) // 404 → 409 PUBLISHED → 403 → 402
  assertWritable(row, JOB_STATES.AI_IMAGE, version)
  const target = extractBlocks(row.draft_html).find((b) => b.blockId === blockId)?.images.find((i) => i.imageId === imageId)
  if (!target) throw invalid()
  if (await countAssets(pool, projectId) >= ASSET_MAX_COUNT) throw invalid() // LLM 호출 전
  await reserveJob(projectId, version, 'AI_IMAGE') // 소진 시 429 AI_IMAGE_LIMIT

  let updated
  try {
    const src = (await query('SELECT original_key, mime FROM assets WHERE id = $1', [target.assetId])).rows[0]
    const input = await sharp(await storage.get('private', src.original_key)).rotate()
      .resize({ width: AI_IMAGE_INPUT_PX, height: AI_IMAGE_INPUT_PX, fit: 'inside', withoutEnlargement: true }).toBuffer()
    const { image } = await callRole('IMAGE', { prompt: `${INSTRUCTION}\n${prompt}`, image: input }, { userId, projectId })
    let out
    try {
      out = await sharp(image).toFormat(FORMAT[src.mime]).toBuffer() // 원본과 같은 형식으로
    } catch {
      throw new AppError(502, 'UPSTREAM_FAILED') // 판독 불가한 응답
    }
    const asset = await prepareAsset(projectId, out)
    const draft = applyImageEdit(row.draft_html, blockId, imageId, asset.id)

    updated = await withTx(async (client) => {
      await insertAsset(client, projectId, asset) // 잠금 → 10장 재확인
      const r = await client.query(
        `UPDATE projects SET draft_html = $3, status = 'EDITING', version = version + 1,
           active_job_type = NULL, active_job_started_at = NULL
         WHERE id = $1 AND version = $2 AND active_job_type = 'AI_IMAGE' RETURNING *`,
        [projectId, version, draft],
      )
      if (r.rowCount === 0) throw new AppError(409, 'VERSION_CONFLICT') // 선점이 풀렸으면 폐기(롤백)
      await client.query(
        `INSERT INTO edit_operations (project_id, type, block_id, payload) VALUES ($1, 'AI', $2, $3)`,
        [projectId, blockId, { imageId, assetId: asset.id, prompt }],
      )
      return r.rows[0]
    })
  } catch (e) {
    await releaseJob(projectId, 'AI_IMAGE', true) // BR-47: 횟수 복원
    throw e
  }
  return buildPreview(updated)
}
