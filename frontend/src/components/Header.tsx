import { Link } from 'react-router'
import { useLogout, useMe } from '../hooks/auth.ts'
import styles from './Header.module.css'

export function Header() {
  const me = useMe().data
  const logout = useLogout()
  const low = !!me && me.balance <= 0
  const status = me && (
    <span className={me.emailVerified ? styles.verified : styles.unverified}>
      {me.emailVerified ? '인증됨' : '미인증'}
    </span>
  )
  const logoutBtn = (
    <button type="button" className="btn-link" disabled={logout.isPending} onClick={() => logout.mutate()}>
      로그아웃
    </button>
  )
  return (
    <header className={styles.header}>
      <Link to="/app" className={styles.logo}>
        <span className={styles.mark}>C</span>Detail Maker
      </Link>
      <span className={styles.spacer} />
      {me && (
        <span className={`${styles.balance} ${low ? styles.low : ''}`}>
          잔액 <b>{me.balance}</b>
          {low && ' · 충전 필요'}
        </span>
      )}
      <div className={`${styles.items} ${styles.desktopOnly}`}>
        <span className={styles.sep} />
        {status}
        <span className={styles.sep} />
        {logoutBtn}
      </div>
      <details className={styles.menu}>
        <summary>메뉴</summary>
        <div className={styles.menuBody}>
          {status}
          {logoutBtn}
        </div>
      </details>
    </header>
  )
}
