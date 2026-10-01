// NM-11: 오류 응답 { error: { code, message } }의 원천
export class AppError extends Error {
  constructor(status, code, message = code) {
    super(message)
    this.status = status
    this.code = code
  }
}
