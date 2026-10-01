import express from 'express'
import { readVersion } from '../lib/validate.js'
import { generate, regenerate } from '../services/generate.js'

export const generateRouter = express.Router()

generateRouter.post('/projects/:id/generate', async (req, res) => {
  res.json(await generate(req.userId, req.params.id, readVersion(req.body)))
})

generateRouter.post('/projects/:id/regenerate', async (req, res) => {
  res.json(await regenerate(req.userId, req.params.id, readVersion(req.body)))
})
