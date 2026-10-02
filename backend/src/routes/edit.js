import express from 'express'
import { AppError } from '../lib/errors.js'
import { readVersion } from '../lib/validate.js'
import { manualEdit, manualImageEdit, manualImageStyle } from '../services/edit.js'
import { blockRegenerate } from '../services/generate.js'
import { aiImage } from '../services/ai-image.js'
import { EDIT_TEXT_MAX, AI_IMAGE_PROMPT_MAX } from '../config.js'

export const editRouter = express.Router()

const KEYS = 'blockId,editId,text,version'
const TAG_RE = /<\/?[a-z!][^>]*>/i // BR-44: HTML 태그 거부
const ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ // 소문자 uuid(draft의 asset: 형식)
const isId = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 32
// body는 정확히 keys만(HTML 전체 덮어쓰기 불가)
const hasKeys = (b, keys) => b && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).sort().join() === keys

// FR-17
editRouter.post('/projects/:id/edits', async (req, res) => {
  const b = req.body
  const ok = hasKeys(b, KEYS) &&
    isId(b.blockId) && isId(b.editId) && typeof b.text === 'string' && b.text.length <= EDIT_TEXT_MAX && !TAG_RE.test(b.text)
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await manualEdit(req.userId, req.params.id, { ...b, version: readVersion(b) }))
})

// 이미지 교체(무료·무제한). 새 이미지는 먼저 POST /assets로 올린다
editRouter.post('/projects/:id/image-edits', async (req, res) => {
  const b = req.body
  const ok = hasKeys(b, 'assetId,blockId,imageId,version') && isId(b.blockId) && isId(b.imageId) &&
    typeof b.assetId === 'string' && ASSET_ID_RE.test(b.assetId)
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await manualImageEdit(req.userId, req.params.id, { ...b, version: readVersion(b) }))
})

// AI 이미지 변환(프로젝트당 AI_IMAGE_MAX회)
editRouter.post('/projects/:id/ai-images', async (req, res) => {
  const b = req.body
  const prompt = typeof b?.prompt === 'string' ? b.prompt.trim() : ''
  const ok = hasKeys(b, 'blockId,imageId,prompt,version') && isId(b.blockId) && isId(b.imageId) &&
    prompt.length >= 1 && prompt.length <= AI_IMAGE_PROMPT_MAX && !TAG_RE.test(prompt)
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await aiImage(req.userId, req.params.id, { ...b, prompt, version: readVersion(b) }))
})

// 블록 재생성(프로젝트당 BLOCK_REGEN_MAX회)
editRouter.post('/projects/:id/block-regenerate', async (req, res) => {
  const b = req.body
  if (!(hasKeys(b, 'blockId,version') && isId(b.blockId))) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await blockRegenerate(req.userId, req.params.id, { blockId: b.blockId, version: readVersion(b) }))
})

// 이미지 크기(폭 10~100%, 5% 단위)·정렬(무료·무제한)
const ALIGNS = ['left', 'center', 'right']
editRouter.post('/projects/:id/image-styles', async (req, res) => {
  const b = req.body
  const ok = hasKeys(b, 'align,blockId,imageId,version,widthPct') && isId(b.blockId) && isId(b.imageId) &&
    Number.isInteger(b.widthPct) && b.widthPct >= 10 && b.widthPct <= 100 && b.widthPct % 5 === 0 && ALIGNS.includes(b.align)
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await manualImageStyle(req.userId, req.params.id, { ...b, version: readVersion(b) }))
})
