import { rateLimit } from 'express-rate-limit'
import { AppError } from '../lib/errors.js'
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_GENERAL, RATE_LIMIT_LOGIN, RATE_LIMIT_REFRESH } from '../config.js'

// NFR-04. 메모리 저장소(프로세스 단위)
const limiter = (limit, keyGenerator) => rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  ...(keyGenerator && { keyGenerator }),
  handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED')),
})

export const generalLimiter = limiter(RATE_LIMIT_GENERAL, (req) => req.userId) // requireAuth 뒤
export const loginLimiter = limiter(RATE_LIMIT_LOGIN)
export const refreshLimiter = limiter(RATE_LIMIT_REFRESH)
