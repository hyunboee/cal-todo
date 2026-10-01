import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 서버: /app, /app/* (확장자 없는 경로)는 SPA 입력으로 보낸다
const appFallback = (): Plugin => ({
  name: 'app-fallback',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '').split('?')[0]
      if ((path === '/app' || path.startsWith('/app/')) && !path.includes('.')) {
        req.url = '/app/index.html'
      }
      next()
    })
  },
})

export default defineConfig({
  plugins: [react(), appFallback()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
})
