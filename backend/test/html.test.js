import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as cheerio from 'cheerio'
import { sanitizeHtml, addWatermark, listAssetRefs, replaceImages, extractBlocks, applyTextEdit } from '../src/lib/html.js'

// DB 미사용(pool.end 불필요). 결과는 cheerio 조각 모드로 검사한다.
const load = (html) => cheerio.load(html, null, false)
const A = randomUUID()
const B = randomUUID()
const ID = /^[A-Za-z0-9_-]{1,32}$/

// 계약 3.1 MOCK_MAIN_HTML({IMGS} = asset A)
const MOCK = `<section><h2>핵심 특징</h2><p class="lead" onclick="alert(1)">가볍고 강력한 흡입력</p></section>
<script>alert(1)</script>
<section data-block-id="b1"><h3>사용 방법</h3><p>충전 후 버튼을 누르세요</p><img src="asset:${A}" alt=""></section>
<div style="background:url(https://evil.example/x.png)"><p><a href="javascript:alert(1)">자세히</a></p></div>
<link rel="stylesheet" href="https://evil.example/x.css"><style>p{color:red}</style>`

const EVIL = `<!-- secret comment -->
<section id="s" class="hero" onmouseover="x()"><h1 style="color:red">제목</h1>
  <img src="https://evil.example/a.png" onerror="alert(1)" alt="외부">
  <img src="asset:${B}" onerror="alert(2)" alt="내부" class="c">
  <img src="asset:not-a-uuid" alt="형식 오류">
  <iframe src="https://evil.example"></iframe><svg onload="alert(1)"><circle/></svg>
  <p style="background:url(javascript:alert(1))">스타일1</p><p style="width:expression(alert(1))">스타일2</p>
  <p style="@import 'x.css'">스타일3</p><p style="color:JavaScript:alert(1)">스타일4</p>
  <font color="red"><b>굵게</b></font><form><input value="x"><button>b</button></form>
  <object data="x"></object><embed src="x"><noscript>ns</noscript><template><p>t</p></template>
  <video src="x"></video><audio src="x"></audio><canvas></canvas><math><mi>x</mi></math>
  <base href="https://evil.example/"><meta http-equiv="refresh" content="0">
</section>`

const blocksOf = ($) => $.root().children().first().children().toArray()

function assertClean(out) {
  const $ = load(out)
  assert.equal($('script, link, style, iframe, svg, math, form, input, button, object, embed, noscript, template, video, audio, canvas, base, meta, a, font').length, 0, out)
  $('*').each((_, el) => {
    for (const name of Object.keys(el.attribs)) {
      assert.ok(['style', 'data-block-id', 'data-edit-id', 'data-img-id', 'alt', 'src'].includes(name), `${el.tagName}[${name}]`)
      if (name === 'src') assert.equal(el.tagName, 'img')
      if (name === 'alt') assert.equal(el.tagName, 'img')
      if (name === 'data-img-id') assert.equal(el.tagName, 'img')
    }
  })
  $('img').each((_, el) => assert.match(el.attribs.src, /^asset:[0-9a-f-]{36}$/))
  assert.doesNotMatch(out, /javascript:|expression\(|url\(|@import|<!--|evil\.example|\son\w+=|\sclass=/i)

  const roots = $.root().children()
  assert.equal(roots.length, 1)
  assert.equal(roots[0].tagName, 'div')
  assert.ok(roots.attr('style').replace(/\s/g, '').includes('width:780px'), roots.attr('style'))
  assert.equal($.root().contents().length, 1, '루트 밖 노드 없음')
  const ids = blocksOf($).map((b) => b.attribs['data-block-id'])
  assert.ok(ids.every((id) => ID.test(id)), JSON.stringify(ids))
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids))
  $('[data-block-id]').each((_, el) => assert.equal(el.parent, roots[0], '블록 밖 data-block-id'))
  return $
}

// 편집 대상 = 자식이 텍스트 노드뿐이고 trim 텍스트가 비지 않은 요소(img·br·hr 제외)
const isTarget = ($, el) => !['img', 'br', 'hr'].includes(el.tagName) && el.children.length > 0
  && el.children.every((c) => c.type === 'text') && $(el).text().trim() !== ''

function editIdsPerBlock($) {
  return blocksOf($).map((block) => {
    const ids = []
    for (const el of [block, ...$(block).find('*').toArray()]) {
      assert.equal('data-edit-id' in el.attribs, isTarget($, el), `${el.tagName} "${$(el).text()}"`)
      if (isTarget($, el)) ids.push(el.attribs['data-edit-id'])
    }
    assert.ok(ids.every((id) => ID.test(id)), JSON.stringify(ids))
    assert.equal(new Set(ids).size, ids.length, `블록 안 중복: ${JSON.stringify(ids)}`)
    return ids
  })
}

