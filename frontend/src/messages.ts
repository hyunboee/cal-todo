// 오류 코드별 화면 문구(자리 문구). client를 import하지 않고 code를 구조적으로 읽는다
const REFRESHED = '최신 상태로 갱신했습니다'

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않습니다',
  VALIDATION_FAILED: '입력값을 확인해 주세요',
  EMAIL_NOT_VERIFIED: '이메일 인증 후 사용할 수 있습니다',
  INSUFFICIENT_CREDIT: '크레딧이 부족합니다. 충전 후 이용해 주세요',
  VERSION_CONFLICT: REFRESHED,
  INVALID_STATE: REFRESHED,
  JOB_IN_PROGRESS: REFRESHED,
  REGEN_LIMIT: '재생성 횟수를 모두 사용했습니다',
  AI_IMAGE_LIMIT: 'AI 변환 횟수를 모두 사용했습니다',
  BLOCK_REGEN_LIMIT: '슬라이드 재생성 횟수를 모두 사용했습니다',
  ANALYZE_LIMIT: '분석 횟수를 모두 사용했습니다',
  AI_EDIT_LIMIT: 'AI 수정 횟수를 모두 사용했습니다',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요',
  DAILY_LLM_LIMIT: '오늘 AI 사용 한도를 모두 사용했습니다. 내일 0시(한국 시간)에 초기화됩니다',
  UPSTREAM_FAILED: 'AI 처리에 실패했습니다. 잠시 후 다시 시도해 주세요',
  LLM_BUSY: '요청이 많습니다. 잠시 후 다시 시도해 주세요',
  NOT_FOUND: '찾을 수 없습니다',
  NETWORK_ERROR: '네트워크 연결을 확인해 주세요',
}

const DEFAULT_MESSAGE = '오류가 발생했습니다. 잠시 후 다시 시도해 주세요'

export function messageOf(e: unknown, overrides?: Partial<Record<string, string>>): string {
  const code = typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : ''
  return overrides?.[code] ?? MESSAGES[code] ?? DEFAULT_MESSAGE
}
