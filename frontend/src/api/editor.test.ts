import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { aiImage, blockRegenerate, getFinal, listAssets, publish, regenerate, saveEdit, saveImageEdit, saveImageStyle } from './editor.ts'
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
  it('listAssets → GET /api/projects/:id/assets, [{id, thumbnail}] 반환', async () => {
    const assets = [{ id: 'a1', thumbnail: 'data:image/webp;base64,AAAA' }]
    next = () => json(assets)
    assert.deepEqual(await listAssets('p1'), assets)
    assert.equal(last().url, '/api/projects/p1/assets')
    assert.equal(method(), 'GET')
    assert.equal(last().init.body, undefined)
  })

  it('saveImageEdit → POST /api/projects/:id/image-edits, body 정확히 {blockId, imageId, assetId, version}', async () => {
    next = () => json(preview)
    assert.deepEqual(await saveImageEdit('p1', { blockId: 'b1', imageId: 'i1', assetId: 'a2' }, 3), preview)
    assert.equal(last().url, '/api/projects/p1/image-edits')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { blockId: 'b1', imageId: 'i1', assetId: 'a2', version: 3 })
  })

  it('aiImage → POST /api/projects/:id/ai-images, body 정확히 {blockId, imageId, prompt, version}', async () => {
    next = () => json(preview)
    assert.deepEqual(await aiImage('p1', { blockId: 'b1', imageId: 'i1', prompt: '배경을 흰색으로' }, 3), preview)
    assert.equal(last().url, '/api/projects/p1/ai-images')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { blockId: 'b1', imageId: 'i1', prompt: '배경을 흰색으로', version: 3 })
  })

  it('aiImage 429 AI_IMAGE_LIMIT → ApiError.projectId 채움', async () => {
    next = fail(429, 'AI_IMAGE_LIMIT')
    await assert.rejects(aiImage('p1', { blockId: 'b1', imageId: 'i1', prompt: 'x' }, 1), isErr(429, 'AI_IMAGE_LIMIT'))
  })

  it('blockRegenerate → POST /api/projects/:id/block-regenerate, body 정확히 {blockId, version}', async () => {
    next = () => json(preview)
    assert.deepEqual(await blockRegenerate('p1', 'b2', 4), preview)
    assert.equal(last().url, '/api/projects/p1/block-regenerate')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { blockId: 'b2', version: 4 })
  })

  it('blockRegenerate 429 BLOCK_REGEN_LIMIT → ApiError.projectId 채움', async () => {
    next = fail(429, 'BLOCK_REGEN_LIMIT')
    await assert.rejects(blockRegenerate('p1', 'b1', 1), isErr(429, 'BLOCK_REGEN_LIMIT'))
  })

  it('saveImageStyle → POST /api/projects/:id/image-styles, body 정확히 {blockId, imageId, widthPct, align, version}', async () => {
    next = () => json(preview)
    assert.deepEqual(await saveImageStyle('p1', { blockId: 'b1', imageId: 'i1', widthPct: 55, align: 'right' }, 5), preview)
    assert.equal(last().url, '/api/projects/p1/image-styles')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { blockId: 'b1', imageId: 'i1', widthPct: 55, align: 'right', version: 5 })
  })
})
