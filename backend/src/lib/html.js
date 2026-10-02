import * as cheerio from 'cheerio'
import { HTML_ROOT_WIDTH_PX } from '../config.js'

// LY-18: LLM 출력 HTML 정제의 단일 경계
const DROP = new Set(('script style link meta iframe object embed noscript template svg math form input button ' +
  'textarea select option head title base video audio canvas').split(' '))
const ALLOWED = new Set(('div section article header footer h1 h2 h3 h4 h5 h6 p span strong em b i u s small br hr ' +
  'ul ol li img table thead tbody tr th td figure figcaption blockquote').split(' '))
const CONTAINERS = new Set(['div', 'section', 'article', 'header', 'footer'])
const NOT_EDITABLE = new Set(['img', 'br', 'hr'])
// 문장 안 서식. 이것과 글자로만 된 요소는 문장 통째로 편집한다(서식은 편집 시 사라짐)
const INLINE = new Set(['strong', 'em', 'b', 'i', 'u', 's', 'small', 'span', 'br'])
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/
const ASSET_RE = /^asset:[0-9a-f-]{36}$/
// 계약의 4개 + CSS 이스케이프(\)·주석(/*)으로 우회하는 경우도 거부
const BAD_STYLE = /url\s*\(|expression\s*\(|javascript:|@import|\\|\/\*/i
const ROOT_STYLE = `width:${HTML_ROOT_WIDTH_PX}px;margin:0 auto`

const load = (html) => cheerio.load(html, null, false)

function clean($, parent) {
  for (const node of [...parent.children]) {
    if (node.type === 'text') continue
    if (node.type !== 'tag' || DROP.has(node.name)) {
      $(node).remove() // 주석·script·style 등은 내용째
      continue
    }
    clean($, node)
    if (!ALLOWED.has(node.name)) {
      $(node).replaceWith([...node.children]) // 벗기고 자식 유지
      continue
    }
    for (const attr of Object.keys(node.attribs)) {
      const keep = attr === 'style' ? !BAD_STYLE.test(node.attribs.style)
        : attr === 'data-block-id' || attr === 'data-edit-id' || (node.name === 'img' && (attr === 'alt' || attr === 'src' || attr === 'data-img-id'))
      if (!keep) delete node.attribs[attr]
    }
    if (node.name === 'img' && !ASSET_RE.test(node.attribs.src ?? '')) $(node).remove() // BR-32
  }
}

// 기존 값이 유효하고 중복이 아니면 유지, 아니면 가장 작은 미사용 prefix{n}
function assignIds(els, attr, prefix) {
  const used = new Set()
  const keep = els.map((el) => {
    const v = el.attribs[attr]
    const ok = v !== undefined && ID_RE.test(v) && !used.has(v)
    if (ok) used.add(v)
    return ok
  })
  let n = 1
  els.forEach((el, i) => {
    if (keep[i]) return
    while (used.has(prefix + n)) n++
    el.attribs[attr] = prefix + n
    used.add(prefix + n)
  })
}

const inlineOnly = (el) => el.children.every((c) => c.type === 'text' || (c.type === 'tag' && INLINE.has(c.name) && inlineOnly(c)))
const isEditable = (el) => !NOT_EDITABLE.has(el.name) && el.children.length > 0 && inlineOnly(el) && el.children.some(
  (c) => c.type === 'text' ? c.data.trim() : INLINE.has(c.name) && isEditable(c))

export function sanitizeHtml(html) {
  const $ = load(html)
  clean($, $.root()[0])

  // 루트 감싸개 벗기기(반복). img는 감싸개가 아니다(벗기면 이미지가 사라짐).
  let top = $.root().contents().toArray()
  for (;;) {
    const meaningful = top.filter((n) => n.type !== 'text' || n.data.trim())
    const only = meaningful[0]
    if (meaningful.length !== 1 || only.type !== 'tag' || only.attribs['data-block-id'] !== undefined || only.name === 'img') break
    top = [...only.children]
  }

  const root = $(`<div style="${ROOT_STYLE}"></div>`)
  for (const node of top) {
    if (node.type === 'text') {
      if (node.data.trim()) root.append($('<section><p></p></section>').find('p').text(node.data).end())
    } else {
      root.append(CONTAINERS.has(node.name) ? node : $('<section></section>').append(node))
    }
  }
  $.root().empty().append(root)

  const blocks = root.children().toArray()
  root.children().find('[data-block-id]').removeAttr('data-block-id')
  assignIds(blocks, 'data-block-id', 'b')

  // 블록 요소와 섞여 떠 있는 글자는 span으로 감싸 편집 대상에 넣는다
  for (const block of blocks) {
    for (const el of [block, ...$(block).find('*').toArray()]) {
      if (inlineOnly(el)) continue
      for (const c of [...el.children]) if (c.type === 'text' && c.data.trim()) $(c).wrap('<span></span>')
    }
  }

  // BE-07b: 글자(와 문장 안 서식)만 가진 가장 바깥 요소에만 편집 ID
  for (const block of blocks) {
    const els = [block, ...$(block).find('*').toArray()]
    const editable = els.filter(isEditable)
    const targets = editable.filter((el) => !$(el).parents().toArray().some((a) => editable.includes(a)))
    for (const el of editable) if (!targets.includes(el)) delete el.attribs['data-edit-id']
    for (const el of els) if (!editable.includes(el)) delete el.attribs['data-edit-id']
    assignIds(targets, 'data-edit-id', 'e')
    assignIds($(block).find('img').toArray(), 'data-img-id', 'i') // 이미지 교체·AI 변환 대상
  }
  return $.html()
}

const OVERLAY = '<div data-watermark="overlay" style="position:absolute;inset:0;display:flex;align-items:center;' +
  'justify-content:center;font-size:64px;font-weight:700;color:rgba(0,0,0,0.15);white-space:nowrap;' +
  'transform:rotate(-30deg);pointer-events:none;user-select:none;z-index:10">PREVIEW ONLY / 무단 복제 금지</div>'
const BLOCK_MARK = '<div data-watermark="block" style="position:absolute;inset:0;overflow:hidden;font-size:20px;' +
  'line-height:60px;word-break:break-all;color:rgba(0,0,0,0.12);pointer-events:none;user-select:none;z-index:10">' +
  'PREVIEW ONLY · 무단 복제 금지 · '.repeat(30) + '</div>'

// BR-31: 오버레이 1개 + 블록마다 1개
export function addWatermark(sanitizedHtml) {
  const $ = load(sanitizedHtml)
  const root = $.root().children().first()
  root.attr('style', `${root.attr('style') ?? ''};position:relative;overflow:hidden`)
  root.children('[data-block-id]').each((_, b) => {
    $(b).attr('style', `${$(b).attr('style') ?? ''};position:relative`).append(BLOCK_MARK)
  })
  root.prepend(OVERLAY)
  return $.html()
}

export function listAssetRefs(html) {
  const $ = load(html)
  return [...new Set($('img[src^="asset:"]').toArray().map((el) => el.attribs.src.slice(6)))]
}

// fn(assetId) -> url | null. null이면 img 제거
export function replaceImages(html, fn) {
  const $ = load(html)
  $('img[src^="asset:"]').each((_, el) => {
    const url = fn(el.attribs.src.slice(6))
    if (url === null) $(el).remove()
    else el.attribs.src = url
  })
  return $.html()
}

// FR-22, BR-52: 최종 HTML은 draft에서 만든다(워터마크 없음). 편집용 속성 제거
export function toFinalHtml(draftHtml, imageUrl = () => null) {
  const $ = load(replaceImages(draftHtml, imageUrl))
  $('[data-block-id]').removeAttr('data-block-id')
  $('[data-edit-id]').removeAttr('data-edit-id')
  $('[data-img-id]').removeAttr('data-img-id')
  return $.html()
}

// BE-10b: 편집 UI용 블록·필드 목록(문서 순서, text = 현재 텍스트)
// 편집 필드의 글자. <br>은 줄바꿈으로
function editText(el) {
  return el.children.map((c) => c.type === 'text' ? c.data : c.name === 'br' ? '\n' : c.type === 'tag' ? editText(c) : '').join('')
}

const escapeText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function extractBlocks(html) {
  const $ = load(html)
  return $.root().children().first().children('[data-block-id]').toArray().map((b) => ({
    blockId: b.attribs['data-block-id'],
    fields: [b, ...$(b).find('[data-edit-id]').toArray()]
      .filter((el) => el.attribs['data-edit-id'] !== undefined)
      .map((el) => ({ editId: el.attribs['data-edit-id'], text: editText(el) })),
    images: $(b).find('img[data-img-id]').toArray().filter((el) => ASSET_RE.test(el.attribs.src ?? ''))
      .map((el) => ({ imageId: el.attribs['data-img-id'], assetId: el.attribs.src.slice(6), ...imageStyle(el.attribs.style ?? '') })),
  }))
}

// applyImageStyle이 쓰는 style의 역. width 없으면 100, margin이 left·right 형태가 아니면 center
const styleProp = (style, prop) => style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))?.[1].trim()
function imageStyle(style) {
  const w = styleProp(style, 'width')?.match(/^(\d+(?:\.\d+)?)%$/)
  const l = styleProp(style, 'margin-left')
  const r = styleProp(style, 'margin-right')
  return { widthPct: w ? Number(w[1]) : 100, align: l === '0' && r === 'auto' ? 'left' : l === 'auto' && r === '0' ? 'right' : 'center' }
}

