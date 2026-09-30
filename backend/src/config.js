// process.env는 이 파일에서만 읽는다.
if (!process.env.DB_CONN_STRING) throw new Error('DB_CONN_STRING is required') // OP-01

const positiveInt = (key, fallback) => {
  const v = process.env[key] ?? String(fallback)
  if (!/^[1-9]\d*$/.test(v) || Number(v) > 2147483647) throw new Error(`${key} must be a positive integer (ms)`)
  return Number(v)
}

export const DB_CONN_STRING = process.env.DB_CONN_STRING
export const DB_POOL_MAX = 20 // NFR-05
export const DB_STATEMENT_TIMEOUT_MS = 5000 // OP-09
export const RESERVATION_TTL_MIN = 5 // D-30 (PP-09)
export const JOB_RESERVATION_INTERVAL_MS = positiveInt('JOB_RESERVATION_INTERVAL_MS', 60000)
export const JOB_DAILY_INTERVAL_MS = positiveInt('JOB_DAILY_INTERVAL_MS', 86400000)
