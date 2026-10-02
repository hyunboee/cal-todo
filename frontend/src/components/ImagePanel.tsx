import { useEffect, useRef, useState } from 'react'
import type { ImageAlign, ImageRef, ImageStyleInput } from '../api/editor.ts'
import type { PreviewBlock } from '../api/types.ts'
import { useAssets } from '../hooks/editor.ts'
import { AI_PROMPT_MAX, WIDTH_STEPS, findImage, pickBlock, validatePrompt } from '../editorView.ts'
import { messageOf } from '../messages.ts'
import { AI_IMAGE_MAX, ASSET_MAX } from '../projectView.ts'
import { useUiStore } from '../stores/ui.ts'
import styles from './ImagePanel.module.css'

type Props = {
  projectId: string
  blocks: PreviewBlock[]
  aiImageCount: number
  canImage: boolean
  canAi: boolean
  aiPending: boolean
  aiError: unknown
  onAi: (i: ImageRef & { prompt: string }) => void
  stylePending: boolean
  styleError: unknown
  onStyle: (i: ImageStyleInput) => void
}

const ALIGNS: { value: ImageAlign; label: string }[] = [
  { value: 'left', label: '왼쪽' },
  { value: 'center', label: '가운데' },
  { value: 'right', label: '오른쪽' },
]

// 슬라이더는 값이 멈추고 0.5초 뒤 마지막 값만 저장한다(연속 조작 시 요청이 겹쳐 409가 나지 않게).
// 저장된 값이 바뀌면 key로 다시 만든다
function SizeControl(props: { widthPct: number; align: ImageAlign; disabled: boolean; onChange: (widthPct: number, align: ImageAlign) => void }) {
  const { widthPct, align, disabled, onChange } = props
  const [value, setValue] = useState(widthPct)
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(() => {
    if (value === widthPct) return
    const t = setTimeout(() => latest.current(value, align), 500)
    return () => clearTimeout(t)
  }, [value, widthPct, align])
  return (
    <div className={styles.size}>
      <label className="field-label" htmlFor="img-width">크기 <span>{value}%</span></label>
      <input
        id="img-width"
        type="range"
        className={styles.range}
        min={WIDTH_STEPS.min}
        max={WIDTH_STEPS.max}
        step={WIDTH_STEPS.step}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <div className={styles.aligns} role="group" aria-label="정렬">
        {ALIGNS.map((a) => (
          <button
            key={a.value}
            type="button"
            className="btn-secondary"
            aria-pressed={a.value === align}
            disabled={disabled}
            onClick={() => a.value !== align && onChange(value, a.value)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ImagePanel({ projectId, blocks, aiImageCount, canImage, canAi, aiPending, aiError, onAi, stylePending, styleError, onStyle }: Props) {
  const selectedBlockId = useUiStore((s) => s.selectedBlockId)
  const selectedImage = useUiStore((s) => s.selectedImage)
  const selectImage = useUiStore((s) => s.selectImage)
  const setModal = useUiStore((s) => s.setModal)
  const assets = useAssets(projectId)
  const [prompt, setPrompt] = useState('')
  const block = pickBlock(blocks, selectedBlockId)
  if (!block) return null
  const ref = selectedImage && selectedImage.blockId === block.blockId && findImage(blocks, selectedImage) ? selectedImage : null
  const asset = ref ? assets.data?.find((a) => a.id === findImage(blocks, ref)?.assetId) : undefined
  const left = AI_IMAGE_MAX - aiImageCount
  const full = (assets.data?.length ?? 0) >= ASSET_MAX
  const err = prompt ? validatePrompt(prompt) : null
  const status = (aiError as { status?: number } | null | undefined)?.status
  // 409·429는 전역 토스트가 안내한다
  const errorText = aiError && status !== 409 && status !== 429
    ? messageOf(aiError, { VALIDATION_FAILED: '변환할 수 없는 요청입니다. 요청 내용과 이미지 장수를 확인해 주세요' })
    : null
  const styleStatus = (styleError as { status?: number } | null | undefined)?.status
  const styleErrorText = styleError && styleStatus !== 409 && styleStatus !== 429 ? messageOf(styleError) : null
  const picked = ref ? findImage(blocks, ref) : undefined

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>이미지</h3>
      {block.images.length === 0 ? (
        <p className="field-hint">이 블록에는 선택할 이미지가 없습니다</p>
      ) : (
        <>
          <ul className={styles.chips} aria-label="블록 이미지">
            {block.images.map((im, i) => (
              <li key={im.imageId}>
                <button
                  type="button"
                  className={styles.chip}
                  aria-pressed={im.imageId === ref?.imageId}
                  onClick={() => selectImage({ blockId: block.blockId, imageId: im.imageId })}
                >
                  이미지 {i + 1}
                </button>
              </li>
            ))}
          </ul>
          {ref ? (
            <>
              {asset ? <img className={styles.thumb} src={asset.thumbnail} alt="선택한 이미지" /> : <div className={styles.thumbEmpty}><span className="spinner" /></div>}
              <button type="button" className="btn-secondary" disabled={!canImage || aiPending} onClick={() => setModal('images')}>이미지 바꾸기</button>
              {ref && picked && (
                <SizeControl
                  key={`${ref.imageId}:${picked.widthPct}:${picked.align}`}
                  widthPct={picked.widthPct}
                  align={picked.align}
                  disabled={!canImage || aiPending || stylePending}
                  onChange={(widthPct, align) => onStyle({ ...ref, widthPct, align })}
                />
              )}
              {styleErrorText && <p className="field-error" role="alert">{styleErrorText}</p>}
              <label className="field-label" htmlFor="ai-prompt">AI 변환 요청</label>
              <textarea
                id="ai-prompt"
                className={`textarea${err ? ' input-error' : ''}`}
                maxLength={AI_PROMPT_MAX}
                value={prompt}
                disabled={!canAi || aiPending}
                aria-invalid={err ? true : undefined}
                onChange={(e) => setPrompt(e.target.value)}
              />
              {err && <p className="field-error" role="alert">{err}</p>}
              {errorText && <p className="field-error" role="alert">{errorText}</p>}
              {full && <p className="field-hint">이미지가 {ASSET_MAX}장이라 AI 변환 결과를 추가할 수 없습니다</p>}
              <div className={styles.foot}>
                <span className="field-hint">{prompt.length}/{AI_PROMPT_MAX} · AI 변환 <span className={left <= 0 ? styles.warn : undefined}>{left}/{AI_IMAGE_MAX}</span></span>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!canAi || aiPending || full || validatePrompt(prompt) !== null}
                  onClick={() => onAi({ ...ref, prompt: prompt.trim() })}
                >
                  {aiPending && <span className="spinner" />}AI 변환
                </button>
              </div>
            </>
          ) : (
            <p className="field-hint">미리보기에서 이미지를 선택하세요</p>
          )}
        </>
      )}
    </div>
  )
}
