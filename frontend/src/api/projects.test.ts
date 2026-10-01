import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getMe, login, logout, signup } from './auth.ts'
import { createProject, generate, getPreview, getProject, listProjects, saveForm, uploadAsset } from './projects.ts'
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

const cred = { email: 'a@b.c', password: 'password1' }

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

describe('api/auth', () => {
  it('signup → POST /api/auth/signup, body 자격 증명, 201 토큰', async () => {
    next = () => json({ accessToken: 't', expiresIn: 900 }, 201)
    assert.deepEqual(await signup(cred), { accessToken: 't', expiresIn: 900 })
    assert.equal(last().url, '/api/auth/signup')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), cred)
  })

  it('login → POST /api/auth/login, body 자격 증명', async () => {
    next = () => json({ accessToken: 't', expiresIn: 900 })
    assert.deepEqual(await login(cred), { accessToken: 't', expiresIn: 900 })
    assert.equal(last().url, '/api/auth/login')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), cred)
  })

  it('logout → POST /api/auth/logout, 204 → undefined', async () => {
    next = () => new Response(null, { status: 204 })
    assert.equal(await logout(), undefined)
    assert.equal(last().url, '/api/auth/logout')
    assert.equal(method(), 'POST')
  })

  it('getMe → GET /api/me', async () => {
    next = () => json({ email: 'a@b.c', emailVerified: true, balance: 3 })
    assert.deepEqual(await getMe(), { email: 'a@b.c', emailVerified: true, balance: 3 })
    assert.equal(last().url, '/api/me')
    assert.equal(method(), 'GET')
  })
})

describe('api/projects', () => {
  it('listProjects → GET /api/projects, 배열 그대로', async () => {
    next = () => json([{ id: 'p1' }, { id: 'p2' }])
    assert.deepEqual(await listProjects(), [{ id: 'p1' }, { id: 'p2' }])
    assert.equal(last().url, '/api/projects')
    assert.equal(method(), 'GET')
  })

  it('getProject → GET /api/projects/:id', async () => {
    next = () => json({ id: 'p1' })
    assert.deepEqual(await getProject('p1'), { id: 'p1' })
    assert.equal(last().url, '/api/projects/p1')
    assert.equal(method(), 'GET')
  })

  it('getProject 409 → ApiError.projectId 채움', async () => {
    next = () => json({ error: { code: 'INVALID_STATE', message: 'x' } }, 409)
    await assert.rejects(getProject('p1'), (e: unknown) =>
      e instanceof ApiError && e.status === 409 && e.code === 'INVALID_STATE' && e.projectId === 'p1')
  })

  it('createProject → POST /api/projects, body {form}', async () => {
    next = () => json({ id: 'p1' }, 201)
    assert.deepEqual(await createProject({ productName: '컵' }), { id: 'p1' })
    assert.equal(last().url, '/api/projects')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { form: { productName: '컵' } })
  })

  it('saveForm → PUT /api/projects/:id/form, body {form, version}', async () => {
    next = () => json({ id: 'p1', version: 3 })
    await saveForm('p1', { intro: '소개' }, 2)
    assert.equal(last().url, '/api/projects/p1/form')
    assert.equal(method(), 'PUT')
    assert.deepEqual(body(), { form: { intro: '소개' }, version: 2 })
  })

  it('uploadAsset → POST /api/projects/:id/assets, FormData file 1장', async () => {
    next = () => json({ id: 'a1' }, 201)
    const file = new Blob(['img'], { type: 'image/png' })
    assert.deepEqual(await uploadAsset('p1', file), { id: 'a1' })
    assert.equal(last().url, '/api/projects/p1/assets')
    assert.equal(method(), 'POST')
    const fd = last().init.body
    assert.ok(fd instanceof FormData)
    const sent = fd.get('file')
    assert.ok(sent instanceof Blob)
    assert.equal(sent.size, file.size)
    assert.equal(fd.getAll('file').length, 1)
  })

  it('generate → POST /api/projects/:id/generate, body {version}', async () => {
    next = () => json({ version: 2, html: '<section></section>', blocks: [] })
    assert.deepEqual(await generate('p1', 1), { version: 2, html: '<section></section>', blocks: [] })
    assert.equal(last().url, '/api/projects/p1/generate')
    assert.equal(method(), 'POST')
    assert.deepEqual(body(), { version: 1 })
  })

  it('getPreview → GET /api/projects/:id/preview', async () => {
    next = () => json({ version: 2, html: '', blocks: [] })
    assert.deepEqual(await getPreview('p1'), { version: 2, html: '', blocks: [] })
    assert.equal(last().url, '/api/projects/p1/preview')
    assert.equal(method(), 'GET')
  })
})
