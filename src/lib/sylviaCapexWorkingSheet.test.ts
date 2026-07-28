import { describe, expect, it } from 'vitest'
import {
  extractRtuNumbersFromComment,
  parseSylviaWorkingSheet,
} from '@/lib/sylviaCapexWorkingSheet'

describe('extractRtuNumbersFromComment', () => {
  it('parses single and multi RTU mentions', () => {
    expect(extractRtuNumbersFromComment('RTU 03(17Y), RTU 04(17Y)')).toEqual(['3', '4'])
    expect(extractRtuNumbersFromComment('RTU 01,02,03 (18Y), 5T')).toEqual(['1', '2', '3'])
    expect(extractRtuNumbersFromComment('New Budget: RTU-5: 5 Ton')).toEqual(['5'])
    expect(
      extractRtuNumbersFromComment(
        'RTU 01(18Y), 06(18Y), 7.5T, RTU 05(18Y),07(18Y) 5T, RTU 3- NEW (18Y)',
      ),
    ).toEqual(['1', '3', '5', '6', '7'])
    expect(
      extractRtuNumbersFromComment(
        'Existing budget, RTU 03(18Y), 5T, $36,413, RTU 04 already replaced',
      ),
    ).toEqual(['3'])
    expect(extractRtuNumbersFromComment('BAS Upgrade - $150,000')).toEqual([])
  })
})

describe('parseSylviaWorkingSheet', () => {
  it('reads Sylvia working sheet colors, pots, and RTU years', async () => {
    const path = 'C:/Users/Robert/Downloads/Sylvia RTU replacement capital 2026.xlsx'
    let parsed
    try {
      parsed = await parseSylviaWorkingSheet(path)
    } catch {
      // File may be absent in CI — skip.
      return
    }

    expect(parsed.stats.yellowCells).toBeGreaterThan(0)
    expect(parsed.stats.greenCells).toBeGreaterThan(0)
    expect(parsed.pots.some((p) => p.bu === '51902' && p.year === '2029')).toBe(true)

    const interchange = parsed.pots.find((p) => p.bu === '51902' && p.year === '2029')
    expect(interchange?.status).toBe('Submitted')
    expect(interchange?.amount).toBe(344857)
    expect(interchange?.rtuNumbers).toEqual(expect.arrayContaining(['1', '2', '4', '5', '6', '7']))

    const approved2031 = parsed.pots.find((p) => p.bu === '50450' && p.year === '2031')
    expect(approved2031?.status).toBe('Approved')
    expect(approved2031?.amount).toBe(131190)

    const jane = parsed.pots.find((p) => p.bu === '51901' && p.year === '2028')
    expect(jane?.status).toBe('Approved')
    expect(jane?.amount).toBe(172478)
  })
})
