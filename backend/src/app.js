import { fileURLToPath } from 'node:url'
import express from 'express'
import { query } from './db.js'
import { notFound, errorHandler } from './middleware/error-handler.js'
import { requestLog } from './middleware/request-log.js'
import { cors } from './middleware/cors.js'
import { requireAuth } from './middleware/require-auth.js'
import { generalLimiter } from './middleware/rate-limit.js'
import { authRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { projectsRouter } from './routes/projects.js'
import { generateRouter } from './routes/generate.js'
import { publishRouter } from './routes/publish.js'
import { editRouter } from './routes/edit.js'
import { analyzeRouter } from './routes/analyze.js'
import { AppError } from './lib/errors.js'
import { runAllJobs } from './jobs/index.js'
import { TRUST_PROXY, JSON_BODY_LIMIT, NODE_ENV, CRON_SECRET } from './config.js'

const HEALTH_DB_TIMEOUT_MS = 3000
const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SWAGGER_FILE = new URL('../swagger.yaml', import.meta.url)
const SWAGGER_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Coupang AI Detail Maker API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api-docs/swagger.yaml', dom_id: '#swagger-ui', persistAuthorization: true })</script>
</body></html>`

// LY-05: 조립 순서. CORS는 FRONTEND_ORIGIN 하나만 허용(운영은 동일 출처라 실질 영향 없음, DEC-02).
export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (TRUST_PROXY > 0) app.set('trust proxy', TRUST_PROXY)
  app.use(cors)

  // OP-12, NFR-12: 인증·로그 없음
  app.get('/healthz', async (req, res) => {
    try {
      await query('SELECT 1')
      res.json({ status: 'ok' })
    } catch {
      res.status(503).json({ status: 'unavailable' })
    }
  })

  // 상세 헬스체크: DB 연결 상태와 응답 시간. DB가 멈춰도 3초 안에 503으로 답한다. 인증·로그 없음
  app.get('/api/health', async (req, res) => {
    const start = performance.now()
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), HEALTH_DB_TIMEOUT_MS) })
    let db
    try {
      await Promise.race([query('SELECT 1'), timeout])
      db = { status: 'ok', latencyMs: Math.round(performance.now() - start) }
    } catch (e) {
      db = { status: 'error', error: e.message === 'timeout' ? 'timeout' : 'unreachable' } // 내부 오류 문구는 노출하지 않는다
    } finally {
      clearTimeout(timer)
    }
    const ok = db.status === 'ok'
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable', time: new Date().toISOString(), db })
  })

  // 개발용 API 문서(Swagger UI, CDN). 운영에서는 노출하지 않는다.
  if (NODE_ENV !== 'production') {
    app.get('/api-docs', (req, res) => res.type('html').send(SWAGGER_HTML))
    app.get('/api-docs/swagger.yaml', (req, res) => res.type('yaml').sendFile(fileURLToPath(SWAGGER_FILE)))
  }

  app.use(requestLog)
  app.use(express.json({ limit: JSON_BODY_LIMIT }))
  // 서버리스(Vercel)에서는 setInterval 주기 작업이 돌지 않아 Vercel Cron이 부른다(Authorization: Bearer CRON_SECRET)
  if (CRON_SECRET) {
    app.get('/api/internal/jobs', async (req, res, next) => {
      if (req.get('authorization') !== `Bearer ${CRON_SECRET}`) return next(new AppError(401, 'TOKEN_INVALID'))
      await runAllJobs()
      res.json({ status: 'ok' })
    })
  }
  app.use('/api/auth', authRouter)
  // [가정] uuid 형식이 아닌 id는 404(pg 형식 오류 500 방지, 존재 비노출)
  app.use('/api/projects/:id', (req, res, next) =>
    next(UUID_RE.test(req.params.id) ? undefined : new AppError(404, 'NOT_FOUND')))
  // [가정] 일반 리밋은 사용자당이라 requireAuth 뒤(LY-05 순서와 다름)
  app.use('/api', requireAuth, generalLimiter)
  app.use('/api', meRouter, projectsRouter, generateRouter, publishRouter, editRouter, analyzeRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