test('BE-07a ① [P0] 악성 샘플 정제 → script·link·style·class·on*·javascript: 0개, 최상위 섹션마다 고유 data-block-id', () => {
  const $ = assertClean(sanitizeHtml(MOCK))
  const blocks = blocksOf($)
  assert.equal(blocks.length, 3)
  assert.ok(blocks.some((b) => b.attribs['data-block-id'] === 'b1'), '유효한 기존 블록 ID 유지')
  assert.equal($(blocks[2]).text().trim(), '자세히', 'a는 벗기고 텍스트 유지')
  assert.equal($(blocks[2]).attr('style'), undefined, 'url( 포함 style 통째 제거')
  assert.deepEqual($('img').toArray().map((i) => i.attribs.src), [`asset:${A}`])

  const e = assertClean(sanitizeHtml(EVIL))
  assert.deepEqual(e('img').toArray().map((i) => [i.attribs.src, i.attribs.alt]), [[`asset:${B}`, '내부']])
  assert.equal(e('h1').attr('style'), 'color:red', '안전한 style 유지')
  assert.equal(e('b').text(), '굵게', 'font는 벗기고 자식 유지')
  for (const t of ['스타일1', '스타일2', '스타일3', '스타일4']) {
    assert.equal(e(`p:contains("${t}")`).attr('style'), undefined, t)
  }
  assert.ok(!sanitizeHtml(EVIL).includes('secret comment'))
})

test('BE-07a ① 루트: 감싸개 벗김, 최상위 텍스트·비블록 요소는 section으로, 결과는 780px div 1개', () => {
  const wrapped = assertClean(sanitizeHtml('<div><div><section><p>가</p></section><section><p>나</p></section></div></div>'))
  assert.deepEqual(blocksOf(wrapped).map((b) => [b.tagName, wrapped(b).text()]), [['section', '가'], ['section', '나']])

  const loose = assertClean(sanitizeHtml('  일반 텍스트 <p>문단</p>\n<h2>제목</h2> <article><p>본문</p></article>'))
  const blocks = blocksOf(loose)
  assert.deepEqual(blocks.map((b) => [b.tagName, loose(b).text().trim()]),
    [['section', '일반 텍스트'], ['section', '문단'], ['section', '제목'], ['article', '본문']])
  assert.equal(loose(blocks[0]).children('p').length, 1, '텍스트는 <section><p>')

  const single = assertClean(sanitizeHtml('<section data-block-id="keep"><p>하나</p></section>'))
  assert.deepEqual(blocksOf(single).map((b) => b.attribs['data-block-id']), ['keep'], 'data-block-id 있는 단일 요소는 벗기지 않음')
})

test('BE-07a ① 블록 ID: 형식 오류·중복은 b{n} 재부여, 블록 밖 data-block-id 제거', () => {
  const $ = assertClean(sanitizeHtml(`<section data-block-id="dup"><p data-block-id="inner">a</p></section>
<section data-block-id="dup"><p>b</p></section><section data-block-id="bad id!"><p>c</p></section>
<section data-block-id="${'x'.repeat(33)}"><p>d</p></section><section><p>e</p></section>`))
  const ids = blocksOf($).map((b) => b.attribs['data-block-id'])
  assert.equal(ids.length, 5)
  assert.equal(ids[0], 'dup')
  for (const id of ids.slice(1)) assert.match(id, /^b\d+$/)
  assert.equal($('p[data-block-id]').length, 0)
})

test('BE-07a ② 정제를 두 번 적용한 결과 = 한 번 적용한 결과', () => {
  for (const html of [MOCK, EVIL, '텍스트만', '<div><p>x</p></div>', '']) {
    const once = sanitizeHtml(html)
    assert.equal(sanitizeHtml(once), once, html)
  }
})

test('BE-07a ③ 워터마크: 오버레이 1개 + 블록 수만큼 블록 워터마크(각 블록 안 1개)', () => {
  const clean = sanitizeHtml(MOCK)
  const $ = load(addWatermark(clean))
  const root = $.root().children()
  assert.equal(root.length, 1)
  assert.match(root.attr('style'), /position:relative/)
  assert.match(root.attr('style'), /overflow:hidden/)

  const overlay = $('[data-watermark="overlay"]')
  assert.equal(overlay.length, 1)
  assert.equal(root.children().first().attr('data-watermark'), 'overlay', '루트 첫 자식')
  assert.match(overlay.attr('style'), /rotate\(-30deg\)/)
  assert.match(overlay.attr('style'), /pointer-events:none/)
  assert.ok(overlay.text().includes('PREVIEW ONLY'))

  const blocks = root.children('[data-block-id]').toArray()
  assert.equal(blocks.length, 3)
  assert.equal($('[data-watermark="block"]').length, blocks.length)
  for (const b of blocks) {
    const marks = $(b).find('[data-watermark="block"]')
    assert.equal(marks.length, 1)
    assert.equal($(b).children().last().attr('data-watermark'), 'block', '블록 마지막 자식')
    assert.match($(b).attr('style'), /position:relative/)
    assert.match(marks.attr('style'), /pointer-events:none/)
    assert.ok(marks.text().includes('PREVIEW ONLY'))
  }
})

