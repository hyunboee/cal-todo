import express from 'express'
import multer from 'multer'
import { AppError } from '../lib/errors.js'
import { readVersion } from '../lib/validate.js'
import { assertEligible } from '../services/eligibility.js'
import { createProject, listProjects, getProject, saveForm, uploadAsset } from '../services/projects.js'
import { getPreview } from '../services/preview.js'
import { saveUsps } from '../services/analyze.js'
import { FORM_LIMITS, ASSET_MAX_BYTES, ASSET_MIME } from '../config.js'

export const projectsRouter = express.Router()

const MAX = {
  productName: FORM_LIMITS.productName, category: FORM_LIMITS.category,
  intro: FORM_LIMITS.intro.max, toneGuide: FORM_LIMITS.toneGuide,
}

// BR-35: 형식·상한만 검사(필수값은 생성 시점). [가정] 모르는 키는 무시
function readForm(input = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AppError(400, 'VALIDATION_FAILED')
  const form = {}
  for (const k of Object.keys(MAX)) {
    if (input[k] === undefined) continue
    if (typeof input[k] !== 'string' || input[k].length > MAX[k]) throw new AppError(400, 'VALIDATION_FAILED')
    form[k] = input[k]
  }
  return form
}

projectsRouter.post('/projects', async (req, res) => {
  const form = readForm(req.body?.form)
  await assertEligible(req.userId) // LY-06: 프로젝트가 없는 생성만 라우트에서
  res.status(201).json(await createProject(req.userId, form))
})

projectsRouter.get('/projects', async (req, res) => {
  res.json(await listProjects(req.userId))
})

projectsRouter.get('/projects/:id', async (req, res) => {
  res.json(await getProject(req.userId, req.params.id))
})

projectsRouter.put('/projects/:id/form', async (req, res) => {
  const form = readForm(req.body?.form)
  res.json(await saveForm(req.userId, req.params.id, form, readVersion(req.body)))
})

// BR-24: 문자열 배열, 1개 이상[가정 I-10], 중복 없음
projectsRouter.put('/projects/:id/usps', async (req, res) => {
  const usps = req.body?.selectedUsps
  const ok = Array.isArray(usps) && usps.length >= 1 && usps.every((u) => typeof u === 'string') && new Set(usps).size === usps.length
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  res.json(await saveUsps(req.userId, req.params.id, usps, readVersion(req.body)))
})

// BR-31: 쿼리 파라미터는 무시
projectsRouter.get('/projects/:id/preview', async (req, res) => {
  res.json(await getPreview(req.userId, req.params.id))
})

// D-19, OP-06: 메모리에 1장, 10MB, 허용 MIME만(실제 형식은 서비스에서 sharp로 재확인)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ASSET_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ASSET_MIME.includes(file.mimetype)),
}).single('file')

projectsRouter.post('/projects/:id/assets', (req, res, next) => {
  upload(req, res, (err) => next(err && new AppError(400, 'VALIDATION_FAILED')))
}, async (req, res) => {
  if (!req.file) throw new AppError(400, 'VALIDATION_FAILED')
  res.status(201).json(await uploadAsset(req.userId, req.params.id, req.file))
})
