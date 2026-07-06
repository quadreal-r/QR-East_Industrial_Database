import { describe, expect, it } from 'vitest'
import { shouldIgnoreVertexDeleteKeydown } from '@/lib/polygonVertexEdit'

describe('shouldIgnoreVertexDeleteKeydown', () => {
  it('ignores delete when focus is in form fields', () => {
    expect(shouldIgnoreVertexDeleteKeydown(document.createElement('input'))).toBe(true)
    expect(shouldIgnoreVertexDeleteKeydown(document.createElement('textarea'))).toBe(true)
    expect(shouldIgnoreVertexDeleteKeydown(document.createElement('select'))).toBe(true)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(shouldIgnoreVertexDeleteKeydown(editable)).toBe(true)
  })

  it('allows delete when focus is not in a form field', () => {
    expect(shouldIgnoreVertexDeleteKeydown(document.body)).toBe(false)
    expect(shouldIgnoreVertexDeleteKeydown(document.createElement('div'))).toBe(false)
  })
})
