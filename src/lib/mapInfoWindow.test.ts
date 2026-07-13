import { describe, expect, it } from 'vitest'
import {
  buildBuildingInfoHtml,
  buildBuildingInfoPlainText,
  buildDetailEditHtml,
  buildDetailInfoHtml,
  buildDetailInfoPlainText,
  buildRtuDocumentsPageHtml,
} from '@/lib/mapInfoWindow'
import type { Building, Polygon, Rtu } from '@/types/domain'

const tenantPolygons: Polygon[] = [
  {
    name: 'Unit 1',
    description: 'Acme Corp',
    color: '#60a5fa',
    paths: [
      { lat: 43.651, lng: -79.621 },
      { lat: 43.652, lng: -79.621 },
      { lat: 43.652, lng: -79.62 },
    ],
  },
]

const building: Building = {
  park: 'Test Park (x 2)',
  address: '100 Main Street',
  bu: '123',
  lat: 43.65,
  lng: -79.62,
  sqft: '10,000',
  cluster: 'Cluster A',
  manager: 'Alex',
  rtus: [
    {
      name: 'RTU-01',
      description: 'Model: ABC\nMake: TRANE',
      lat: 43.651,
      lng: -79.621,
    },
  ],
}

const rtu: Rtu = {
  name: 'RTU-01',
  description: 'Model: ABC\nMake: TRANE',
  lat: 43.651,
  lng: -79.621,
}

const rtuWithBuilding: Rtu = {
  name: 'RTU-05',
  description:
    'Building: 85 Leek Crescent\nSystem: Roof Top Units\nDescription: RTU 05\nModel: LGH060H4EHIJ\nMake: LENNOX',
  lat: 43.651,
  lng: -79.621,
}

