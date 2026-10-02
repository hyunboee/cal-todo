import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/db.js'
import { migrate } from '../scripts/migrate.js'

const backendDir = fileURLToPath(new URL('..', import.meta.url))
const badDir = fileURLToPath(new URL('./fixtures/bad-migrations/', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../docs/schema.sql', import.meta.url))
const initPath = fileURLToPath(new URL('../migrations/001_init.sql', import.meta.url))
const aiImagePath = fileURLToPath(new URL('../migrations/002_ai_image.sql', import.meta.url))
const blockRegenPath = fileURLToPath(new URL('../migrations/003_block_regen.sql', import.meta.url))

const runCli = (...args) =>
  spawnSync(process.execPath, ['--env-file=.env.test', 'scripts/migrate.js', ...args], { cwd: backendDir, encoding: 'utf8' })

after(() => pool.end())

test('DB-01 ① 11개 테이블 + schema_migrations 생성', async () => {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)
  assert.deepEqual(rows.map(r => r.table_name), [
    'analysis_results', 'assets', 'credit_ledger', 'credit_wallets', 'edit_operations', 'llm_usage_logs',
    'projects', 'publish_records', 'refresh_tokens', 'schema_migrations', 'user_providers', 'users',
  ])
  const m = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '001_init.sql'")
  assert.equal(m.rowCount, 1)
})

test('DB-01 ② 두 번째 실행 시 적용 0건(함수)', async (t) => {
  const log = t.mock.method(console, 'log', () => {})
  assert.deepEqual(await migrate(), [])
  assert.ok(log.mock.calls.some(c => String(c.arguments[0]).includes('migrations applied: 0')))
})

test('DB-01 ② 두 번째 실행 시 적용 0건, 오류 없음(CLI)', () => {
  const r = runCli()
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('migrations applied: 0'), r.stdout)
})

test('DB-01 ③ 오류 SQL 파일 → 롤백, schema_migrations 미기록(함수)', async (t) => {
  t.mock.method(console, 'log', () => {})
  await assert.rejects(migrate(badDir), (e) => e.message.startsWith('999_bad.sql'))
  const probe = await pool.query("SELECT to_regclass('public.bad_probe') AS t")
  assert.equal(probe.rows[0].t, null)
  const m = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '999_bad.sql'")
  assert.equal(m.rowCount, 0)
})

test('DB-01 ③ 오류 SQL 파일 → 종료 코드 1, stderr migrate failed(CLI)', async () => {
  const r = runCli(badDir)
  assert.equal(r.status, 1)
  assert.ok(r.stderr.includes('migrate failed: 999_bad.sql'), r.stderr)
  const probe = await pool.query("SELECT to_regclass('public.bad_probe') AS t")
  assert.equal(probe.rows[0].t, null)
})

test('DB-01 ④ 001_init.sql + 002_ai_image.sql + 003_block_regen.sql과 docs/schema.sql의 diff가 BEGIN/COMMIT뿐', () => {
  const lf = (s) => s.replace(/\r\n/g, '\n')
  const expected = lf(readFileSync(schemaPath, 'utf8'))
    .split('\n').filter(l => l !== 'BEGIN;' && l !== 'COMMIT;').join('\n')
  assert.equal(lf(readFileSync(initPath, 'utf8')) + lf(readFileSync(aiImagePath, 'utf8')) + lf(readFileSync(blockRegenPath, 'utf8')), expected)
})

test('DB-01 ⑤ credit_ledger_project_deduct_uq 부분 유니크, credit_wallets CHECK(>= 0)', async () => {
  const idx = await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'credit_ledger_project_deduct_uq'")
  assert.equal(idx.rowCount, 1)
  assert.ok(idx.rows[0].indexdef.includes('UNIQUE'), idx.rows[0].indexdef)
  assert.ok(idx.rows[0].indexdef.includes("WHERE (reason = 'DEDUCT'"), idx.rows[0].indexdef)

  const ck = await pool.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conname IN ('credit_wallets_subscription_balance_ck', 'credit_wallets_topup_balance_ck')`)
  assert.equal(ck.rowCount, 2)
  for (const r of ck.rows) assert.ok(r.def.includes('>= 0'), `${r.conname}: ${r.def}`)
})

test('DB-01 ⑥ projects 카운트 CHECK 4개가 >= 0 하한만(3, 6 없음, DEC-04)', async () => {
  const ck = await pool.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conname IN ('projects_regen_count_ck', 'projects_analyze_count_ck',
                       'projects_ai_edit_count_ck', 'projects_ai_edit_fail_count_ck')`)
  assert.equal(ck.rowCount, 4)
  for (const r of ck.rows) {
    assert.ok(r.def.includes('>= 0'), `${r.conname}: ${r.def}`)
    assert.doesNotMatch(r.def, /\b[36]\b/, `${r.conname}: ${r.def}`)
  }
})
