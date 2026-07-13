import { afterEach, describe, expect, it } from 'vitest'
import {
  arrayBufferFromMessageData,
  getInsp360GateHook,
  INSP360_GATE_PROJECTS_LS,
  INSP360_LOCAL_PREFIX,
  insp360LinkGateConfirmMessage,
  insp360ProjectDisplayName,
  resolveInsp360TourLabel,
  resolveInsp360ViewerProjectUrl,
  shouldPromptLinkGate,
  writeInsp360GateHook,
} from '@/lib/insp360GateHooks'

describe('insp360GateHooks', () => {
  afterEach(() => {
    localStorage.removeItem(INSP360_GATE_PROJECTS_LS)
  })

  it('writes and reads a hosted gate hook by gate key', () => {
    writeInsp360GateHook('electrical:2', '60 Birmingham Electrical Room.insp360', { hosted: true })
    expect(getInsp360GateHook('electrical:2')).toEqual({
      name: '60 Birmingham Electrical Room.insp360',
      savedAt: expect.any(Number),
      hosted: true,
    })
  })

  it('prefers a hosted local hook label over a remote inspection_url', () => {
    writeInsp360GateHook('electrical:2', 'Local Electrical.insp360', { hosted: true })
    const tour = resolveInsp360TourLabel(
      'electrical:2',
      'https://cdn.example.com/tours/remote.insp360',
    )
    expect(tour).toEqual({ connected: true, label: 'Local Electrical' })
  })

  it('ignores legacy name-only hooks that have no hosted project bytes', () => {
    writeInsp360GateHook('electrical:2', 'Local Electrical.insp360')
    expect(resolveInsp360TourLabel('electrical:2', null)).toEqual({
      connected: false,
      label: 'Not connected yet',
    })
  })

  it('falls back to inspection_url when no hosted local hook exists', () => {
    const tour = resolveInsp360TourLabel(
      'sprinkler:3',
      'insp360/projects/sprinkler-a.insp360',
    )
    expect(tour).toEqual({ connected: true, label: 'sprinkler-a' })
  })

  it('reports not connected when neither hook nor URL exists', () => {
    expect(resolveInsp360TourLabel('suite:9', null)).toEqual({
      connected: false,
      label: 'Not connected yet',
    })
  })

  it('strips local prefix and file extension from display names', () => {
    expect(insp360ProjectDisplayName(`${INSP360_LOCAL_PREFIX}Room A.insp360`)).toBe('Room A')
    expect(insp360ProjectDisplayName('https://cdn.example.com/path/Tour%20B.zip')).toBe('Tour B')
  })

  it('does not pass local-only hooks as fetchable viewer project URLs', () => {
    expect(resolveInsp360ViewerProjectUrl(`${INSP360_LOCAL_PREFIX}Room A.insp360`)).toBeNull()
    expect(resolveInsp360ViewerProjectUrl('insp360/projects/room-a.insp360')).toBe(
      'insp360/projects/room-a.insp360',
    )
    expect(resolveInsp360ViewerProjectUrl(null)).toBeNull()
  })

  it('builds a clear link-on-close confirm message', () => {
    expect(insp360LinkGateConfirmMessage('60 Birmingham Electrical Room.insp360')).toBe(
      'Link “60 Birmingham Electrical Room” to this gateway so it opens automatically next time?',
    )
    expect(insp360LinkGateConfirmMessage(null)).toBe(
      'Link “this tour” to this gateway so it opens automatically next time?',
    )
  })

  it('prompts to link only when a gate has an open unlinked project', () => {
    expect(
      shouldPromptLinkGate({ gateKey: 'electrical:1', projectOpen: true, alreadyLinked: false }),
    ).toBe(true)
    expect(
      shouldPromptLinkGate({ gateKey: 'electrical:1', projectOpen: true, alreadyLinked: true }),
    ).toBe(false)
    expect(
      shouldPromptLinkGate({ gateKey: 'electrical:1', projectOpen: false, alreadyLinked: false }),
    ).toBe(false)
    expect(
      shouldPromptLinkGate({ gateKey: null, projectOpen: true, alreadyLinked: false }),
    ).toBe(false)
  })

  it('copies ArrayBuffer and TypedArray payloads from postMessage data', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fromView = arrayBufferFromMessageData(bytes)
    expect(fromView).toBeInstanceOf(ArrayBuffer)
    expect(fromView?.byteLength).toBe(4)
    expect(arrayBufferFromMessageData(bytes.buffer)).toBeInstanceOf(ArrayBuffer)
    expect(arrayBufferFromMessageData(null)).toBeNull()
    expect(arrayBufferFromMessageData(new ArrayBuffer(0))).toBeNull()
  })
})
