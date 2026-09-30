import assert from 'node:assert/strict'
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
