import * as cheerio from 'cheerio'
import { CRAWL_TIMEOUT_MS } from '../config.js'

const TEXT_MAX = 20000 // [가정] LLM 입력 상한
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// FR-12, D-15. 테스트는 t.mock.method(crawler, 'crawl', …)로 교체(QA-04).
// BR-22: 반환 텍스트는 LLM 입력으로만 쓴다. 호출자는 DB·로그에 저장하지 않는다.
// [가정] 리뷰는 서버 렌더링된 본문에 있는 만큼만
export const crawler = {
  async crawl(url) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS), // OP-09
      headers: { 'user-agent': UA, 'accept-language': 'ko-KR' },
    })
    if (!res.ok) throw Object.assign(new Error('crawl failed'), { status: res.status })
    const $ = cheerio.load(await res.text())
    $('script, style, noscript').remove()
    const text = [$('title').text(), $('meta[name="description"]').attr('content') ?? '', $('body').text()]
      .join(' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
    return { text }
  },
}
