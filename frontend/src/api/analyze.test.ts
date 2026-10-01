import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, saveUsps } from './analyze.ts'
import { ApiError, setOnAuthLost } from './client.ts'
import { useAuthStore } from '../stores/auth.ts'
import { queryClient } from '../queryClient.ts'

type Call = { url: string; init: RequestInit }

const realFetch = globalThis.fetch
let calls: Call[] = []
let next: () => Response

function mockFetch() {
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return Promise.resolve(next())
  }) as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const last = () => calls[calls.length - 1]
const method = () => last().init.method ?? 'GET'
const body = () => JSON.parse(last().init.body as string)
const fail = (status: number, code: string) => () => json({ error: { code, message: 'x' } }, status)
const isErr = (status: number, code: string) => (e: unknown) =>
  e instanceof ApiError && e.status === status && e.code === code && e.projectId === 'p1'

const URL_OK = 'https://www.coupang.com/vp/products/123'

beforeEach(() => {
  useAuthStore.getState().clear()
  queryClient.clear()
  calls = []
  next = () => json({})
  setOnAuthLost(() => {})
  mockFetch()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('api/analyze', () => {
  it('analyze → POST /api/projects/:id/analyze, body {url, version}, 결과 그대로', async () => {
    const a = { sourceUrl: URL_OK, uspCandidates: ['가볍다', '튼튼하다'], analyzedAt: '2026-10-01T00:00:00Z' }
    next = () => json(a)
    assert.deepEqual(await analyze('p1', URL_OK, 1), a)
    assert.equal(last().url, '/api/projects/p1/analyze')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { url: URL_OK, version: 1 })
  })

  it('saveUsps → PUT /api/projects/:id/usps, body {selectedUsps, version}, Project 반환', async () => {
    next = () => json({ id: 'p1', status: 'ANALYZED', version: 3 })
    assert.deepEqual(await saveUsps('p1', ['가볍다'], 2), { id: 'p1', status: 'ANALYZED', version: 3 })
    assert.equal(last().url, '/api/projects/p1/usps')
    assert.equal(method(), 'PUT')
    assert.deepEqual(body(), { selectedUsps: ['가볍다'], version: 2 })
  })

  it('analyze 400 VALIDATION_FAILED', async () => {
    next = fail(400, 'VALIDATION_FAILED')
    await assert.rejects(analyze('p1', 'https://example.com', 1), isErr(400, 'VALIDATION_FAILED'))
  })

  it('analyze 429 ANALYZE_LIMIT', async () => {
    next = fail(429, 'ANALYZE_LIMIT')
    await assert.rejects(analyze('p1', URL_OK, 1), isErr(429, 'ANALYZE_LIMIT'))
  })

  it('analyze 502 UPSTREAM_FAILED', async () => {
    next = fail(502, 'UPSTREAM_FAILED')
    await assert.rejects(analyze('p1', URL_OK, 1), isErr(502, 'UPSTREAM_FAILED'))
  })
})
