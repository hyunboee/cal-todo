// process.env는 이 파일에서만 읽는다.
import { resolve } from 'node:path'

if (!process.env.DB_CONN_STRING) throw new Error('DB_CONN_STRING is required') // OP-01

const positiveInt = (key, fallback) => {
  const v = process.env[key] ?? String(fallback)
  if (!/^[1-9]\d*$/.test(v) || Number(v) > 2147483647) throw new Error(`${key} must be a positive integer`)
  return Number(v)
}

export const DB_CONN_STRING = process.env.DB_CONN_STRING
export const DB_POOL_MAX = 20 // NFR-05
export const DB_STATEMENT_TIMEOUT_MS = 5000 // OP-09
export const RESERVATION_TTL_MIN = 5 // D-30 (PP-09)
export const JOB_RESERVATION_INTERVAL_MS = positiveInt('JOB_RESERVATION_INTERVAL_MS', 60000)
export const JOB_DAILY_INTERVAL_MS = positiveInt('JOB_DAILY_INTERVAL_MS', 86400000)

export const NODE_ENV = process.env.NODE_ENV ?? 'development'

const port = process.env.PORT ?? '3000'
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('PORT must be 1-65535') // OP-01
export const PORT = Number(port)

// OP-01: JWT 키는 32바이트 이상, 서로 달라야 한다(PRD 5.8)
const secret = (key) => {
  const v = process.env[key]
  if (!v || Buffer.byteLength(v, 'utf8') < 32) throw new Error(`${key} must be at least 32 bytes`)
  return v
}
export const JWT_ACCESS_SECRET = secret('JWT_ACCESS_SECRET')
export const JWT_REFRESH_SECRET = secret('JWT_REFRESH_SECRET')
if (JWT_ACCESS_SECRET === JWT_REFRESH_SECRET) throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ')

const isProd = NODE_ENV === 'production'
// 배포에서 바뀌는 값: production은 필수, 그 외는 개발 기본값(OP-01)
const devDefault = (key, fallback) => {
  const v = process.env[key]
  if (!v && isProd) throw new Error(`${key} is required in production`)
  return v || fallback
}

export const FRONTEND_ORIGIN = devDefault('FRONTEND_ORIGIN', 'http://localhost:5173')
export const JWT_ACCESS_TTL_SEC = positiveInt('JWT_ACCESS_TTL_SEC', 900) // PRD 5.8

const trustProxy = process.env.TRUST_PROXY ?? '0'
if (!/^\d+$/.test(trustProxy)) throw new Error('TRUST_PROXY must be a non-negative integer')
export const TRUST_PROXY = Number(trustProxy) // Cloudflare 뒤 배포 시 1

// PRD 7.1: Role → provider:model. provider 키는 SDK가 env에서 직접 읽는다(존재만 확인).
const llmModel = (key) => {
  const v = devDefault(key, 'mock:ok')
  if (!/^(google|anthropic|mock):.+$/.test(v)) throw new Error(`${key} must be google|anthropic|mock:<model>`)
  const keyName = { google: 'GOOGLE_GENERATIVE_AI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }[v.split(':')[0]]
  if (keyName && !process.env[keyName]) throw new Error(`${keyName} is required for ${key}`)
  return v
}
export const LLM_MAIN = llmModel('LLM_MAIN')
export const LLM_LIGHT = llmModel('LLM_LIGHT')

// DEC-07: S3_ENDPOINT가 있으면 R2(S3 호환), 없으면 로컬 디렉터리(개발·테스트)
export const S3_ENDPOINT = devDefault('S3_ENDPOINT', '')
export const STORAGE_DRIVER = S3_ENDPOINT ? 's3' : 'local'
const s3Var = (key) => {
  if (S3_ENDPOINT && !process.env[key]) throw new Error(`${key} is required when S3_ENDPOINT is set`)
  return process.env[key]
}
export const S3_REGION = process.env.S3_REGION || 'auto'
export const S3_ACCESS_KEY_ID = s3Var('S3_ACCESS_KEY_ID')
export const S3_SECRET_ACCESS_KEY = s3Var('S3_SECRET_ACCESS_KEY')
export const S3_PRIVATE_BUCKET = s3Var('S3_PRIVATE_BUCKET')
export const S3_PUBLIC_BUCKET = s3Var('S3_PUBLIC_BUCKET')
export const STORAGE_LOCAL_DIR = resolve(process.env.STORAGE_LOCAL_DIR || '.storage')
export const PUBLIC_IMAGE_BASE_URL = devDefault('PUBLIC_IMAGE_BASE_URL', 'http://localhost:3000/public-images').replace(/\/+$/, '')

// PP-09 상수
export const JWT_ISSUER = 'cal-todo' // [가정]
export const JWT_AUDIENCE = 'cal-todo' // [가정]
export const REFRESH_TTL_SEC = 14 * 86400 // PRD 5.8
export const REFRESH_FAMILY_MAX_DAYS = 30 // PRD 5.8
export const BCRYPT_ROUNDS = 10
export const RATE_LIMIT_WINDOW_MS = 60000 // NFR-04
export const RATE_LIMIT_GENERAL = 60
export const RATE_LIMIT_LOGIN = 10
export const RATE_LIMIT_REFRESH = 30
export const JSON_BODY_LIMIT = '1mb' // OP-05
export const LLM_TIMEOUT_MS = 90000 // NFR-02
export const LLM_DAILY_LIMIT = { MAIN: 20, LIGHT: 50 } // D-28
export const LLM_CONCURRENCY = { MAIN: 20, LIGHT: 40 } // D-29
export const LLM_QUEUE_MAX = 100 // D-29
export const LLM_QUEUE_WAIT_MS = 30000 // D-29
export const LLM_RETRY_AFTER_SEC = 10 // [가정]
export const HTML_ROOT_WIDTH_PX = 780 // BR-30
export const FORM_LIMITS = { productName: 100, category: 50, intro: { min: 10, max: 1000 }, toneGuide: 200 } // D-18, category·toneGuide [가정]
export const REGEN_MAX = 3 // D-5
export const ASSET_MAX_COUNT = 10 // D-19
export const ASSET_MAX_BYTES = 10485760 // D-19
export const ASSET_MIME = ['image/jpeg', 'image/png', 'image/webp'] // D-19
export const PREVIEW_IMAGE_WIDTH = 390 // D-21
export const ANALYZE_MAX = 3 // D-27
export const CRAWL_TIMEOUT_MS = 10000 // OP-09
export const EDIT_TEXT_MAX = 2000 // [가정]
