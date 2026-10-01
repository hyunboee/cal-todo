import { useState } from 'react'
import type { EditInput } from '../api/editor.ts'
import type { PreviewBlock } from '../api/types.ts'
import { EDIT_TEXT_MAX, blockLabel, pickBlock } from '../editorView.ts'
import { messageOf } from '../messages.ts'
import { useUiStore } from '../stores/ui.ts'
import styles from './BlockEditor.module.css'

type Props = {
  blocks: PreviewBlock[]
  version: number
  disabled: boolean
  saving: boolean
  error: unknown
  onSave: (i: EditInput) => void
}

function FieldRow(props: {
  blockId: string; editId: string; initial: string
  disabled: boolean; saving: boolean; errorText: string | null; onSave: (i: EditInput) => void
}) {
  const { blockId, editId, initial, disabled, saving, errorText, onSave } = props
  const [text, setText] = useState(initial)
  const inputId = `edit-${blockId}-${editId}`
  return (
    <div className={styles.field}>
      <label className="field-label" htmlFor={inputId}>{editId}</label>
      <textarea
        id={inputId}
        className={`textarea${errorText ? ' input-error' : ''}`}
        maxLength={EDIT_TEXT_MAX}
        value={text}
        disabled={disabled}
        aria-invalid={errorText ? true : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      {errorText && <p className="field-error" role="alert">{errorText}</p>}
      <div className={styles.fieldFoot}>
        <span className="field-hint">{text.length}/{EDIT_TEXT_MAX}</span>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || saving || text === initial}
          onClick={() => onSave({ blockId, editId, text })}
        >
          {saving && <span className="spinner" />}저장
        </button>
      </div>
    </div>
  )
}

export function BlockEditor({ blocks, version, disabled, saving, error, onSave }: Props) {
  const selectedId = useUiStore((s) => s.selectedBlockId)
  const selectBlock = useUiStore((s) => s.selectBlock)
  const [lastEditId, setLastEditId] = useState<string | null>(null)
  const current = pickBlock(blocks, selectedId)
  const status = (error as { status?: number } | null | undefined)?.status
  const showError = !!error && status !== 409 && status !== 429
  const errorText = showError
    ? messageOf(error, { VALIDATION_FAILED: 'HTML 태그는 입력할 수 없습니다 (2,000자 이하)' })
    : null

  return (
    <div className={styles.editor}>
      <ul className={styles.list} aria-label="블록 목록">
        {blocks.map((b, i) => (
          <li key={b.blockId}>
            <button
              type="button"
              className={styles.item}
              aria-pressed={b.blockId === current?.blockId}
              onClick={() => selectBlock(b.blockId)}
            >
              <span className={styles.chip}>B{i + 1}</span>
              <span className={styles.label}>{blockLabel(b, i).replace(/^B\d+ /, '')}</span>
            </button>
          </li>
        ))}
      </ul>
      {current && (
        current.fields.length === 0 ? (
          <p className="field-hint">편집할 텍스트가 없습니다</p>
        ) : (
          current.fields.map((f) => (
            <FieldRow
              key={`${version}:${current.blockId}:${f.editId}`}
              blockId={current.blockId}
              editId={f.editId}
              initial={f.text}
              disabled={disabled}
              saving={saving && lastEditId === f.editId}
              errorText={lastEditId === f.editId ? errorText : null}
              onSave={(i) => {
                setLastEditId(i.editId)
                onSave(i)
              }}
            />
          ))
        )
      )}
      <p className="field-hint">재생성하면 수동 편집 내용이 초기화됩니다</p>
    </div>
  )
}
