import { Navigate, Outlet } from 'react-router'
import { useMe } from '../hooks/auth.ts'
import { useAuthStore } from '../stores/auth.ts'
import { Banner } from './Banner.tsx'
import { Header } from './Header.tsx'

// I-2: 미인증과 잔액 0이 겹치면 둘 다 표시. I-3: 자리 문구
function EligibilityBanners() {
  const me = useMe().data
  if (!me) return null
  return (
    <>
      {!me.emailVerified && <Banner tone="warn">이메일 인증 후 프로젝트를 만들 수 있습니다.</Banner>}
      {me.balance <= 0 && <Banner tone="warn">크레딧이 부족합니다. 충전 후 이용해 주세요.</Banner>}
    </>
  )
}

export function AppLayout() {
  const token = useAuthStore((s) => s.accessToken)
  if (!token) return <Navigate to="/app/login" replace />
  return (
    <>
      <Header />
      <EligibilityBanners />
      <Outlet />
    </>
  )
}
