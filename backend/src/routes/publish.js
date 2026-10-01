import express from 'express'
import { readVersion } from '../lib/validate.js'
import { publish, getFinal } from '../services/publish.js'

export const publishRouter = express.Router()

publishRouter.post('/projects/:id/publish', async (req, res) => {
  res.json(await publish(req.userId, req.params.id, readVersion(req.body)))
})

publishRouter.get('/projects/:id/final', async (req, res) => {
  res.json(await getFinal(req.userId, req.params.id))
})
