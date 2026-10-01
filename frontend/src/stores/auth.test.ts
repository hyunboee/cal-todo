import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useAuthStore } from './auth.ts'

describe('useAuthStore', () => {
  beforeEach(() => useAuthStore.getState().clear())

  it('초기 accessToken은 null', () => {
    assert.equal(useAuthStore.getState().accessToken, null)
  })

  it('setAccessToken → 값 저장', () => {
    useAuthStore.getState().setAccessToken('tok-1')
    assert.equal(useAuthStore.getState().accessToken, 'tok-1')
  })

  it('clear → null 복귀', () => {
    useAuthStore.getState().setAccessToken('tok-1')
    useAuthStore.getState().clear()
    assert.equal(useAuthStore.getState().accessToken, null)
  })
})
