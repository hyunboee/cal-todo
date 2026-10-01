import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { rm, readdir } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { pool } from '../src/db.js'

// 개발 DB 보호: DB 이름이 -test로 끝날 때만 비운다. schema_migrations는 유지한다.
export async function truncateAll() {
  const { rows } = await pool.query('SELECT current_database() AS db')
  assert.match(rows[0].db, /-test$/)
  await pool.query(`TRUNCATE users, user_providers, refresh_tokens, credit_wallets, credit_ledger,
    projects, assets, analysis_results, edit_operations, publish_records, llm_usage_logs`)
}

export async function insertUser(email, { wallet = true } = {}) {
  const { rows } = await pool.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email])
  if (wallet) await pool.query('INSERT INTO credit_wallets (user_id) VALUES ($1)', [rows[0].id])
  return rows[0].id
}

// app.js·services/auth.js는 동적 import: helpers만 쓰는 기존 테스트가 라우트 모듈에 묶이지 않게 한다.
export async function startServer(app) {
  app ??= (await import('../src/app.js')).createApp()
  const server = app.listen(0)
  await once(server, 'listening')
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

// HTTP 로그인 없이 사용자 + Access Token(레이트 리밋·bcrypt 회피). 잔액은 원장 1행과 함께(대사 정합).
export async function createUser({ email = `u-${randomUUID()}@test.com`, verified = true, balance = 1 } = {}) {
  const { signAccessToken } = await import('../src/services/auth.js')
  const userId = await insertUser(email)
  await pool.query('UPDATE users SET email_verified = $2 WHERE id = $1', [userId, verified])
  if (balance > 0) {
    await pool.query(
      "INSERT INTO credit_ledger (user_id, delta, reason, source) VALUES ($1, $2, 'PURCHASE', 'TOPUP')", [userId, balance])
    await pool.query('UPDATE credit_wallets SET topup_balance = $2 WHERE user_id = $1', [userId, balance])
  }
  const token = signAccessToken(userId)
  return { userId, email, token, headers: { Authorization: `Bearer ${token}` } }
}

export async function api(base, path, { method = 'GET', token, body, headers = {} } = {}) {
  const h = { ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  return readRes(res)
}

async function readRes(res) {
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 본문 없음 또는 JSON 아님 */ }
  return { status: res.status, headers: res.headers, body: json, text }
}

// Set-Cookie에서 name 쿠키 → { value, raw }(raw = 속성 포함 전체 문자열). 없으면 null
export function getCookie(res, name) {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
  if (!raw) return null
  return { value: raw.slice(name.length + 1).split(';')[0], raw }
}

// B2: 생성 필수값(D-18)을 채운 폼
export const VALID_FORM = { productName: '무선 청소기', category: '가전', intro: '가볍고 강력한 흡입력의 무선 청소기입니다.' }

// API를 거치지 않고 프로젝트 행을 만든다. PUBLISHED는 final_html CHECK 때문에 퍼블리시 API로 만든다.
export async function insertProject(userId, { status = 'DRAFT', version = 1, form = VALID_FORM, draftHtml = null, activeJobType = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO projects (user_id, status, version, form, draft_html, active_job_type, active_job_started_at)
     VALUES ($1, $2, $3, $4, $5, $6::text, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
    [userId, status, version, JSON.stringify(form), draftHtml, activeJobType])
  return rows[0].id
}

export const generateViaApi = (base, token, projectId, version) =>
  api(base, `/api/projects/${projectId}/generate`, { method: 'POST', token, body: { version } })

// 응답 JSON의 모든 키(재귀). 금지 키 검사용
export function deepKeys(value, out = new Set()) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!Array.isArray(value)) out.add(k)
      deepKeys(v, out)
    }
  }
  return out
}

// B3: 테스트 이미지는 sharp로 생성(fixture 파일 없음). noise면 압축이 안 돼 실제 사진에 가까운 크기
export async function makeImage({ width = 800, height = 600, format = 'png', noise = false } = {}) {
  const sharp = (await import('sharp')).default
  const create = { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } }
  if (noise) create.noise = { type: 'gaussian', mean: 128, sigma: 40 }
  return sharp({ create }).toFormat(format).toBuffer()
}

// multipart 필드 file 1장(계약 3.3 BE-06)
export async function upload(base, token, projectId, buf, { filename = 'a.png', type = 'image/png', field = 'file' } = {}) {
  const fd = new FormData()
  fd.append(field, new Blob([buf], { type }), filename)
  const res = await fetch(`${base}/api/projects/${projectId}/assets`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  })
  return readRes(res)
}

// 로컬 스토리지 루트(config가 cwd 기준으로 resolve)
export const storageDir = async () => resolve((await import('../src/config.js')).STORAGE_LOCAL_DIR)

// 개발 스토리지 보호: 폴더 이름이 -test로 끝날 때만 지운다(truncateAll과 같은 보호)
export async function clearStorage() {
  const dir = await storageDir()
  assert.match(basename(dir), /-test$/)
  await rm(dir, { recursive: true, force: true })
}

// bucket('private'|'public') 아래 파일 수(재귀). 폴더가 없으면 0
export async function countObjects(bucket) {
  try {
    const entries = await readdir(join(await storageDir(), bucket), { recursive: true, withFileTypes: true })
    return entries.filter((e) => e.isFile()).length
  } catch (e) {
    if (e.code === 'ENOENT') return 0
    throw e
  }
}

// 스토리지 없이 이미지 개수 조건만 채운다(LLM·프리뷰까지 가지 않는 오류 경로 전용)
export async function insertAssetRow(projectId) {
  const { rows } = await pool.query(
    "INSERT INTO assets (project_id, original_key, preview_key, mime, size) VALUES ($1, 'orig/x/a.png', 'prev/x/a.webp', 'image/png', 1) RETURNING id",
    [projectId])
  return rows[0].id
}