describe('mapInfoWindow', () => {
  it('includes status badges in building popup header', () => {
    const oldRtuBuilding: Building = {
      ...building,
      rtus: [
        {
          name: 'RTU-01',
          description: 'Date Installed: January 1, 2000\nModel: ABC\nMake: TRANE',
          lat: 43.651,
          lng: -79.621,
        },
      ],
    }
    const vacantPolygons: Polygon[] = [
      {
        name: 'Unit 9',
        description: 'Vacant',
        color: '#60a5fa',
        paths: tenantPolygons[0]!.paths,
      },
    ]
    const html = buildBuildingInfoHtml(oldRtuBuilding, vacantPolygons)
    expect(html).not.toContain('yr RTU</span>')
    expect(html).toContain('VACANT</span>')
  })
  it('includes Copy and Move in building popup when allowed', () => {
    const html = buildBuildingInfoHtml(building, tenantPolygons)
    expect(html).toContain('data-iw-action="copy-all"')
    expect(html).toContain('data-iw-action="move"')
    expect(html).toContain('data-iw-kind="building"')
    expect(html).toContain('↔ Move')
    expect(html).toContain('class="iw-copy-source"')
    expect(html).not.toContain('Open in Google Maps')
    expect(html).not.toContain('<strong>GPS</strong>')
  })

  it('hides Move in building popup when showMove is false', () => {
    const html = buildBuildingInfoHtml(building, tenantPolygons, {}, { showMove: false })
    expect(html).toContain('data-iw-action="copy-all"')
    expect(html).not.toContain('data-iw-action="move"')
    expect(html).not.toContain('↔ Move')
  })

  it('always shows building details without collapse toggle', () => {
    const html = buildBuildingInfoHtml(building, tenantPolygons)
    expect(html).toContain('class="iw"')
    expect(html).not.toContain('iw--collapsed')
    expect(html).not.toContain('data-iw-action="toggle-building"')
    expect(html).not.toContain('Hide building details')
    expect(html).toContain('<strong>BU #</strong>')
    expect(html).toContain('<strong>Manager</strong>')
    expect(html).toContain('<strong>Operator</strong>')
  })

  it('builds building plain text matching popup layout', () => {
    const text = buildBuildingInfoPlainText(
      {
        ...building,
        buildingOperator: 'Aaron Meecham',
        operatorPhone: '(437)-346-0642',
      },
      tenantPolygons,
    )
    expect(text).toContain('100 Main Street')
    expect(text).toContain('Test Park')
    expect(text).toContain('BU #        123')
    expect(text).toContain('Operator    Aaron Meecham · (437)-346-0642')
    expect(text).toContain('RTUs (1)')
    expect(text).toContain('RTU-01')
    expect(text).toContain('  ABC · TRANE')
    expect(text).toContain('Tenant Polygons (1)')
    expect(text).toContain('Unit 1  Acme Corp')
  })

  it('includes operator phone in building popup html', () => {
    const html = buildBuildingInfoHtml(
      {
        ...building,
        buildingOperator: 'Aaron Meecham',
        operatorPhone: '(437)-346-0642',
      },
      tenantPolygons,
    )
    expect(html).toContain('Aaron Meecham · (437)-346-0642')
  })

  it('includes Picture, Documents, and Edit in RTU popup footer', () => {
    const html = buildDetailInfoHtml('rtu', rtu, { buildingAddress: building.address })
    expect(html).toContain('class="iw-foot"')
    expect(html).not.toContain('📋 Copy')
    expect(html).toContain('data-iw-action="pictures"')
    expect(html).toContain('data-iw-action="documents"')
    expect(html).toContain('data-iw-action="edit-text"')
    expect(html).not.toContain('data-iw-documents-root')
    expect(html).not.toContain('↔ Move')
    expect(html).not.toContain('🗑 Delete')
    expect(html.indexOf('class="iw-body"')).toBeLessThan(html.indexOf('class="iw-foot"'))
  })

  it('includes Copy in RTU edit popup footer', () => {
    const html = buildDetailEditHtml(rtu, { buildingAddress: building.address })
    expect(html).toContain('data-iw-action="copy-all"')
    expect(html).toContain('class="iw-copy-source"')
    expect(html).toContain('data-iw-action="edit-save"')
  })

  it('builds RTU documents page with back and download actions', () => {
    const html = buildRtuDocumentsPageHtml(rtu, building.address, [
      {
        fileName: '100-RTU-01-manual.pdf',
        url: 'https://docs.example.com/100-RTU-01-manual.pdf',
        label: '100-RTU-01-manual.pdf',
      },
    ])
    expect(html).toContain('data-iw-action="documents-back"')
    expect(html).toContain('data-iw-action="documents-download"')
    expect(html).toContain('data-iw-documents-root')
  })

  it('omits download button when there are no documents', () => {
    const html = buildRtuDocumentsPageHtml(rtu, building.address, [])
    expect(html).not.toContain('data-iw-action="documents-download"')
    expect(html).toContain('No documents on Cloudflare')
  })

  it('includes Enter QR-360° Tour and Move but not Delete in 360° gate popup', () => {
    const entrance = {
      id: 8,
      building_id: 1,
      name: 'Suite # 8',
      description: 'KMX Technologies, Inc.',
      lat: 43.65,
      lng: -79.62,
      inspection_url: null,
    }
    const html = buildDetailInfoHtml('inspection360', entrance, {
      buildingAddress: '6150 Kennedy Road',
    })
    expect(html).toContain('360° GATE')
    expect(html).toContain('Enter QR-360° Tour')
    expect(html).toContain('data-iw-action="inspection360-open"')
    expect(html).toContain('↔ Move')
    expect(html).not.toContain('🗑 Delete')
    expect(html).not.toContain('data-iw-action="delete"')
  })

  it('hides Move on 360° gate popup when showMove is false', () => {
    const entrance = {
      id: 8,
      building_id: 1,
      name: 'Suite # 8',
      description: 'KMX Technologies, Inc.',
      lat: 43.65,
      lng: -79.62,
      inspection_url: null,
    }
    const html = buildDetailInfoHtml('inspection360', entrance, {
      buildingAddress: '6150 Kennedy Road',
      showMove: false,
    })
    expect(html).toContain('data-iw-action="inspection360-open"')
    expect(html).not.toContain('↔ Move')
  })

  it('hides Edit on RTU popup when showEdit is false', () => {
    const html = buildDetailInfoHtml('rtu', rtu, {
      buildingAddress: building.address,
      showEdit: false,
    })
    expect(html).toContain('data-iw-action="pictures"')
    expect(html).not.toContain('data-iw-action="edit-text"')
  })

  it('includes Enter QR-360° Tour and Move for electrical room sphere popup', () => {
    const utility = {
      id: 2,
      utility_type: 'Electrical Rooms' as const,
      name: 'Elec Room A',
      description: 'Basement',
      lat: 43.65,
      lng: -79.62,
      inspection_url: null,
    }
    const html = buildDetailInfoHtml('electrical', utility)
    expect(html).toContain('ELECTRICAL 360°')
    expect(html).toContain('Enter QR-360° Tour')
    expect(html).toContain('data-iw-action="inspection360-open"')
    expect(html).toContain('↔ Move')
    expect(html).toContain('Not connected yet')
  })

  it('shows hooked local project name on electrical gate popup', () => {
    const utility = {
      id: 2,
      utility_type: 'Electrical Rooms' as const,
      name: 'Electrical Room',
      description: '60 Birmingham St',
      lat: 43.65,
      lng: -79.62,
      inspection_url: null,
    }
    const html = buildDetailInfoHtml('electrical', utility, {
      tourConnected: true,
      tourLabel: '60 Birmingham Electrical Room',
    })
    expect(html).toContain('60 Birmingham Electrical Room')
    expect(html).toContain('Enter QR-360° Tour')
    expect(html).not.toContain('Not connected yet')
  })

  it('includes Enter QR-360° Tour for sprinkler room sphere with connected tour', () => {
    const utility = {
      id: 3,
      utility_type: 'Sprinkler Rooms' as const,
      name: 'Sprinkler A',
      description: '',
      lat: 43.65,
      lng: -79.62,
      inspection_url: 'insp360/projects/sprinkler-a.insp360',
    }
    const html = buildDetailInfoHtml('sprinkler', utility)
    expect(html).toContain('SPRINKLER 360°')
    expect(html).toContain('Connected')
    expect(html).toContain('Enter QR-360° Tour')
  })

  it('includes Copy, Move, and Delete in utility detail popup footer', () => {
    const utility = {
      id: 1,
      utility_type: 'Fire Hydrants' as const,
      name: 'Hydrant A',
      description: 'North lot',
      lat: 43.651,
      lng: -79.621,
    }
    const html = buildDetailInfoHtml('hydrant', utility)
    expect(html).toContain('↔ Move')
    expect(html).toContain('🗑 Delete')
  })

  it('builds detail plain text without redundant RTU label or building footer', () => {
    const text = buildDetailInfoPlainText('rtu', rtuWithBuilding, {
      buildingAddress: '85 Leek Crescent',
    })
    expect(text.startsWith('RTU-05\n\n')).toBe(true)
    expect(text).not.toContain('\nRTU\n')
    expect(text).toContain('Building    85 Leek Crescent')
    expect(text).toContain('System      Roof Top Units')
    expect(text.match(/Building {4}85 Leek Crescent/g)?.length).toBe(1)
  })

  it('builds detail plain text for simple RTU rows', () => {
    const text = buildDetailInfoPlainText('rtu', rtu, { buildingAddress: building.address })
    expect(text).toContain('RTU-01')
    expect(text).not.toMatch(/\nRTU\n/)
    expect(text).toContain('Model       ABC')
    expect(text).toContain('Make        TRANE')
    expect(text).not.toContain('Building    100 Main Street')
  })
})
