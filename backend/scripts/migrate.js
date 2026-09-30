// OP-10: 전진 전용 마이그레이션. 파일마다 TX로 실행하고 schema_migrations에 기록한다.
// 사용: node --env-file=.env scripts/migrate.js [dir]
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query, withTx } from '../src/db.js'

const DEFAULT_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const FILE_RE = /^\d{3}_[a-z0-9_]+\.sql$/ // NM-13

// ponytail: advisory lock 없음(배포 시 1회 실행 전제). 동시 실행이 필요해지면 pg_advisory_lock 추가
// ponytail: statement_timeout 5s가 마이그레이션에도 적용됨. 긴 마이그레이션은 파일 안에서 SET LOCAL statement_timeout = 0
export async function migrate(dir = DEFAULT_DIR) {
  dir = resolve(dir)
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  const pending = readdirSync(dir).filter((f) => FILE_RE.test(f) && !done.has(f)).sort()

  const applied = []
  for (const name of pending) {
    const sql = readFileSync(join(dir, name), 'utf8')
    try {
      await withTx(async (client) => {
        await client.query(sql) // 파라미터 없음 → simple protocol이라 여러 문장 실행 가능
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
      })
    } catch (e) {
      e.message = `${name}: ${e.message}`
      throw e
    }
    console.log(`applied ${name}`)
    applied.push(name)
  }
  console.log(`migrations applied: ${applied.length}`)
  return applied
}

if (import.meta.main) {
  try {
    await migrate(process.argv[2])
  } catch (e) {
    console.error(`migrate failed: ${e.message}`)
    process.exitCode = 1
  }
  await pool.end()
}
