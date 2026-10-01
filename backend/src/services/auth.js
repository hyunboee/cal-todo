import { createHash, randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { pool, query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import {
  JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL_SEC, JWT_ISSUER, JWT_AUDIENCE,
  REFRESH_TTL_SEC, REFRESH_FAMILY_MAX_DAYS, BCRYPT_ROUNDS,
} from '../config.js'

const JWT_OPTS = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
const VERIFY_OPTS = { ...JWT_OPTS, algorithms: ['HS256'] }
const refreshInvalid = () => new AppError(401, 'REFRESH_INVALID')

// PRD 5.8: 클레임에 이메일 인증·잔액을 넣지 않는다(sub, typ, iss, aud, iat, exp)
export function signAccessToken(userId) {
  return jwt.sign({ typ: 'access' }, JWT_ACCESS_SECRET, {
    ...JWT_OPTS, algorithm: 'HS256', subject: userId, expiresIn: JWT_ACCESS_TTL_SEC,
  })
}

export function verifyAccessToken(token) {
  let p
  try {
    p = jwt.verify(token, JWT_ACCESS_SECRET, VERIFY_OPTS)
  } catch (e) {
    throw new AppError(401, e instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID')
  }
  if (p.typ !== 'access') throw new AppError(401, 'TOKEN_INVALID')
  return { userId: p.sub }
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex')

function verifyRefreshToken(token) {
  try {
    const p = jwt.verify(token, JWT_REFRESH_SECRET, VERIFY_OPTS)
    return p.typ === 'refresh' ? p : null
  } catch {
    return null
  }
}

async function issueTokens(db, userId, familyId = randomUUID(), jti = randomUUID()) {
  const refreshToken = jwt.sign({ typ: 'refresh', fam: familyId }, JWT_REFRESH_SECRET, {
    ...JWT_OPTS, algorithm: 'HS256', subject: userId, jwtid: jti, expiresIn: REFRESH_TTL_SEC,
  })
  await db.query(
    `INSERT INTO refresh_tokens (jti, user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [jti, userId, familyId, hashToken(refreshToken), REFRESH_TTL_SEC],
  )
  return { accessToken: signAccessToken(userId), expiresIn: JWT_ACCESS_TTL_SEC, refreshToken }
}

const revokeFamily = (familyId) =>
  query('UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1', [familyId])

// BR-05: 가입 TX에서 지갑 생성
export async function signup(email, password) {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  return withTx(async (client) => {
    let user
    try {
      user = await client.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, hash])
    } catch (e) {
      if (e.code === '23505') throw new AppError(400, 'VALIDATION_FAILED', 'email already registered') // [가정] I-12
      throw e
    }
    const userId = user.rows[0].id
    await client.query('INSERT INTO credit_wallets (user_id) VALUES ($1)', [userId])
    return issueTokens(client, userId)
  })
}

export async function login(email, password) {
  const r = await query('SELECT id, password_hash FROM users WHERE email = $1', [email])
  const user = r.rows[0]
  if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS')
  }
  return issueTokens(pool, user.id)
}

// FR-37·FR-38(PRD 5.8, BR-06): 회전. 폐기된 토큰 재사용은 패밀리 전체 폐기.
export async function refresh(refreshToken) {
  const p = verifyRefreshToken(refreshToken)
  if (!p) throw refreshInvalid()

  // ponytail: 최소 created_at 판정은 일 1회 job이 패밀리의 가장 오래된 행을 지우면 30일 상한이 늘어날 수 있다(개선: 회전 시 패밀리 시작 시각 상속)
  const r = await query(
    `SELECT user_id, family_id, token_hash, revoked_at IS NOT NULL AS revoked, expires_at <= now() AS expired,
       (SELECT min(created_at) FROM refresh_tokens f WHERE f.family_id = t.family_id)
         + make_interval(days => $2) <= now() AS too_old
     FROM refresh_tokens t WHERE jti = $1`,
    [p.jti, REFRESH_FAMILY_MAX_DAYS],
  )
  const row = r.rows[0]
  if (!row || row.token_hash !== hashToken(refreshToken)) throw refreshInvalid()
  if (row.revoked) {
    await revokeFamily(row.family_id)
    throw refreshInvalid()
  }
  if (row.expired || row.too_old) throw refreshInvalid()

  const newJti = randomUUID()
  const tokens = await withTx(async (client) => {
    const u = await client.query(
      'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE jti = $1 AND revoked_at IS NULL',
      [p.jti, newJti],
    )
    if (u.rowCount === 0) return null // 동시 회전
    return issueTokens(client, row.user_id, row.family_id, newJti)
  })
  if (!tokens) {
    await revokeFamily(row.family_id)
    throw refreshInvalid()
  }
  return tokens
}

// FR-39: 로그아웃은 패밀리 전체 폐기
export async function logout(refreshToken) {
  const p = verifyRefreshToken(refreshToken)
  if (p) await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [p.fam])
}

const toMe = (row) => ({ email: row.email, emailVerified: row.email_verified, balance: row.balance })

export async function getMe(userId) {
  const r = await query(
    `SELECT u.email, u.email_verified, w.topup_balance + w.subscription_balance AS balance
     FROM users u JOIN credit_wallets w ON w.user_id = u.id WHERE u.id = $1`,
    [userId],
  )
  if (r.rowCount === 0) throw new AppError(404, 'NOT_FOUND')
  return toMe(r.rows[0])
}
