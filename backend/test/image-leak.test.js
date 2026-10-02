import { test, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as cheerio from 'cheerio'
import { pool } from '../src/db.js'
import { sanitizeHtml, extractBlocks } from '../src/lib/html.js'
import { roleModels, parseModel } from '../src/llm/index.js'
import { PUBLIC_IMAGE_BASE_URL, S3_ENDPOINT } from '../src/config.js'
import {
  truncateAll, createUser, insertProject, startServer, api, deepKeys, makeImage, upload, clearStorage, storageDir,
} from './helpers.js'

// BR-32, BR-50: 이미지 목록·교체·AI 변환 응답에 원본·프리뷰 키, 'asset:', 스토리지 경로, 공개 URL 0건(e2e.test.js 금지 목록과 같음)
const { base, close } = await startServer()
const originalModels = { ...roleModels }

after(async () => {
  await close()
  await pool.end()
})
beforeEach(async () => {
  await truncateAll()
  await clearStorage()
})
afterEach(() => Object.assign(roleModels, originalModels))

const ok = (r, status = 200) => {
  assert.equal(r.status, status, r.text)
  return r
}
const imgSrcs = (html) => cheerio.load(html, null, false)('img').toArray().map((el) => el.attribs.src ?? '')

test('BR-32: 목록·교체·AI 변환 응답 전수 검사 → 금지 문자열·키 0건, 퍼블리시 후 최종 HTML에 data-img-id 0건', async () => {
  roleModels.IMAGE = parseModel('mock:ok')
  const u = await createUser({ balance: 1 })
  const id = await insertProject(u.userId)
  const P = `/api/projects/${id}`
  const ids = []
  for (let i = 0; i < 3; i++) ids.push(ok(await upload(base, u.token, id, await makeImage()), 201).body.id)
  const draft = sanitizeHtml(`<section><h2>제목</h2><img src="asset:${ids[0]}" alt=""><img src="asset:${ids[1]}" alt=""></section><section><p>본문</p></section>`)
  await pool.query("UPDATE projects SET status = 'GENERATED', draft_html = $2 WHERE id = $1", [id, draft])
  const [b1] = extractBlocks(draft)
  const [img1, img2] = b1.images

  const res = []
  res.push(['assets', ok(await api(base, `${P}/assets`, { token: u.token }))])
  const edited = ok(await api(base, `${P}/image-edits`, {
    method: 'POST', token: u.token, body: { blockId: b1.blockId, imageId: img1.imageId, assetId: ids[2], version: 1 },
  }))
  res.push(['image-edits', edited])
  const ai = ok(await api(base, `${P}/ai-images`, {
    method: 'POST', token: u.token, body: { blockId: b1.blockId, imageId: img2.imageId, prompt: '배경을 흰색으로', version: edited.body.version },
  }))
  res.push(['ai-images', ai])
  res.push(['assets(AI 후)', ok(await api(base, `${P}/assets`, { token: u.token }))])
  res.push(['preview', ok(await api(base, `${P}/preview`, { token: u.token }))])
  assert.equal(res[3][1].body.length, 4)

  const keys = (await pool.query('SELECT original_key, preview_key FROM assets WHERE project_id = $1', [id])).rows
  assert.equal(keys.length, 4)
  const dir = await storageDir()
  const forbidden = [
    'orig/', 'prev/', 'asset:', dir, JSON.stringify(dir).slice(1, -1), PUBLIC_IMAGE_BASE_URL, ...(S3_ENDPOINT ? [S3_ENDPOINT] : []),
    '"finalHtml"', '"final_html"', '"draftHtml"', '"draft_html"', ...keys.flatMap((k) => [k.original_key, k.preview_key]),
  ]
  for (const [name, r] of res) {
    for (const s of forbidden) assert.equal(r.text.includes(s), false, `${name}: ${s}`)
    for (const k of ['finalHtml', 'draftHtml', 'originalKey', 'previewKey', 'publicKey', 'url', 'key']) {
      assert.equal(deepKeys(r.body).has(k), false, `${name}: ${k}`)
    }
    if (typeof r.body?.html === 'string') {
      const srcs = imgSrcs(r.body.html)
      assert.equal(srcs.length, 2, name)
      for (const src of srcs) assert.match(src, /^data:image\/webp;base64,/, name)
    }
  }

  const pub = ok(await api(base, `${P}/publish`, { method: 'POST', token: u.token, body: { version: ai.body.version } }))
  for (const s of ['data-img-id', 'data-block-id', 'data-edit-id', 'asset:', 'orig/', 'prev/']) {
    assert.equal(pub.body.finalHtml.includes(s), false, s)
  }
  const srcs = imgSrcs(pub.body.finalHtml)
  assert.equal(srcs.length, 2)
  for (const src of srcs) assert.ok(src.startsWith(`${PUBLIC_IMAGE_BASE_URL}/`), src)
  const fin = ok(await api(base, `${P}/final`, { token: u.token }))
  assert.equal(fin.body.finalHtml.includes('data-img-id'), false)
})
