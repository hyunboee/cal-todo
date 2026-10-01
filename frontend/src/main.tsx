import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { refreshAccessToken, setOnAuthLost } from './api/client.ts'
import { AppLayout } from './components/AppLayout.tsx'
import { Toast } from './components/Toast.tsx'
import { queryClient } from './queryClient.ts'
import { LoginPage } from './pages/LoginPage.tsx'
import { ProjectsPage } from './pages/ProjectsPage.tsx'
import { ProjectFormPage } from './pages/ProjectFormPage.tsx'
import { AnalyzePage } from './pages/AnalyzePage.tsx'
import { EditorPage } from './pages/EditorPage.tsx'
import { FinalPage } from './pages/FinalPage.tsx'
import './styles.css'

const router = createBrowserRouter([
  { path: '/app/login', element: <LoginPage /> },
  {
    path: '/app',
    element: <AppLayout />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'projects/new', element: <ProjectFormPage /> },
      { path: 'projects/:id/form', element: <ProjectFormPage /> }, // [가정] N-2
      { path: 'projects/:id/analyze', element: <AnalyzePage /> },
      { path: 'projects/:id/edit', element: <EditorPage /> },
      { path: 'projects/:id/final', element: <FinalPage /> },
    ],
  },
])
setOnAuthLost(() => void router.navigate('/app/login', { replace: true }))

const root = createRoot(document.getElementById('root')!)
root.render(
  <p className="loading">
    <span className="spinner" />
    로그인 확인 중
  </p>,
)
// StrictMode의 effect 2회 실행이 refresh 재사용 탐지를 일으키지 않도록 렌더 전에 1회만 갱신한다
void refreshAccessToken().then(() =>
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toast />
      </QueryClientProvider>
    </StrictMode>,
  ),
)
