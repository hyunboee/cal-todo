import { useEffect } from 'react'
import { useUiStore } from '../stores/ui.ts'
import styles from './Toast.module.css'

const TOAST_MS = 4000

export function Toast() {
  const toast = useUiStore((s) => s.toast)
  const setToast = useUiStore((s) => s.setToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, setToast])
  if (!toast) return null
  return (
    <div className={`${styles.toast} ${styles[toast.tone]}`} role="status">
      {toast.text}
    </div>
  )
}