const findBlock = ($, blockId) => $.root().children().first().children().toArray().find((b) => b.attribs['data-block-id'] === blockId)

// FR-17, BR-40·BR-44: 블록 안 편집 요소의 내용을 글자로 교체(이스케이프, 줄바꿈은 <br>). 없으면 null
export function applyTextEdit(html, blockId, editId, text) {
  const $ = load(html)
  const block = $.root().children().first().children().toArray().find((b) => b.attribs['data-block-id'] === blockId)
  const el = block && [block, ...$(block).find('[data-edit-id]').toArray()].find((e) => e.attribs['data-edit-id'] === editId)
  if (!el) return null
  $(el).html(text.split('\n').map(escapeText).join('<br>'))
  return $.html()
}

// 블록 안 이미지의 asset을 교체. 없으면 null
export function applyImageEdit(html, blockId, imageId, assetId) {
  const $ = load(html)
  const block = $.root().children().first().children().toArray().find((b) => b.attribs['data-block-id'] === blockId)
  const el = block && $(block).find('img').toArray().find((e) => e.attribs['data-img-id'] === imageId)
  if (!el) return null
  el.attribs.src = `asset:${assetId}`
  return $.html()
}

// 이미지 폭(%)·정렬을 인라인 style로 설정(draft·최종 HTML에 남는다). 없으면 null
const MARGIN = { left: ['0', 'auto'], center: ['auto', 'auto'], right: ['auto', '0'] }
export function applyImageStyle(html, blockId, imageId, widthPct, align) {
  const $ = load(html)
  const block = findBlock($, blockId)
  const el = block && $(block).find('img').toArray().find((e) => e.attribs['data-img-id'] === imageId)
  if (!el) return null
  const [l, r] = MARGIN[align]
  el.attribs.style = `width:${widthPct}%;height:auto;display:block;margin-left:${l};margin-right:${r}`
  return $.html()
}

