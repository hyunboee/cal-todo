// LY-07: 주기 작업. 모든 쿼리는 조건부·멱등이라 PM2 2프로세스 동시 실행에도 안전(NFR-14).
import { pool } from '../db.js'
import { RESERVATION_TTL_MIN, JOB_RESERVATION_INTERVAL_MS, JOB_DAILY_INTERVAL_MS } from '../config.js'

const timers = []

const logError = (fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', ...fields }))

// FR-35, BR-47: 선점 후 D-30(5분)이 지난 작업을 해제한다. REGEN은 regen_count, AI_IMAGE는 ai_image_count, BLOCK_REGEN은 block_regen_count 복원.
// BR-26: ANALYZE/GENERATE는 표시만 해제(카운트 유지).
// 동시 2회 실행 시 두 번째는 행 잠금 대기 후 재평가로 0행.
// ponytail: AI_EDIT(S) 복원은 S 단계에서 CASE 추가
export async function releaseExpiredJobs(db = pool) {
  const r = await db.query(
    `UPDATE projects SET
       regen_count = CASE WHEN active_job_type = 'REGEN' THEN regen_count - 1 ELSE regen_count END,
       ai_image_count = CASE WHEN active_job_type = 'AI_IMAGE' THEN ai_image_count - 1 ELSE ai_image_count END,
       block_regen_count = CASE WHEN active_job_type = 'BLOCK_REGEN' THEN block_regen_count - 1 ELSE block_regen_count END,
       active_job_type = NULL, active_job_started_at = NULL
     WHERE active_job_started_at < now() - make_interval(mins => $1)`,
    [RESERVATION_TTL_MIN],
  )
  return r.rowCount
}

// 폐기됐지만 미만료 행은 재사용 탐지용으로 유지한다.
export async function deleteExpiredRefreshTokens(db = pool) {
  const r = await db.query('DELETE FROM refresh_tokens WHERE expires_at < now()')
  return r.rowCount
}

// OP-13: 지갑 잔액 합과 원장 합이 다른 지갑 수. 1 이상이면 오류 로그.
export async function reconcileLedger(db = pool) {
  const r = await db.query(
    `SELECT count(*)::int AS count FROM credit_wallets w
     LEFT JOIN (SELECT user_id, sum(delta) AS total FROM credit_ledger GROUP BY user_id) l USING (user_id)
     WHERE w.subscription_balance + w.topup_balance <> coalesce(l.total, 0)`,
  )
  const { count } = r.rows[0]
  if (count >= 1) logError({ msg: 'ledger_mismatch', count })
  return count
}

// 절대 reject하지 않는다(타이머 콜백의 unhandled rejection 방지).
export async function runJob(fn) {
  try {
    await fn()
  } catch (e) {
    logError({ msg: 'job_failed', job: fn.name, error: e.message })
  }
}

// 주기 작업 전부 1회(시작 시, Vercel Cron)
export const runAllJobs = () =>
  Promise.all([runJob(releaseExpiredJobs), runJob(deleteExpiredRefreshTokens), runJob(reconcileLedger)]).then(() => {})

export function startJobs() {
  timers.push(
    setInterval(() => runJob(releaseExpiredJobs), JOB_RESERVATION_INTERVAL_MS),
    setInterval(() => {
      runJob(deleteExpiredRefreshTokens)
      runJob(reconcileLedger)
    }, JOB_DAILY_INTERVAL_MS),
  )
  return runAllJobs()
}

export function stopJobs() {
  for (const t of timers) clearInterval(t)
  timers.length = 0
}
