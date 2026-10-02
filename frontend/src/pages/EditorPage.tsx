import { useEffect, useState } from 'react'
import { Navigate, useLocation, useParams } from 'react-router'
import { Banner } from '../components/Banner.tsx'
import { BlockEditor } from '../components/BlockEditor.tsx'
import { ImagePanel } from '../components/ImagePanel.tsx'
import { ImagePickerModal } from '../components/ImagePickerModal.tsx'
import { PreviewFrame } from '../components/PreviewFrame.tsx'
import { PublishModal } from '../components/PublishModal.tsx'
import { useMe } from '../hooks/auth.ts'
import { useAiImage, useBlockRegenerate, useImageStyle, usePublish, useRegenerate, useSaveEdit } from '../hooks/editor.ts'
import { useGenerate, usePreview, useProject } from '../hooks/projects.ts'
import { findImage, jobLabel } from '../editorView.ts'
import { messageOf } from '../messages.ts'
import { REGEN_MAX, editorFlags, formatElapsed } from '../projectView.ts'
import { useUiStore } from '../stores/ui.ts'
import styles from './EditorPage.module.css'

export function EditorPage() {
  const { id } = useParams()
  const location = useLocation()
  const intent = (location.state as { generate?: boolean } | null)?.generate === true
  const project = useProject(id)
  const me = useMe()
  const gen = useGenerate(id ?? '')
  const regen = useRegenerate(id ?? '')
  const save = useSaveEdit(id ?? '')
  const pub = usePublish(id ?? '')
  const ai = useAiImage(id ?? '')
  const blockRegen = useBlockRegenerate(id ?? '')
  const imgStyle = useImageStyle(id ?? '')
  const modal = useUiStore((s) => s.modal)
  const setModal = useUiStore((s) => s.setModal)
  const setToast = useUiStore((s) => s.setToast)
  const selectBlock = useUiStore((s) => s.selectBlock)
  const selectImage = useUiStore((s) => s.selectImage)
  const selectedImage = useUiStore((s) => s.selectedImage)
  const p = project.data
  const busy = gen.isPending || regen.isPending || ai.isPending || blockRegen.isPending || !!p?.activeJobType
  const hasPreview = p?.status === 'GENERATED' || p?.status === 'EDITING'
  const preview = usePreview(id, p?.version, hasPreview && !p?.activeJobType)

  // 경과 시간: 서버의 작업 시작 시각, 없으면 페이지를 연 시점
  const [openedAt] = useState(() => Date.now())
  const [now, setNow] = useState(openedAt)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [busy])

  if (project.isPending && id) return <p className="loading"><span className="spinner" />불러오는 중</p>
  if (!p) return <p className="field-error" role="alert">{messageOf(project.error)}</p>
  if (p.status === 'PUBLISHED') return <Navigate to={`/app/projects/${p.id}/final`} replace />
  if (!hasPreview && !busy && !intent && !gen.isError) return <Navigate to={`/app/projects/${p.id}/analyze`} replace />

  const pending = gen.isPending || regen.isPending || ai.isPending || blockRegen.isPending || imgStyle.isPending || save.isPending || pub.isPending
  const flags = editorFlags(p, me.data, pending)
  const since = gen.submittedAt || regen.submittedAt || (p.activeJobStartedAt ? Date.parse(p.activeJobStartedAt) : openedAt)
  const waiting =
    (gen.isPending && gen.failureReason?.status === 503 ? gen.failureReason : null) ??
    (regen.isPending && regen.failureReason?.status === 503 ? regen.failureReason : null) ??
    (ai.isPending && ai.failureReason?.status === 503 ? ai.failureReason : null) ??
    (blockRegen.isPending && blockRegen.failureReason?.status === 503 ? blockRegen.failureReason : null)
  const showError = (e: { status: number } | null) => !!e && e.status !== 409 && e.status !== 429
  const left = REGEN_MAX - p.regenCount
  const regening = regen.isPending || p.activeJobType === 'REGEN'
  const job = jobLabel(ai.isPending ? 'AI_IMAGE' : blockRegen.isPending ? 'BLOCK_REGEN' : regening ? 'REGEN' : p.activeJobType)
  const picked = preview.data ? findImage(preview.data.blocks, selectedImage) : undefined

  return (
    <div className={styles.page}>
      {busy && (
        <Banner tone="info" spinner>
          {job}입니다… (최대 90초, 경과 {formatElapsed(now - since)})
        </Banner>
      )}
      {waiting && <Banner tone="info">요청이 많습니다. {waiting.retryAfter ?? 10}초 뒤 다시 시도합니다</Banner>}
      <div className={styles.toolbar}>
        <span className={styles.meta}>{p.form.productName || '(제목 없음)'} · {p.status} · v{p.version}</span>
        {hasPreview && (
          <div className={styles.actions}>
            <span className={styles.meta}>재생성 <span className={left <= 0 ? styles.warn : undefined}>{left}/{REGEN_MAX}</span></span>
            <button
              type="button"
              className="btn-secondary"
              disabled={!flags.regenerate}
              title="직접 수정한 내용이 초기화됩니다"
              onClick={() =>
                regen.mutate(undefined, {
                  onSuccess: () => setToast({ tone: 'info', text: '재생성했습니다. 수동 편집 내용은 초기화되었습니다' }),
                })
              }
            >
              {regen.isPending && <span className="spinner" />}전체 재생성
            </button>
            <div className={styles.publishBar}>
              <button type="button" className="btn-primary btn-sm" disabled={!flags.publish} onClick={() => setModal('publish')}>
                퍼블리시 · 1크레딧
              </button>
            </div>
          </div>
        )}
      </div>
      <div className={styles.body}>
        <section className={styles.canvas} aria-label="미리보기">
          {preview.data ? (
            <PreviewFrame
              html={preview.data.html}
              editable={flags.save}
              onSelect={selectBlock}
              onImageSelect={selectImage}
              selectedImage={selectedImage}
              onEdit={async (i) => {
                try {
                  await save.mutateAsync(i)
                  return true
                } catch (e) {
                  const st = (e as { status?: number }).status
                  // 409·429는 전역 토스트가 안내한다
                  if (st !== 409 && st !== 429) setToast({ tone: 'error', text: messageOf(e, { VALIDATION_FAILED: 'HTML 태그는 입력할 수 없습니다 (2,000자 이하)' }) })
                  return false
                }
              }}
            />
          ) : (
            <div className={styles.empty}>
              {busy || (preview.isPending && hasPreview) ? (
                <p className="loading"><span className="spinner" />{busy ? job : '불러오는 중'}</p>
              ) : preview.isError ? (
                <p className="field-error" role="alert">{messageOf(preview.error)}</p>
              ) : null}
            </div>
          )}
        </section>
        <aside className={`card ${styles.panel}`}>
          {hasPreview ? (
            <>
              {preview.data && (
                <ImagePanel
                  projectId={p.id}
                  blocks={preview.data.blocks}
                  aiImageCount={p.aiImageCount}
                  canImage={flags.image}
                  canAi={flags.aiImage}
                  aiPending={ai.isPending}
                  aiError={ai.error}
                  onAi={(i) => ai.mutate(i)}
                  stylePending={imgStyle.isPending}
                  styleError={imgStyle.error}
                  onStyle={(i) => imgStyle.mutate(i)}
                />
              )}
              {preview.data && (
                <BlockEditor
                  blocks={preview.data.blocks}
                  version={preview.data.version}
                  disabled={!flags.save}
                  saving={save.isPending}
                  error={save.error}
                  onSave={(i) => save.mutate(i)}
                  blockRegenCount={p.blockRegenCount}
                  canRegen={flags.blockRegen}
                  regenPending={blockRegen.isPending}
                  regenError={blockRegen.error}
                  onRegen={(blockId) => blockRegen.mutate(blockId)}
                />
              )}
              {showError(regen.error) && <p className="field-error" role="alert">{messageOf(regen.error)}</p>}
            </>
          ) : (
            <>
              <button type="button" className="btn-generate" disabled={!flags.generate} onClick={() => gen.mutate()}>
                {gen.isPending && <span className="spinner" />}✦ 상세페이지 생성
              </button>
              {showError(gen.error) && <p className="field-error" role="alert">{messageOf(gen.error)}</p>}
            </>
          )}
        </aside>
      </div>
      {modal === 'publish' && id && <PublishModal projectId={id} balance={me.data?.balance} />}
      {modal === 'images' && id && selectedImage && picked && (
        <ImagePickerModal projectId={id} target={selectedImage} currentAssetId={picked.assetId} />
      )}
    </div>
  )
}
