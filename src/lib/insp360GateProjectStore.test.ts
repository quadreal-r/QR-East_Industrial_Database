import { describe, expect, it } from 'vitest'
import {
  binaryToArrayBuffer,
  confirmGateProjectStored,
  loadHostGateProject,
  prepareViewerGateProject,
  saveHostGateProject,
  writeViewerGateProject,
} from '@/lib/insp360GateProjectStore'

describe('insp360GateProjectStore', () => {
  it('rejects empty keys or empty payloads without writing', async () => {
    const bytes = new TextEncoder().encode('fake-insp360-bytes').buffer
    expect(await saveHostGateProject('', 'Room.insp360', bytes)).toBe(false)
    expect(await saveHostGateProject('electrical:test', 'Room.insp360', new ArrayBuffer(0))).toBe(
      false,
    )
    expect(await loadHostGateProject('')).toBeNull()
  })

  it('normalizes ArrayBuffer and TypedArray binaries', async () => {
    const bytes = new Uint8Array([9, 8, 7])
    const fromView = await binaryToArrayBuffer(bytes)
    expect(fromView?.byteLength).toBe(3)
    expect((await binaryToArrayBuffer(bytes.buffer))?.byteLength).toBe(3)
    expect(await binaryToArrayBuffer(null)).toBeNull()
  })

  it('confirmGateProjectStored returns false when nothing was saved', async () => {
    expect(await confirmGateProjectStored('suite:missing', { maxWaitMs: 200 })).toBe(false)
  })

  it('rejects empty payloads when seeding viewer storage for preload', async () => {
    const bytes = new TextEncoder().encode('fake-insp360-preload-bytes').buffer
    expect(await writeViewerGateProject('', 'Room.insp360', bytes)).toBe(false)
    expect(await writeViewerGateProject('electrical:test', 'Room.insp360', new ArrayBuffer(0))).toBe(
      false,
    )
    expect(await prepareViewerGateProject('')).toBeNull()
    expect(await prepareViewerGateProject(`suite:missing-preload-${Date.now()}`)).toBeNull()
  })
})
