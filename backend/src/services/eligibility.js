import { pool } from '../db.js'
import { AppError } from '../lib/errors.js'

// FR-06, LY-06: 사용 자격 판정 단일 함수. 미인증 403이 잔액 402보다 우선(BR-04, BR-10)
export async function assertEligible(userId, db = pool) {
  const r = await db.query(
    `SELECT u.email_verified, w.topup_balance + w.subscription_balance AS balance
     FROM users u JOIN credit_wallets w ON w.user_id = u.id WHERE u.id = $1`,
    [userId],
  )
  const row = r.rows[0]
  if (!row?.email_verified) throw new AppError(403, 'EMAIL_NOT_VERIFIED')
  if (row.balance < 1) throw new AppError(402, 'INSUFFICIENT_CREDIT')
}
