import express from 'express'
import { getMe } from '../services/auth.js'

export const meRouter = express.Router()

meRouter.get('/me', async (req, res) => {
  res.json(await getMe(req.userId))
})
