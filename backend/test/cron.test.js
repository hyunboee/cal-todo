import { test, after } from 'node:test'
import assert from 'node:assert/strict'

// config는 import 시점에 env를 읽는다. 이 파일은 별도 프로세스라 여기서만 CRON_SECRET을 켠다
process.env.CRON_SECRET = 'cron-test-secret'
const { pool } = await import('../src/db.js')
const { truncateAll, createUser, insertProject, startServer } = await import('./helpers.js')
const { base, close } = await startServer()

after(async () => {
  await close()
  await pool.end()
})

test('Vercel Cron: GET /api/internal/jobs는 Bearer CRON_SECRET만 허용하고 만료 선점을 해제한다', async () => {
  await truncateAll()
  const u = await createUser()
  const id = await insertProject(u.userId, { activeJobType: 'GENERATE' })
  await pool.query("UPDATE projects SET active_job_started_at = now() - interval '10 minutes' WHERE id = $1", [id])

  assert.equal((await fetch(`${base}/api/internal/jobs`)).status, 401)
  assert.equal((await fetch(`${base}/api/internal/jobs`, { headers: { Authorization: 'Bearer wrong' } })).status, 401)
  const ok = await fetch(`${base}/api/internal/jobs`, { headers: { Authorization: 'Bearer cron-test-secret' } })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { status: 'ok' })
  const row = (await pool.query('SELECT active_job_type FROM projects WHERE id = $1', [id])).rows[0]
  assert.equal(row.active_job_type, null)
})

test('Vercel 엔트리(index.js)는 Express 앱을 default export한다', async () => {
  const app = (await import('../index.js')).default
  assert.equal(typeof app, 'function')
  assert.equal(typeof app.listen, 'function')
})