test('BE-07b ① 편집 대상 텍스트 요소마다 data-edit-id, 블록 안 중복 없음(MOCK [2,2,1])', () => {
  assert.deepEqual(editIdsPerBlock(load(sanitizeHtml(MOCK))).map((ids) => ids.length), [2, 2, 1])

  const $ = load(sanitizeHtml(`<section><p data-edit-id="x">a</p><p data-edit-id="x">b</p><p data-edit-id="bad id!">c</p>
<div data-edit-id="nottarget"><p>d</p></div><p data-edit-id="e1">e</p><p>  </p><br><img src="asset:${A}" alt="i"></section>
<section>블록 자체 텍스트</section><section><p data-edit-id="x">다른 블록은 같은 값 허용</p></section>`))
  const ids = editIdsPerBlock($)
  assert.deepEqual(ids.map((b) => b.length), [5, 1, 1])
  assert.equal(ids[0][0], 'x')
  assert.ok(!ids[0].slice(1, 4).includes('x'))
  assert.equal(ids[2][0], 'x')
  assert.equal($('section > div').attr('data-edit-id'), undefined, '대상 아닌 요소의 data-edit-id 제거')
})

test('BE-07b ② 정제 두 번 = 한 번(data-edit-id 값 유지), 유효한 기존 ID 유지', () => {
  for (const html of [MOCK, EVIL, '<section><p data-edit-id="x">a</p><p data-edit-id="x">b</p></section>']) {
    const once = sanitizeHtml(html)
    assert.equal(sanitizeHtml(once), once)
  }
  const $ = load(sanitizeHtml('<section data-block-id="b7"><p data-edit-id="e9">x</p><h2 data-edit-id="title">t</h2></section>'))
  assert.equal($('section').attr('data-block-id'), 'b7')
  assert.deepEqual($('[data-edit-id]').toArray().map((e) => e.attribs['data-edit-id']), ['e9', 'title'])
})

test('BE-07b ② 추가: listAssetRefs 문서 순서·중복 제거, replaceImages는 url로 교체·null이면 img 제거', () => {
  const html = sanitizeHtml(`<section><img src="asset:${B}" alt="b"><img src="asset:${A}" alt="a"></section>
<section><img src="asset:${B}" alt="b2"><p>t</p></section>`)
  assert.deepEqual(listAssetRefs(html), [B, A])
  assert.deepEqual(listAssetRefs('<section><p>x</p></section>'), [])

  const out = replaceImages(html, (id) => (id === B ? 'data:image/webp;base64,AAAA' : null))
  const $ = load(out)
  assert.deepEqual($('img').toArray().map((i) => [i.attribs.src, i.attribs.alt]),
    [['data:image/webp;base64,AAAA', 'b'], ['data:image/webp;base64,AAAA', 'b2']])
  assert.ok(!out.includes(`asset:${A}`))
  assert.equal($('p').text(), 't')
})

test('서식이 섞인 문장·줄바꿈·떠 있는 글자도 편집 대상(화면 직접 편집), 저장 시 줄바꿈은 <br>, 글자는 이스케이프', () => {
  const html = sanitizeHtml('<section><p>정가 <s>39,900원</s> → <strong>29,900원</strong> 할인</p><ul><li>첫째<br>둘째</li></ul><div>안내<p>하위</p></div></section>')
  const fields = extractBlocks(html).flatMap((b) => b.fields.map((f) => f.text))
  assert.deepEqual(fields, ['정가 39,900원 → 29,900원 할인', '첫째\n둘째', '안내', '하위'])
  const $ = load(html)
  assert.equal($('s[data-edit-id], strong[data-edit-id]').length, 0, '바깥 문장만 편집 ID')
  const li = extractBlocks(html).find((b) => b.fields[0]?.text === '첫째\n둘째')
  const edited = applyTextEdit(html, li.blockId, li.fields[0].editId, '새 줄\n<b>아님</b> & 끝')
  assert.match(edited, /<li data-edit-id="[^"]+">새 줄<br>&lt;b&gt;아님&lt;\/b&gt; &amp; 끝<\/li>/)
  assert.equal(extractBlocks(edited).find((b) => b.blockId === li.blockId).fields[0].text, '새 줄\n<b>아님</b> & 끝')
})
