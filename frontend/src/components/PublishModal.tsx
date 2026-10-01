import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { usePublish } from '../hooks/editor.ts'
import { messageOf } from '../messages.ts'
import { useUiStore } from '../stores/ui.ts'
import styles from './PublishModal.module.css'

export function PublishModal({ projectId, balance }: { projectId: string; balance: number | undefined }) {
  const ref = useRef<HTMLDialogElement>(null)
  const sent = useRef(false)
  const navigate = useNavigate()
  const setModal = useUiStore((s) => s.setModal)
  const pub = usePublish(projectId)

  useEffect(() => {
    const d = ref.current!
    d.showModal()
    // 닫기 상태는 취소·Esc·성공 경로에서만 바꾼다(StrictMode 재실행 cleanup에서 닫히지 않게)
    return () => d.close()
  }, [])

  const confirm = () => {
    if (sent.current) return
    sent.current = true
    pub.mutate(undefined, {
      onSuccess: () => {
        setModal(null)
        navigate(`/app/projects/${projectId}/final`, { state: { published: true } })
      },
      onError: (e) => {
        sent.current = false
        if (e.status === 409) setModal(null) // 전역 토스트·재조회
      },
    })
  }

  const e = pub.error
  const errorText = !e || e.status === 409
    ? null
    : e.status === 402 || e.status === 403
      ? messageOf(e)
      : `${messageOf(e)} 잔액과 상태는 변경되지 않았습니다`
  const waiting = pub.isPending && pub.failureReason?.status === 503

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="publish-title"
      onCancel={(ev) => {
        if (pub.isPending) ev.preventDefault()
        else setModal(null)
      }}
    >
      <h2 id="publish-title" className={styles.title}>퍼블리시 확정</h2>
      <p className={styles.text}>
        크레딧 1개가 차감됩니다.{balance !== undefined && ` 잔액 ${balance} → ${balance - 1}`}
      </p>
      <p className={styles.text}>
        확정 후에는 편집·재생성이 불가하고 읽기 전용이 됩니다. 최종 HTML은 이후에도 몇 번이든 복사할 수 있습니다.
      </p>
      {waiting && <p className="field-hint">요청이 많습니다. {pub.failureReason?.retryAfter ?? 10}초 뒤 다시 시도합니다</p>}
      {errorText && <p className="field-error" role="alert">{errorText}</p>}
      <div className={styles.actions}>
        <button type="button" className="btn-secondary" disabled={pub.isPending} onClick={() => setModal(null)}>취소</button>
        <button type="button" className="btn-primary btn-sm" disabled={pub.isPending} onClick={confirm}>
          {pub.isPending && <span className="spinner" />}확정
        </button>
      </div>
    </dialog>
  )
}
