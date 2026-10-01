import styles from './PreviewFrame.module.css'

// 본문 기본 여백을 없애 780px 루트가 iframe 폭 안에 들어가게 한다(가로 스크롤 방지)
const BASE_STYLE = '<style>html{overflow-x:hidden}body{margin:0}</style>'

export function PreviewFrame({ html }: { html: string }) {
  return (
    <div className={styles.wrap}>
      <iframe className={styles.frame} sandbox="" srcDoc={BASE_STYLE + html} title="미리보기" />
      <div className={styles.mark} aria-hidden="true" />
    </div>
  )
}
