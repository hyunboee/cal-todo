import { useEffect, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useLogin, useSignup } from '../hooks/auth.ts'
import { messageOf } from '../messages.ts'
import { useAuthStore } from '../stores/auth.ts'
import styles from './LoginPage.module.css'

const inPopup = window.self !== window.top

export function LoginPage() {
  const token = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()
  const signup = useSignup()
  const m = mode === 'login' ? login : signup

  // 랜딩의 로그인 팝업(iframe) 안이면 창 전체를 /app으로 옮긴다. 토큰은 /app 시작 시 refresh로 복원
  useEffect(() => {
    if (token && inPopup) window.top!.location.assign('/app')
  }, [token])

  if (token) return inPopup ? null : <Navigate to="/app" replace />

  const submit = (ev: SyntheticEvent) => {
    ev.preventDefault()
    m.mutate({ email, password }, { onSuccess: () => { if (!inPopup) void navigate('/app', { replace: true }) } })
  }
  const errorText = m.error
    ? messageOf(m.error, {
        VALIDATION_FAILED: '이메일 형식, 비밀번호 8자 이상, 이미 가입된 이메일인지 확인하세요',
      })
    : null

  return (
    <main className={inPopup ? `${styles.wrap} ${styles.popup}` : styles.wrap}>
      <form className={`card ${styles.card}`} onSubmit={submit}>
        <div className={styles.tabs}>
          <button type="button" className="btn-secondary" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>
            로그인
          </button>
          <button type="button" className="btn-secondary" aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>
            가입
          </button>
        </div>
        <label className={styles.field}>
          <span className="field-label">이메일</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className="field-label">비밀번호</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {errorText && (
          <p className="field-error" role="alert">
            {errorText}
          </p>
        )}
        <button type="submit" className={`btn-primary ${styles.submit}`} disabled={m.isPending}>
          {m.isPending && <span className="spinner" aria-hidden="true" />}
          {mode === 'login' ? '로그인' : '가입하기'}
        </button>
      </form>
    </main>
  )
}
