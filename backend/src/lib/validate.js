import { AppError } from './errors.js'

// FR-34: 기준 version은 1 이상 정수
export function readVersion(body) {
  const v = body?.version
  if (!Number.isInteger(v) || v < 1) throw new AppError(400, 'VALIDATION_FAILED')
  return v
}
