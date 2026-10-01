import { logError } from './api/client.ts'
import type { PreviewBlock } from './api/types.ts'

export const EDIT_TEXT_MAX = 2000 // backend config.js EDIT_TEXT_MAX와 동일

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
