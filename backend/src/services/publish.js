import { createHash } from 'node:crypto'
import { query, withTx } from '../db.js'
import { AppError } from '../lib/errors.js'
import { toFinalHtml, listAssetRefs } from '../lib/html.js'
import { storage, publicKey } from '../lib/storage.js'
import { PUBLIC_IMAGE_BASE_URL } from '../config.js'
import { assertEligible } from './eligibility.js'

const PUBLIC_COPY_ATTEMPTS = 3

// BR-66: 퍼블리시 커밋 뒤에만 공개 사본을 만든다. 실패는 로그만(크레딧 유지), 다음 publish·GET final에서 재시도
export async function ensurePublicCopies(projectId) {
  const p = await query("SELECT draft_html FROM projects WHERE id = $1 AND status = 'PUBLISHED'", [projectId])
  if (!p.rows[0]) return
  const r = await query(
    'SELECT id, original_key, mime FROM assets WHERE project_id = $1 AND public_key IS NULL AND id = ANY($2::uuid[])',
    [projectId, listAssetRefs(p.rows[0].draft_html)],
  )
  for (const a of r.rows) {
    const key = publicKey(a.id, a.mime)
    for (let attempt = 1; attempt <= PUBLIC_COPY_ATTEMPTS; attempt++) {
      try {
        await storage.copy('private', a.original_key, 'public', key)
        await query('UPDATE assets SET public_key = $2 WHERE id = $1', [a.id, key])
        break
      } catch (e) {
        if (attempt === PUBLIC_COPY_ATTEMPTS) {
          console.log(JSON.stringify({
            ts: new Date().toISOString(), level: 'error', msg: 'public_copy_failed', projectId, assetId: a.id, error: e.message,
          }))
        }
      }
    }
  }
}

// FR-21, PRD 7.3: 차감·전이·기록을 한 TX로(BR-11~15, 하나라도 실패하면 ROLLBACK). TX 안에 스토리지·LLM 호출 없음
export async function publish(userId, projectId, version) {
  const result = await withTx(async (client) => {
    const r = await client.query(
      `SELECT id, status, version, active_job_type, draft_html, final_html
       FROM projects WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [projectId, userId],
    )
    const row = r.rows[0]
    if (!row) throw new AppError(404, 'NOT_FOUND')
    if (row.status === 'PUBLISHED') return { finalHtml: row.final_html } // BR-13: version·자격 무관 멱등

    await assertEligible(userId, client) // FR-06: 403 → 402(version 불일치여도 402)
    if (row.version !== version) throw new AppError(409, 'VERSION_CONFLICT') // FR-34
    if (row.active_job_type) throw new AppError(409, 'JOB_IN_PROGRESS') // FR-35
    if (!['GENERATED', 'EDITING'].includes(row.status)) throw new AppError(409, 'INVALID_STATE') // [가정]

    // BR-12: 부분 유니크 인덱스로 프로젝트당 DEDUCT 1건
    const d = await client.query(
      `INSERT INTO credit_ledger (user_id, project_id, delta, reason, source)
       VALUES ($1, $2, -1, 'DEDUCT', 'TOPUP') ON CONFLICT DO NOTHING RETURNING id`,
      [userId, projectId],
    )
    if (d.rowCount === 0) return { finalHtml: row.final_html } // FOR UPDATE 때문에 사실상 도달 불가(PRD 7.3)

    try {
      await client.query('UPDATE credit_wallets SET topup_balance = topup_balance - 1 WHERE user_id = $1', [userId])
    } catch (e) {
      if (e.code === '23514') throw new AppError(402, 'INSUFFICIENT_CREDIT') // CHECK ≥ 0 최후 방어선
      throw e
    }

    // BR-52: 워터마크 없음, 편집 속성 제거. 이미지는 서명 없는 공개 URL(사본은 커밋 뒤 생성)
    const a = await client.query('SELECT id, mime FROM assets WHERE project_id = $1', [projectId])
    const mimes = new Map(a.rows.map((x) => [x.id, x.mime]))
    const finalHtml = toFinalHtml(row.draft_html, (id) =>
      mimes.has(id) ? `${PUBLIC_IMAGE_BASE_URL}/${publicKey(id, mimes.get(id))}` : null)
    await client.query(
      `UPDATE projects SET status = 'PUBLISHED', final_html = $2, version = version + 1, published_at = now() WHERE id = $1`,
      [projectId, finalHtml],
    )
    await client.query(
      "INSERT INTO publish_records (project_id, final_html_hash, inject_status) VALUES ($1, $2, 'PENDING')",
      [projectId, createHash('sha256').update(finalHtml).digest('hex')],
    )
    return { finalHtml }
  })
  await ensurePublicCopies(projectId) // BR-66: COMMIT 뒤(PUBLISHED 재요청도 재시도 경로)
  return result
}

// FR-06: 조회라 자격 무관(퍼블리시 후 잔액 0이어도 200)
export async function getFinal(userId, projectId) {
  const r = await query('SELECT status, final_html FROM projects WHERE id = $1 AND user_id = $2', [projectId, userId])
  const row = r.rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND')
  if (row.status !== 'PUBLISHED') throw new AppError(403, 'NOT_PUBLISHED')
  await ensurePublicCopies(projectId) // [가정] I-16: 실패한 사본 재시도
  return { finalHtml: row.final_html }
}
