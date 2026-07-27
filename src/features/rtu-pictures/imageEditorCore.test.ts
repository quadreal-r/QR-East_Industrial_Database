import { describe, expect, it } from 'vitest'
import {
  downloadFileNameForFormat,
  guessImageMime,
} from './imageEditorCore'

describe('guessImageMime', () => {
  it('maps common extensions', () => {
    expect(guessImageMime('150-RTU-11 (1) (Audit-2025).jpg')).toBe('image/jpeg')
    expect(guessImageMime('photo.PNG')).toBe('image/png')
    expect(guessImageMime('x.webp')).toBe('image/webp')
    expect(guessImageMime(null)).toBe('image/jpeg')
  })
})

describe('downloadFileNameForFormat', () => {
  it('swaps the extension for the chosen download format', () => {
    expect(downloadFileNameForFormat('150-RTU-11 (1) (Audit-2025).jpg', 'png')).toBe(
      '150-RTU-11 (1) (Audit-2025).png',
    )
    expect(downloadFileNameForFormat('150-RTU-11 (1) (Audit-2025).jpg', 'jpg')).toBe(
      '150-RTU-11 (1) (Audit-2025).jpg',
    )
    expect(downloadFileNameForFormat('150-RTU-11 (1) (Audit-2025).jpg', 'pdf')).toBe(
      '150-RTU-11 (1) (Audit-2025).pdf',
    )
  })
})
