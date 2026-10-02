import { logError } from './api/client.ts'
import type { JobType, PreviewBlock, PreviewImage } from './api/types.ts'
import type { ImageRef } from './api/editor.ts'

export const EDIT_TEXT_MAX = 2000 // backend config.js EDIT_TEXT_MAX와 동일
export const AI_PROMPT_MAX = 500 // backend config.js AI_IMAGE_PROMPT_MAX와 동일
export const WIDTH_STEPS = { min: 10, max: 100, step: 5 }

export function validatePrompt(s: string): string | null {
  const t = s.trim()
  if (t === '') return '변환 요청을 입력하세요'
  if (t.length > AI_PROMPT_MAX) return `변환 요청은 ${AI_PROMPT_MAX}자 이하여야 합니다`
  if (/<\/?[a-z!][^>]*>/i.test(t)) return 'HTML 태그는 입력할 수 없습니다'
  return null
}

export function jobLabel(t: JobType | null): string {
  return t === 'AI_IMAGE' ? 'AI 이미지 변환 중' : t === 'BLOCK_REGEN' ? '슬라이드 재생성 중' : t === 'REGEN' ? '재생성 중' : '생성 중'
}

export function findImage(blocks: PreviewBlock[], ref: ImageRef | null): PreviewImage | undefined {
  return blocks.find((b) => b.blockId === ref?.blockId)?.images.find((i) => i.imageId === ref?.imageId)
}

export function pickBlock(blocks: PreviewBlock[], selectedId: string | null): PreviewBlock | undefined {
  return blocks.find((b) => b.blockId === selectedId) ?? blocks[0]
}

export function blockLabel(b: PreviewBlock, index: number): string {
  const t = (b.fields[0]?.text ?? '').replace(/\s+/g, ' ').trim()
  const summary = t === '' ? b.blockId : t.length > 20 ? t.slice(0, 19) + '…' : t
  return `B${index + 1} ${summary}`
}

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
  if (!clipboard) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch (e) {
    logError('[copy]', e)
    return false
  }
}
