import { useEffect, useRef } from 'react'
import type { EditInput, ImageRef } from '../api/editor.ts'
import styles from './PreviewFrame.module.css'

// 본문 기본 여백을 없애 780px 루트가 iframe 폭 안에 들어가게 한다(가로 스크롤 방지)
const BASE_STYLE = '<style>html{overflow-x:hidden}body{margin:0}</style>'
// 화면 직접 편집 표시. iframe 안이라 토큰 대신 값(--color-accent #4f63ff)
const EDIT_STYLE = '[data-edit-id][contenteditable=plaintext-only]{cursor:text;outline:2px solid transparent;outline-offset:2px;border-radius:2px}' +
  '[data-edit-id][contenteditable=plaintext-only]:hover{outline-color:rgba(79,99,255,.45)}' +
  '[data-edit-id][contenteditable=plaintext-only]:focus{outline-color:#4f63ff}' +
  'img[data-img-id]{cursor:pointer;outline:2px solid transparent;outline-offset:-2px}' +
  'img[data-img-id]:hover{outline-color:rgba(79,99,255,.45)}' +
  'img[data-selected]{outline:2px solid #4f63ff}'

type Props = {
  html: string
  // 있으면 문구를 화면에서 직접 고친다. false를 돌려주면(저장 실패) 원래 글자로 되돌린다
  onEdit?: (i: EditInput) => Promise<boolean>
  onSelect?: (blockId: string) => void
  onImageSelect?: (r: ImageRef) => void
  selectedImage?: ImageRef | null
  editable?: boolean
}

// 편집 글자: 워터마크는 빼고, <br>·줄 요소는 줄바꿈으로
function readText(node: Node): string {
  let out = ''
  for (const c of node.childNodes) {
    if (c.nodeType === Node.TEXT_NODE) out += c.textContent ?? ''
    // iframe 문서의 요소라 instanceof Element 대신 nodeType으로 판별
    else if (c.nodeType === Node.ELEMENT_NODE && !(c as Element).hasAttribute('data-watermark')) {
      const tag = (c as Element).tagName
      if (tag === 'BR') out += '\n'
      else out += (tag === 'DIV' || tag === 'P') && out ? '\n' + readText(c) : readText(c)
    }
  }
  return out
}

// LY-12: sandbox에 스크립트 허용은 넣지 않는다(iframe 안 스크립트 실행 불가). allow-same-origin은 앱이 문구를 편집 상태로 만들기 위해서만 둔다
export function PreviewFrame({ html, onEdit, onSelect, onImageSelect, selectedImage, editable = false }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const scrollY = useRef(0)
  const cbs = useRef({ onEdit, onSelect, onImageSelect })
  cbs.current = { onEdit, onSelect, onImageSelect }
  const canEdit = editable && !!onEdit

  // 문서가 바뀔 때마다(저장 후 새 프리뷰) 이벤트를 다시 건다. 스크롤 위치는 유지한다
  useEffect(() => {
    const f = ref.current!
    const setup = () => {
      const doc = f.contentDocument
      const win = f.contentWindow
      if (!doc || !win) return
      win.scrollTo(0, scrollY.current)
      win.addEventListener('scroll', () => { scrollY.current = win.scrollY })
      const style = doc.createElement('style')
      style.textContent = EDIT_STYLE
      doc.head.append(style)
      const saved = new WeakMap<Element, string>()
      const target = (e: Event) => (e.target as Element | null)?.closest?.('[data-edit-id][contenteditable=plaintext-only]') as HTMLElement | null
      doc.addEventListener('click', (e) => {
        const img = (e.target as Element | null)?.closest?.('img[data-img-id]')
        const blockId = img?.closest('[data-block-id]')?.getAttribute('data-block-id')
        const imageId = img?.getAttribute('data-img-id')
        if (!blockId || !imageId) return
        e.preventDefault()
        cbs.current.onSelect?.(blockId)
        cbs.current.onImageSelect?.({ blockId, imageId })
      })
      doc.addEventListener('focusin', (e) => {
        const el = target(e)
        if (!el) return
        saved.set(el, el.innerHTML)
        const blockId = el.closest('[data-block-id]')?.getAttribute('data-block-id')
        if (blockId) cbs.current.onSelect?.(blockId)
      })
      doc.addEventListener('keydown', (e) => {
        const el = target(e)
        if (!el) return
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          el.blur()
        } else if (e.key === 'Escape') {
          el.innerHTML = saved.get(el) ?? el.innerHTML
          el.blur()
        }
      })
      doc.addEventListener('focusout', async (e) => {
        const el = target(e)
        const before = el ? saved.get(el) : undefined
        if (!el || before === undefined || el.innerHTML === before) return
        const blockId = el.closest('[data-block-id]')?.getAttribute('data-block-id')
        const editId = el.getAttribute('data-edit-id')
        const ok = blockId && editId && cbs.current.onEdit ? await cbs.current.onEdit({ blockId, editId, text: readText(el) }) : false
        if (!ok) el.innerHTML = before
      })
    }
    f.addEventListener('load', setup)
    return () => f.removeEventListener('load', setup)
  }, [html])

  // 편집 가능 여부(처리 중·자격 없음이면 끔)를 현재 문서에 반영
  useEffect(() => {
    const f = ref.current!
    const apply = () => {
      const doc = f.contentDocument
      if (!doc) return
      for (const el of doc.querySelectorAll<HTMLElement>('[data-edit-id]')) {
        if (canEdit) el.setAttribute('contenteditable', 'plaintext-only')
        else el.removeAttribute('contenteditable')
      }
      for (const el of doc.querySelectorAll('[data-watermark]')) el.setAttribute('contenteditable', 'false')
    }
    apply()
    f.addEventListener('load', apply)
    return () => f.removeEventListener('load', apply)
  }, [html, canEdit])

  // 선택한 이미지 표시
  const selBlock = selectedImage?.blockId
  const selImage = selectedImage?.imageId
  useEffect(() => {
    const f = ref.current!
    const apply = () => {
      for (const el of f.contentDocument?.querySelectorAll('img[data-img-id]') ?? []) {
        const on = el.getAttribute('data-img-id') === selImage && el.closest('[data-block-id]')?.getAttribute('data-block-id') === selBlock
        el.toggleAttribute('data-selected', on)
      }
    }
    apply()
    f.addEventListener('load', apply)
    return () => f.removeEventListener('load', apply)
  }, [html, selBlock, selImage])

  return (
    <div className={styles.wrap}>
      <iframe ref={ref} className={styles.frame} sandbox="allow-same-origin" srcDoc={BASE_STYLE + html} title="미리보기" />
      <div className={styles.mark} aria-hidden="true" />
    </div>
  )
}
