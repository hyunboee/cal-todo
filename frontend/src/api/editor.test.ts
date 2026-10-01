import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getFinal, publish, regenerate, saveEdit } from './editor.ts'
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

const preview = { version: 3, html: '<section></section>', blocks: [{ blockId: 'b1', fields: [{ editId: 'e1', text: '새 문구' }] }] }

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

describe('api/editor', () => {
  it('saveEdit → POST /api/projects/:id/edits, body 정확히 {blockId, editId, text, version}, Preview 반환', async () => {
    next = () => json(preview)
    assert.deepEqual(await saveEdit('p1', { blockId: 'b1', editId: 'e1', text: '새 문구' }, 2), preview)
    assert.equal(last().url, '/api/projects/p1/edits')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { blockId: 'b1', editId: 'e1', text: '새 문구', version: 2 })
    assert.deepEqual(Object.keys(body()).sort(), ['blockId', 'editId', 'text', 'version'])
  })

  it('regenerate → POST /api/projects/:id/regenerate, body {version}', async () => {
    next = () => json(preview)
    assert.deepEqual(await regenerate('p1', 2), preview)
    assert.equal(last().url, '/api/projects/p1/regenerate')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { version: 2 })
  })

  it('publish → POST /api/projects/:id/publish, body {version}, {finalHtml}', async () => {
    next = () => json({ finalHtml: '<div>최종</div>' })
    assert.deepEqual(await publish('p1', 4), { finalHtml: '<div>최종</div>' })
    assert.equal(last().url, '/api/projects/p1/publish')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { version: 4 })
  })

  it('getFinal → GET /api/projects/:id/final', async () => {
    next = () => json({ finalHtml: '<div>최종</div>' })
    assert.deepEqual(await getFinal('p1'), { finalHtml: '<div>최종</div>' })
    assert.equal(last().url, '/api/projects/p1/final')
    assert.equal(method(), 'GET')
  })

  it('getFinal 403 NOT_PUBLISHED → ApiError status·code·projectId', async () => {
    next = fail(403, 'NOT_PUBLISHED')
    await assert.rejects(getFinal('p1'), isErr(403, 'NOT_PUBLISHED'))
  })

  it('saveEdit 400 VALIDATION_FAILED', async () => {
    next = fail(400, 'VALIDATION_FAILED')
    await assert.rejects(saveEdit('p1', { blockId: 'b1', editId: 'e1', text: '<b>x</b>' }, 2), isErr(400, 'VALIDATION_FAILED'))
  })

  it('regenerate 429 REGEN_LIMIT', async () => {
    next = fail(429, 'REGEN_LIMIT')
    await assert.rejects(regenerate('p1', 2), isErr(429, 'REGEN_LIMIT'))
  })

  it('publish 402 INSUFFICIENT_CREDIT', async () => {
    next = fail(402, 'INSUFFICIENT_CREDIT')
    await assert.rejects(publish('p1', 4), isErr(402, 'INSUFFICIENT_CREDIT'))
  })

  it('saveEdit 409 VERSION_CONFLICT → ApiError.projectId 채움', async () => {
    next = fail(409, 'VERSION_CONFLICT')
    await assert.rejects(saveEdit('p1', { blockId: 'b1', editId: 'e1', text: 'x' }, 1), isErr(409, 'VERSION_CONFLICT'))
  })
})
