import type { ReactNode } from 'react'
import styles from './Banner.module.css'

export function Banner({ tone, spinner, children }: { tone: 'info' | 'warn' | 'error'; spinner?: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role="status">
      {spinner && <span className="spinner" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  )
}
