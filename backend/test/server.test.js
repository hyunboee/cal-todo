import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start } from '../src/server.js'

// shutdown()이 stopJobs()·pool.end()까지 하므로 after에서 pool.end를 호출하지 않는다.
// startJobs 타이머가 남으면 이 파일의 테스트 프로세스가 끝나지 않는다(stopJobs 확인).
test('BE-01a ② start → listening 로그·/healthz 200, shutdown → 서버 종료, 중복 호출 무시', async (t) => {
  const log = t.mock.method(console, 'log', () => {})
  const { server, shutdown } = await start({ port: 0 })
  const { port } = server.address()
  assert.ok(port > 0)

  const lines = log.mock.calls.map((c) => JSON.parse(c.arguments[0]))
  const listening = lines.find((l) => l.msg === 'listening')
  assert.equal(listening.level, 'info')
  assert.equal(listening.port, port)
  assert.equal(typeof listening.ts, 'string')

  const res = await fetch(`http://127.0.0.1:${port}/healthz`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'ok' })

  await shutdown()
  assert.equal(server.listening, false)
  await shutdown()
})
