import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Navigate, createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { queryClient } from './queryClient.ts'
import { LoginPage } from './pages/LoginPage.tsx'
import { ProjectFormPage } from './pages/ProjectFormPage.tsx'
import { AnalyzePage } from './pages/AnalyzePage.tsx'
import { EditorPage } from './pages/EditorPage.tsx'
import { FinalPage } from './pages/FinalPage.tsx'
import './styles.css'

const router = createBrowserRouter([
  { path: '/app', element: <Navigate to="/app/projects/new" replace /> },
  { path: '/app/login', element: <LoginPage /> },
  { path: '/app/projects/new', element: <ProjectFormPage /> },
  { path: '/app/projects/:id/analyze', element: <AnalyzePage /> },
  { path: '/app/projects/:id/edit', element: <EditorPage /> },
  { path: '/app/projects/:id/final', element: <FinalPage /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