// 최상위 블록의 HTML. 없으면 null
export function blockHtml(html, blockId) {
  const $ = load(html)
  const block = findBlock($, blockId)
  return block ? $.html(block) : null
}

// 블록 재생성: LLM 조각에서 블록 하나만 골라 정제해 draft의 blockId 블록과 바꾼다. 쓸 내용이 없으면 null
// 고르는 순서: data-block-id가 같은 요소 → 첫 <section> → 조각 전체(최상위 설명문 제외). 코드펜스 표시는 어디 있든 지운다
export function replaceBlock(draftHtml, blockId, fragmentHtml) {
  const $f = load(fragmentHtml.replace(/```[a-z]*/gi, ''))
  $f('[data-edit-id]').removeAttr('data-edit-id') // 블록 안에서 새로 부여
  $f('[data-img-id]').removeAttr('data-img-id')
  const els = $f('*').toArray()
  const picked = els.find((e) => e.attribs['data-block-id'] === blockId) ?? els.find((e) => e.name === 'section')
  if (!picked) $f.root().contents().filter((_, n) => n.type === 'text').remove()
  // 블록 ID를 먼저 붙여야 정제가 하나뿐인 감싸개(section)를 벗기지 않는다
  if (picked) picked.attribs['data-block-id'] = blockId
  const one = picked ? $f.html(picked) : `<section data-block-id="${blockId}">${$f.html()}</section>`
  const $s = load(sanitizeHtml(one)) // LY-18: XSS·외부 이미지 제거
  const block = $s.root().children().first().children().first()
  if (!block.length || (!block.text().trim() && block.find('img').length === 0)) return null
  block.attr('data-block-id', blockId)
  const $ = load(draftHtml)
  $(findBlock($, blockId)).replaceWith($s.html(block))
  return sanitizeHtml($.html()) // 전체 한 번 더(기존 ID는 유지)
}
