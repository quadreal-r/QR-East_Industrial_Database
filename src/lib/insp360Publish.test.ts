import { describe, expect, it } from 'vitest'
import {
  buildInsp360PublishObjectKey,
  formatInsp360VersionStamp,
  insp360CloudKeyMatchesGate,
  insp360GateCloudPrefix,
  insp360GateCloudStem,
  insp360GateTourLabel,
  insp360MatchTokens,
  insp360SuggestedGateTourFileName,
  insp360SuggestedGateTourLabel,
  insp360TourDisplayName,
  insp360GateTourMismatchMessage,
  insp360TourNameMatchesGate,
  slugInsp360PathPart,
} from '@/lib/insp360Publish'

describe('insp360Publish', () => {
  it('slugs path parts for R2 keys', () => {
    expect(slugInsp360PathPart('160 Dwight St')).toBe('160-dwight-st')
    expect(slugInsp360PathPart('Electrical Room')).toBe('electrical-room')
  })

  it('uses suite / utility room name (not full project title) for tour labels', () => {
    expect(
      insp360GateTourLabel({
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
        projectName: '60 Birmingham St — Electrical Room.insp360',
      }),
    ).toBe('Electrical Room')

    expect(
      insp360GateTourLabel({
        buildingAddress: '145 Carrier Drive',
        suiteName: 'Suite 7',
        projectName: null,
      }),
    ).toBe('Suite 7')

    expect(
      insp360GateTourLabel({
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: null,
        projectName: '60 Birmingham St (Blg 1) — Electrical Room.insp360',
      }),
    ).toBe('Electrical Room')
  })

  it('builds versioned building/suite-or-room__stamp.insp360 keys by default', () => {
    const now = new Date(Date.UTC(2026, 6, 15, 14, 30, 22))
    expect(
      buildInsp360PublishObjectKey({
        buildingAddress: '160 Dwight St',
        suiteName: 'Electrical Room',
        projectName: '160 Dwight St — Electrical Room.insp360',
        now,
      }),
    ).toBe('160-dwight-st/electrical-room__20260715-143022.insp360')

    expect(
      buildInsp360PublishObjectKey({
        buildingAddress: '145 Carrier Drive',
        suiteName: 'Suite 7',
        projectName: null,
        now,
      }),
    ).toBe('145-carrier-drive/suite-7__20260715-143022.insp360')
  })

  it('can build legacy unversioned keys', () => {
    expect(
      buildInsp360PublishObjectKey({
        buildingAddress: '145 Carrier Drive',
        suiteName: 'Suite 7',
        projectName: null,
        versioned: false,
      }),
    ).toBe('145-carrier-drive/suite-7.insp360')
  })

  it('matches open tour names when the building address matches', () => {
    expect(
      insp360TourNameMatchesGate('60 Birmingham Electrical Room.insp360', {
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBe(true)
    // Same building, different room name — still OK (address match).
    expect(
      insp360TourNameMatchesGate('60 Birmingham Suite 7.insp360', {
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBe(true)
    expect(
      insp360TourNameMatchesGate('145 Carrier Drive — Suite 7', {
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBe(false)
  })

  it('explains when a tour file does not match the building address', () => {
    expect(
      insp360GateTourMismatchMessage({
        tourName: '60 Birmingham Electrical Room (2027 Test).insp360',
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBeNull()
    expect(
      insp360GateTourMismatchMessage({
        tourName: '60 Birmingham Something Else.insp360',
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBeNull()
    const msg = insp360GateTourMismatchMessage({
      tourName: '145 Carrier Suite 7.insp360',
      buildingAddress: '60 Birmingham St (Blg 1)',
      suiteName: 'Electrical Room',
    })
    expect(msg).toContain('145 Carrier Suite 7')
    expect(msg).toContain('60 Birmingham St (Blg 1)')
    expect(msg).toMatch(/does not look like it belongs/i)
  })

  it('suggests a human gate tour label / filename', () => {
    expect(
      insp360SuggestedGateTourLabel({
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBe('60 Birmingham St (Blg 1) — Electrical Room')
    expect(
      insp360SuggestedGateTourFileName({
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBe('60 Birmingham Electrical Room.insp360')
    expect(
      insp360SuggestedGateTourFileName({
        buildingAddress: '145 Carrier Drive',
        suiteName: 'Suite 7',
      }),
    ).toBe('145 Carrier Suite 7.insp360')
  })

  it('formats UTC version stamps', () => {
    expect(formatInsp360VersionStamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe(
      '20260102-030405',
    )
  })

  it('lists with street-number hint; stem is building + suite/room', () => {
    expect(
      insp360GateCloudPrefix({
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
        projectName: '60 Birmingham St — Electrical Room.insp360',
      }),
    ).toBe('60')

    expect(
      insp360GateCloudStem({
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
        projectName: '60 Birmingham St — Electrical Room.insp360',
      }),
    ).toBe('60-birmingham-st-blg-1/electrical-room')
  })

  it('extracts flexible match tokens', () => {
    expect(insp360MatchTokens('60 Birmingham St (Blg 1)')).toEqual(['60', 'birmingham', '1'])
    expect(insp360MatchTokens('Electrical Room')).toEqual(['electrical', 'room'])
    expect(insp360MatchTokens('Suite 7')).toEqual(['suite', '7'])
    // Blg unit number is not required for a match — street # + name + room are enough.
    expect(
      insp360CloudKeyMatchesGate('60 Birmingham Electrical Room.insp360', {
        buildingAddress: '60 Birmingham St (Blg 1)',
        suiteName: 'Electrical Room',
      }),
    ).toBe(true)
  })

  it('matches preferred, legacy folder, and flat root R2 keys for a gate', () => {
    const gate = {
      buildingAddress: '60 Birmingham St (Blg 1)',
      suiteName: 'Electrical Room',
    }
    expect(
      insp360CloudKeyMatchesGate(
        '60-birmingham-st-blg-1/electrical-room__20260715-143022.insp360',
        gate,
      ),
    ).toBe(true)
    expect(
      insp360CloudKeyMatchesGate(
        '60-birmingham-st-blg-1/60-birmingham-st-electrical-room__20260715-143022.insp360',
        gate,
      ),
    ).toBe(true)
    expect(insp360CloudKeyMatchesGate('60 Birmingham Electrical Room.insp360', gate)).toBe(true)
    expect(insp360CloudKeyMatchesGate('60-birmingham-electrical-room.insp360', gate)).toBe(true)
    // Same building address, different room — still matches.
    expect(
      insp360CloudKeyMatchesGate('60-birmingham-st-blg-1/suite-7__20260715-143022.insp360', gate),
    ).toBe(true)
    expect(
      insp360CloudKeyMatchesGate('145-carrier-drive/electrical-room__20260715-143022.insp360', gate),
    ).toBe(false)
    expect(insp360CloudKeyMatchesGate('3105-Test Tour 2026-1.insp360', gate)).toBe(false)
  })

  it('matches same-building tours by address even when suite numbers differ', () => {
    expect(
      insp360CloudKeyMatchesGate('145-carrier-drive/suite-70.insp360', {
        buildingAddress: '145 Carrier Drive',
        suiteName: 'Suite 7',
      }),
    ).toBe(true)
    expect(
      insp360CloudKeyMatchesGate('60-birmingham-electrical-room.insp360', {
        buildingAddress: '145 Carrier Drive',
        suiteName: 'Suite 7',
      }),
    ).toBe(false)
  })

  it('strips version suffixes for display names', () => {
    expect(
      insp360TourDisplayName(
        '60-birmingham-st-blg-1/electrical-room__20260715-143022.insp360',
      ),
    ).toBe('electrical-room')
    expect(insp360TourDisplayName('145-carrier-drive/suite-7.insp360')).toBe('suite-7')
  })
})
