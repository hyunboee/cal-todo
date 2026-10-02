// Vercel(서버리스) 엔트리: Express 앱을 default export한다. 로컬·Docker는 src/server.js(listen + 주기 작업)
// 주기 작업은 vercel.json의 cron이 GET /api/internal/jobs를 부른다(CRON_SECRET 필요)
import { createApp } from './src/app.js'

export default createApp()
