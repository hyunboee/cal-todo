import express from 'express'
import { AppError } from '../lib/errors.js'
import { readVersion } from '../lib/validate.js'
import { analyze } from '../services/analyze.js'

export const analyzeRouter = express.Router()

const COUPANG_RE = /^https:\/\/(www\.|m\.)coupang\.com\/vp\/products\/\d+(\?.*)?$/ // D-15

// FR-12: 형식 오류 400은 시도로 세지 않는다(선점 전)
analyzeRouter.post('/projects/:id/analyze', async (req, res) => {
  const url = req.body?.url
  if (typeof url !== 'string' || !COUPANG_RE.test(url)) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await analyze(req.userId, req.params.id, url.split('?')[0], readVersion(req.body)))
})
