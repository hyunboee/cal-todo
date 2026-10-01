import { FRONTEND_ORIGIN } from '../config.js'

// 허용 출처는 FRONTEND_ORIGIN 하나. 쿠키(rt) 전송을 위해 credentials 허용.
export function cors(req, res, next) {
  res.vary('Origin')
  if (req.get('origin') !== FRONTEND_ORIGIN) return next()
  res.set('Access-Control-Allow-Origin', FRONTEND_ORIGIN)
  res.set('Access-Control-Allow-Credentials', 'true')
  if (req.method !== 'OPTIONS') return next()
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE')
  res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type')
  res.set('Access-Control-Max-Age', '600')
  res.sendStatus(204)
}
