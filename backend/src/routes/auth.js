import express from 'express'
import cookieParser from 'cookie-parser'
import { AppError } from '../lib/errors.js'
import { loginLimiter, refreshLimiter } from '../middleware/rate-limit.js'
import { signup, login, refresh, logout } from '../services/auth.js'
import { FRONTEND_ORIGIN, REFRESH_TTL_SEC } from '../config.js'

export const authRouter = express.Router()
authRouter.use(cookieParser())

const COOKIE = { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// FR-37·FR-39(PRD 5.8, NFR-09): 쿠키 요청은 Origin이 프론트엔드와 같아야 한다(헤더 없음 포함 거부)
const checkOrigin = (req, res, next) =>
  next(req.get('origin') === FRONTEND_ORIGIN ? undefined : new AppError(403, 'ORIGIN_FORBIDDEN'))

// [가정] N-10: 이메일 소문자 정규화, 비밀번호 8자 이상 72바이트 이하(bcrypt 한계)
function readCredentials(body) {
  const { email, password } = body ?? {}
  const e = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const ok = e.length <= 254 && EMAIL_RE.test(e) &&
    typeof password === 'string' && password.length >= 8 && Buffer.byteLength(password, 'utf8') <= 72
  if (!ok) throw new AppError(400, 'VALIDATION_FAILED')
  return { email: e, password }
}

function sendTokens(res, status, { accessToken, expiresIn, refreshToken }) {
  res.cookie('rt', refreshToken, { ...COOKIE, maxAge: REFRESH_TTL_SEC * 1000 })
  res.status(status).json({ accessToken, expiresIn })
}

authRouter.post('/signup', async (req, res) => {
  const { email, password } = readCredentials(req.body)
  sendTokens(res, 201, await signup(email, password))
})

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = readCredentials(req.body)
  sendTokens(res, 200, await login(email, password))
})

authRouter.post('/refresh', checkOrigin, refreshLimiter, async (req, res) => {
  sendTokens(res, 200, await refresh(req.cookies.rt))
})

// [가정] rt 없음·무효여도 204
authRouter.post('/logout', checkOrigin, async (req, res) => {
  await logout(req.cookies.rt)
  res.cookie('rt', '', { ...COOKIE, maxAge: 0 }) // Express 5 clearCookie는 Max-Age=0을 쓰지 않는다
  res.status(204).end()
})
