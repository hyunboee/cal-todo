import { useEffect, useRef } from 'react'
import type { ImageRef } from '../api/editor.ts'
import { useAssets, useImageEdit } from '../hooks/editor.ts'
import { useUploadAsset } from '../hooks/projects.ts'
import { messageOf } from '../messages.ts'
import { ASSET_MAX } from '../projectView.ts'
import { useUiStore } from '../stores/ui.ts'
import styles from './ImagePickerModal.module.css'

type Props = { projectId: string; target: ImageRef; currentAssetId: string }

export function ImagePickerModal({ projectId, target, currentAssetId }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const setModal = useUiStore((s) => s.setModal)
  const assets = useAssets(projectId)
  const edit = useImageEdit(projectId)
  const upload = useUploadAsset()
  const busy = edit.isPending || upload.isPending
  const full = (assets.data?.length ?? 0) >= ASSET_MAX

  useEffect(() => {
    const d = ref.current!
    d.showModal()
    // 닫기 상태는 취소·Esc·성공 경로에서만 바꾼다(StrictMode 재실행 cleanup에서 닫히지 않게)
    return () => d.close()
  }, [])

  const pick = (assetId: string) => {
    if (assetId === currentAssetId) return setModal(null)
    edit.mutate(
      { ...target, assetId },
      {
        onSuccess: () => setModal(null),
        onError: (e) => {
          if (e.status === 409) setModal(null) // 전역 토스트·재조회
        },
      },
    )
  }

  const e = upload.error ?? edit.error
  const errorText = !e || e.status === 409 || e.status === 429
    ? null
    : messageOf(e, { VALIDATION_FAILED: '이미지를 사용할 수 없습니다. 형식(JPEG·PNG·WebP)과 용량, 장수 제한을 확인해 주세요' })

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="images-title"
      onCancel={(ev) => {
        if (busy) ev.preventDefault()
        else setModal(null)
      }}
    >
      <h2 id="images-title" className={styles.title}>이미지 바꾸기</h2>
      {assets.isPending ? (
        <p className="loading"><span className="spinner" />불러오는 중</p>
      ) : assets.isError ? (
        <p className="field-error" role="alert">{messageOf(assets.error)}</p>
      ) : (
        <ul className={styles.grid} aria-label="프로젝트 이미지">
          {assets.data.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                className={styles.item}
                aria-current={a.id === currentAssetId}
                disabled={busy}
                onClick={() => pick(a.id)}
              >
                <img src={a.thumbnail} alt={`이미지 ${i + 1}${a.id === currentAssetId ? ' (현재)' : ''}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {errorText && <p className="field-error" role="alert">{errorText}</p>}
      {full && <p className="field-hint">이미지가 {ASSET_MAX}장이라 새로 업로드할 수 없습니다</p>}
      <div className={styles.actions}>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp"
          onChange={(ev) => {
            const file = ev.target.files?.[0]
            ev.target.value = ''
            if (file) upload.mutate({ id: projectId, file }, { onSuccess: (r) => pick(r.id) })
          }}
        />
        <button type="button" className="btn-secondary" disabled={busy || full} onClick={() => fileRef.current?.click()}>
          {busy && <span className="spinner" />}새 이미지 업로드
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setModal(null)}>닫기</button>
      </div>
    </dialog>
  )
}
