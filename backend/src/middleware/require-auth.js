import { AppError } from '../lib/errors.js'
import { verifyAccessToken } from '../services/auth.js'

// LY-05: 서명 검증만, DB 조회 없음
export function requireAuth(req, res, next) {
  const m = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '')
  if (!m) return next(new AppError(401, 'TOKEN_INVALID'))
  try {
    req.userId = verifyAccessToken(m[1]).userId
  } catch (e) {
    return next(e)
  }
  next()
}
