import { once } from 'node:events'
import { PORT } from './config.js'
import { pool } from './db.js'
import { createApp } from './app.js'
import { startJobs, stopJobs } from './jobs/index.js'

export async function start({ port = PORT } = {}) {
  const server = createApp().listen(port)
  await once(server, 'listening')
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'listening', port: server.address().port }))
  await startJobs()

  // OP-12: server.close() → pool.end(). 중복 호출은 같은 Promise를 돌려준다.
  let closing
  const shutdown = () => (closing ??= (async () => {
    stopJobs()
    await new Promise((r) => server.close(r))
    await pool.end()
  })())

  return { server, shutdown }
}

if (import.meta.main) {
  const { shutdown } = await start()
  // Windows는 SIGTERM을 실제로 받을 수 없어 SIGINT(Ctrl+C)도 연결한다.
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => shutdown().then(() => process.exit(0)))
}
