import { randomUUID } from 'node:crypto'

// OP-03: 요청당 한 줄. 헤더·쿠키·본문·쿼리는 남기지 않는다.
export function requestLog(req, res, next) {
  req.reqId = randomUUID()
  const start = performance.now()
  res.on('finish', () => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      reqId: req.reqId,
      userId: req.userId ?? null,
      method: req.method,
      route: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(performance.now() - start),
    }))
  })
  next()
}
