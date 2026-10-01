import { AppError } from '../lib/errors.js'

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Not Found'))
}

// NM-11. 예상 못 한 오류는 메시지만 로그하고 응답에 스택·원래 메시지를 노출하지 않는다.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)
  if (err.type?.startsWith('entity.')) err = new AppError(400, 'VALIDATION_FAILED') // body-parser: 잘못된 JSON·크기 초과
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter))
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } })
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'unhandled_error', reqId: req.reqId, error: err.message }))
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal Server Error' } })
}
