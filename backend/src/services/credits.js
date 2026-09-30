import { withTx } from '../db.js'

// FR-07: 운영자 수동 지급. BR-15: 원장 기록과 잔액 증가를 한 TX로.
// PRD-D-7: 지급 시 이메일 인증 처리. 이메일 없음은 null(쓰기 0), 지갑 없음은 reject(롤백).
export function grantTopup(email, n) {
  return withTx(async (client) => {
    const user = await client.query('SELECT id FROM users WHERE email = $1', [email])
    if (user.rowCount === 0) return null
    const userId = user.rows[0].id

    await client.query(
      "INSERT INTO credit_ledger (user_id, delta, reason, source) VALUES ($1, $2, 'PURCHASE', 'TOPUP')",
      [userId, n],
    )
    const wallet = await client.query(
      'UPDATE credit_wallets SET topup_balance = topup_balance + $2 WHERE user_id = $1 RETURNING topup_balance',
      [userId, n],
    )
    if (wallet.rowCount === 0) throw new Error('wallet not found')
    await client.query('UPDATE users SET email_verified = true WHERE id = $1', [userId])

    return { userId, topupBalance: wallet.rows[0].topup_balance }
  })
}
