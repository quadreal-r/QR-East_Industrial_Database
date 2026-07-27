import { afterEach, describe, expect, it } from 'vitest'
import {
  arrayBufferFromMessageData,
  getInsp360GateHook,
  INSP360_GATE_PROJECTS_LS,
  INSP360_LOCAL_PREFIX,
  insp360ChangeTourConfirmMessage,
  insp360LinkGateConfirmMessage,
  insp360ProjectDisplayName,
  insp360SameProjectFile,
  isOpenTourPermanentCloudLink,
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

  it('prefers a permanent cloud inspection_url over a leftover local hook', () => {
    writeInsp360GateHook('electrical:2', 'Local Electrical.insp360', { hosted: true })
    const tour = resolveInsp360TourLabel(
      'electrical:2',
      'https://cdn.example.com/tours/remote.insp360',
    )
    expect(tour).toEqual({
      connected: true,
      label: 'Cloudflare: remote',
      kind: 'cloud',
    })
  })

  it('ignores legacy name-only hooks that have no hosted project bytes', () => {
    writeInsp360GateHook('electrical:2', 'Local Electrical.insp360')
    expect(resolveInsp360TourLabel('electrical:2', null)).toEqual({
      connected: false,
      label: 'Not connected yet',
      kind: 'none',
    })
  })

  it('falls back to inspection_url when no hosted local hook exists', () => {
    const tour = resolveInsp360TourLabel(
      'sprinkler:3',
      'insp360/projects/sprinkler-a.insp360',
    )
    expect(tour).toEqual({
      connected: true,
      label: 'Cloudflare: sprinkler-a',
      kind: 'cloud',
    })
  })

  it('reports not connected when neither hook nor URL exists', () => {
    expect(resolveInsp360TourLabel('suite:9', null)).toEqual({
      connected: false,
      label: 'Not connected yet',
      kind: 'none',
    })
  })

  it('strips local prefix and file extension from display names', () => {
    expect(insp360ProjectDisplayName(`${INSP360_LOCAL_PREFIX}Room A.insp360`)).toBe('Room A')
    expect(insp360ProjectDisplayName('https://cdn.example.com/path/Tour%20B.zip')).toBe('Tour B')
  })

  it('detects when the open tour is the permanent Cloudflare link', () => {
    const permanent =
      'https://cdn.example.com/60%20Birmingham%20Electrical%20Room.insp360'
    expect(
      isOpenTourPermanentCloudLink({
        permanentUrl: permanent,
        openCloudKey: '60 Birmingham Electrical Room.insp360',
      }),
    ).toBe(true)
    expect(
      isOpenTourPermanentCloudLink({
        permanentUrl: permanent,
        openCloudUrl: permanent,
      }),
    ).toBe(true)
    expect(
      isOpenTourPermanentCloudLink({
        permanentUrl: permanent,
        openProjectName: '60 Birmingham Electrical Room.insp360',
      }),
    ).toBe(true)
    expect(
      isOpenTourPermanentCloudLink({
        permanentUrl: permanent,
        openProjectName: 'Different Local Tour.insp360',
      }),
    ).toBe(false)
    expect(
      isOpenTourPermanentCloudLink({
        permanentUrl: permanent,
        openCloudKey: 'other-building/other-tour.insp360',
      }),
    ).toBe(false)
  })

  it('compares project file identity ignoring path and extension', () => {
    expect(
      insp360SameProjectFile(
        'Test-blur 145 Carrier QR-360°.insp360',
        '145 Carrier QR-360°.insp360',
      ),
    ).toBe(false)
    expect(
      insp360SameProjectFile(
        'C:\\tours\\145 Carrier QR-360°.insp360',
        '145 Carrier QR-360°.insp360',
      ),
    ).toBe(true)
    expect(insp360SameProjectFile(null, 'tour.insp360')).toBe(false)
  })

  it('does not pass local-only hooks as fetchable viewer project URLs', () => {
    expect(resolveInsp360ViewerProjectUrl(`${INSP360_LOCAL_PREFIX}Room A.insp360`)).toBeNull()
    expect(resolveInsp360ViewerProjectUrl('insp360/projects/room-a.insp360')).toBe(
      'insp360/projects/room-a.insp360',
    )
    expect(resolveInsp360ViewerProjectUrl(null)).toBeNull()
  })

  it('builds a clear link-on-close confirm message', () => {
    expect(insp360LinkGateConfirmMessage('145 Carrier Drive — 145 Carrier')).toContain(
      'opens automatically next time',
    )
    expect(insp360LinkGateConfirmMessage('145 Carrier Drive — 145 Carrier')).toContain(
      'does not upload to Cloudflare',
    )
    expect(
      insp360LinkGateConfirmMessage('145 Carrier Drive — 145 Carrier', {
        fileName: 'Test-blur 145 Carrier QR-360°.insp360',
      }),
    ).toContain('Tour file: Test-blur 145 Carrier QR-360°')
    expect(
      insp360LinkGateConfirmMessage('Cloud tour', { cloud: true }),
    ).toContain('Cloudflare tour URL')
    expect(insp360LinkGateConfirmMessage(null)).toContain('Link “this tour”')
  })

  it('builds a clear change-tour confirm message', () => {
    expect(insp360ChangeTourConfirmMessage('60 Birmingham Electrical Room.insp360')).toBe(
      'Unlink “60 Birmingham Electrical Room” from this gateway? You can open a different .insp360 and link it instead.',
    )
    expect(insp360ChangeTourConfirmMessage(null)).toBe(
      'Unlink “the current tour” from this gateway? You can open a different .insp360 and link it instead.',
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
    expect(
      shouldPromptLinkGate({
        gateKey: 'electrical:1',
        projectOpen: true,
        alreadyLinked: false,
        hasOnlineTour: true,
      }),
    ).toBe(false)
    expect(
      shouldPromptLinkGate({
        gateKey: 'electrical:1',
        projectOpen: true,
        alreadyLinked: false,
        gateAlreadyAssigned: true,
      }),
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
