import express from 'express'
import { AppError } from '../lib/errors.js'
import { readVersion } from '../lib/validate.js'
import { manualEdit } from '../services/edit.js'
import { EDIT_TEXT_MAX } from '../config.js'

export const editRouter = express.Router()

const KEYS = 'blockId,editId,text,version'
const TAG_RE = /<\/?[a-z!][^>]*>/i // BR-44: HTML 태그 거부
const isId = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 32

// FR-17: body는 정확히 4개 키만(HTML 전체 덮어쓰기 불가)
editRouter.post('/projects/:id/edits', async (req, res) => {
  const b = req.body
  const ok = b && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).sort().join() === KEYS &&
    isId(b.blockId) && isId(b.editId) && typeof b.text === 'string' && b.text.length <= EDIT_TEXT_MAX && !TAG_RE.test(b.text)
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await manualEdit(req.userId, req.params.id, { ...b, version: readVersion(b) }))
})
