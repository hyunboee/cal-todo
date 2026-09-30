// FR-07: 운영자 수동 크레딧 지급 CLI. 사용: node --env-file=.env scripts/grant.js <email> <n>
import { pool } from '../src/db.js'
import { grantTopup } from '../src/services/credits.js'

// 종료 코드를 반환한다(reject 안 함, pool 안 닫음).
export async function runGrant(args) {
  const [email, n] = args
  if (args.length !== 2 || !email || !/^[1-9]\d*$/.test(n)) {
    console.error('usage: node scripts/grant.js <email> <n> (n: 양의 정수)')
    return 1
  }
  try {
    const result = await grantTopup(email, Number(n))
    if (!result) {
      console.error(`user not found: ${email}`)
      return 1
    }
    console.log(`granted ${n} credits to ${email} (topup_balance=${result.topupBalance})`)
    return 0
  } catch (e) {
    console.error(`grant failed: ${e.message}`)
    return 1
  }
}

if (import.meta.main) {
  process.exitCode = await runGrant(process.argv.slice(2))
  await pool.end()
}
