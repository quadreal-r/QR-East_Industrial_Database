#!/usr/bin/env node
/**
 * Import a QuadReal portfolio Excel export into Supabase.
 *
 * Active sheets (applied): Buildings, RTUs, Tenant Polygons, Utilities
 * Dormant sheets (archived under supabase/data/dormant/, not applied):
 *   RTU Pictures and any other non-active sheets (future expansion)
 *
 * Usage:
 *   npm run import-portfolio-excel -- "C:\path\to\file.xlsx"
 *   npm run import-portfolio-excel -- "C:\path\to\file.xlsx" --dry-run
 *
 * Requires in .env.local:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'
import { importPortfolioExcel } from '../src/lib/excel'
import {
  listDormantSheetNames,
  mergePortfolioExcelImport,
} from '../src/lib/portfolioExcelMerge'
import { countPortfolioChanges, computePortfolioChanges } from '../src/features/edit-mode/diffPortfolio'
import { normalizePortfolioData } from '../src/types/domain'
import type { PortfolioData } from '../src/types/domain'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

loadDotEnvLocal()

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const excelPath = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!excelPath) {
  console.error('Usage: npx tsx scripts/import-portfolio-excel-to-supabase.ts <excel-path> [--dry-run]')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function archiveDormantSheets(buffer: Buffer, sheetNames: string[]): string[] {
  const dormant = listDormantSheetNames(sheetNames)
  if (!dormant.length) return []

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const outDir = join(ROOT, 'supabase', 'data', 'dormant')
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  const written: string[] = []

  for (const name of dormant) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
    const safe = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'sheet'
    const outPath = join(outDir, `${safe}-${stamp}.json`)
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          sourceFile: excelPath,
          sheetName: name,
          archivedAt: new Date().toISOString(),
          status: 'dormant',
          note: 'Not applied to live portfolio tables. Reserved for future app expansion.',
          rowCount: rows.length,
          rows,
        },
        null,
        2,
      ),
    )
    written.push(outPath)
  }

  writeFileSync(
    join(outDir, 'README.md'),
    [
      '# Dormant workbook sheets',
      '',
      'These sheets were present in a portfolio Excel import but are **not** written to live',
      'Supabase portfolio tables yet. They are kept here for a future app expansion.',
      '',
      'Active sheets today: Buildings, RTUs, Tenant Polygons, Utilities.',
      '',
    ].join('\n'),
  )

  return written
}

async function fetchAllRows(table, columns = '*', orderBy = null) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(columns).range(from, from + pageSize - 1)
    if (orderBy) query = query.order(orderBy)
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function fetchBaseline() {
  const [buildings, rtus, utilities, polygons, tenants, mapViews] = await Promise.all([
    fetchAllRows('buildings', '*', 'address'),
    fetchAllRows('rtus'),
    fetchAllRows('utilities', '*', 'name'),
    fetchAllRows('polygons', '*', 'name'),
    fetchAllRows('tenants'),
    fetchAllRows('portfolio_map_views'),
  ])

  const rtusByBuilding = new Map()
  for (const row of rtus) {
    const list = rtusByBuilding.get(row.building_id) ?? []
    list.push(row)
    rtusByBuilding.set(row.building_id, list)
  }

  const portfolioMapViews = {}
  for (const row of mapViews) {
    portfolioMapViews[row.filter_key] = {
      mapLat: row.map_lat,
      mapLng: row.map_lng,
      mapZoom: row.map_zoom,
      mapHeading: row.map_heading,
      mapTilt: row.map_tilt,
      mapImageryMode:
        row.map_imagery_mode === 'google' || row.map_imagery_mode === 'esri'
          ? row.map_imagery_mode
          : null,
    }
  }

  return normalizePortfolioData({
    buildings: buildings.map((row) => ({
      id: row.id,
      park: row.park,
      address: row.address,
      bu: row.bu ?? '',
      lat: row.lat,
      lng: row.lng,
      sqft: row.sqft ?? '',
      cluster: row.cluster ?? '',
      manager: row.manager ?? '',
      notes: row.notes,
      sold: row.sold,
      mapLat: row.map_lat,
      mapLng: row.map_lng,
      mapZoom: row.map_zoom,
      mapHeading: row.map_heading,
      mapTilt: row.map_tilt,
      mapImageryMode:
        row.map_imagery_mode === 'google' || row.map_imagery_mode === 'esri'
          ? row.map_imagery_mode
          : null,
      rtus: (rtusByBuilding.get(row.id) ?? []).map((rtu) => ({
        id: rtu.id,
        building_id: rtu.building_id,
        name: rtu.name,
        description: rtu.description ?? '',
        lat: rtu.lat,
        lng: rtu.lng,
        model: rtu.model,
        serial: rtu.serial,
        make: rtu.make,
        install_date: rtu.install_date,
        install_year: rtu.install_year,
        heating_btu: rtu.heating_btu,
        cooling_tons: rtu.cooling_tons,
        suite: rtu.suite,
      })),
    })),
    utilities: utilities.map((row) => ({
      id: row.id,
      utility_type: row.utility_type,
      name: row.name,
      description: row.description ?? '',
      lat: row.lat,
      lng: row.lng,
    })),
    polygons: polygons.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      color: row.color,
      paths: row.paths,
    })),
    suiteEntrances: tenants.map((row) => ({
      id: row.id,
      building_id: row.building_id,
      polygon_id: row.polygon_id,
      name: row.name,
      description: row.description ?? '',
      lat: row.lat,
      lng: row.lng,
      inspection_url: row.inspection_url,
    })),
    portfolioMapViews,
  })
}

async function applyChanges(baseline: PortfolioData, pending: PortfolioData): Promise<void> {
  const changes = computePortfolioChanges(baseline, pending)
  console.log(`Change count: ${countPortfolioChanges(changes)}`)
  console.log(
    JSON.stringify(
      {
        buildingsToInsert: changes.buildingsToInsert.length,
        buildingsToUpdate: changes.buildingsToUpdate.length,
        buildingIdsToDelete: changes.buildingIdsToDelete.length,
        rtusToUpsert: changes.rtusToUpsert.length,
        rtuIdsToDelete: changes.rtuIdsToDelete.length,
        utilitiesToUpsert: changes.utilitiesToUpsert.length,
        utilityIdsToDelete: changes.utilityIdsToDelete.length,
        polygonsToUpsert: changes.polygonsToUpsert.length,
        polygonIdsToDelete: changes.polygonIdsToDelete.length,
        suiteEntrancesToUpsert: changes.suiteEntrancesToUpsert.length,
        suiteEntranceIdsToDelete: changes.suiteEntranceIdsToDelete.length,
      },
      null,
      2,
    ),
  )

  if (dryRun) {
    console.log('Dry run — no writes performed.')
    return
  }

  for (const id of changes.buildingIdsToDelete) {
    const { error } = await supabase.from('buildings').delete().eq('id', id)
    if (error) throw error
  }

  for (const building of changes.buildingsToInsert) {
    const { data, error } = await supabase
      .from('buildings')
      .insert({
        park: building.park,
        address: building.address,
        bu: building.bu || null,
        lat: building.lat,
        lng: building.lng,
        sqft: building.sqft || null,
        cluster: building.cluster || null,
        manager: building.manager || null,
        notes: building.notes ?? null,
        sold: building.sold ?? false,
      })
      .select('id')
      .single()
    if (error) throw error
    for (const rtu of building.rtus ?? []) {
      const { error: rtuError } = await supabase.from('rtus').insert({
        building_id: data.id,
        name: rtu.name,
        description: rtu.description || null,
        lat: rtu.lat,
        lng: rtu.lng,
      })
      if (rtuError) throw rtuError
    }
  }

  for (const building of changes.buildingsToUpdate) {
    if (building.id == null) continue
    const { error } = await supabase
      .from('buildings')
      .update({
        park: building.park,
        address: building.address,
        bu: building.bu || null,
        lat: building.lat,
        lng: building.lng,
        sqft: building.sqft || null,
        cluster: building.cluster || null,
        manager: building.manager || null,
        notes: building.notes ?? null,
        sold: building.sold ?? false,
      })
      .eq('id', building.id)
    if (error) throw error
  }

  for (const id of changes.rtuIdsToDelete) {
    const { error } = await supabase.from('rtus').delete().eq('id', id)
    if (error) throw error
  }

  for (const rtu of changes.rtusToUpsert) {
    const payload = {
      building_id: rtu.building_id,
      name: rtu.name,
      description: rtu.description || null,
      lat: rtu.lat,
      lng: rtu.lng,
      model: rtu.model ?? null,
      serial: rtu.serial ?? null,
      make: rtu.make ?? null,
      install_date: rtu.install_date ?? null,
      install_year: rtu.install_year ?? null,
      heating_btu: rtu.heating_btu ?? null,
      cooling_tons: rtu.cooling_tons ?? null,
      suite: rtu.suite ?? null,
    }
    if (rtu.id) {
      const { error } = await supabase.from('rtus').update(payload).eq('id', rtu.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('rtus').insert(payload)
      if (error) throw error
    }
  }

  for (const id of changes.utilityIdsToDelete) {
    const { error } = await supabase.from('utilities').delete().eq('id', id)
    if (error) throw error
  }

  for (const utility of changes.utilitiesToUpsert) {
    const payload = {
      utility_type: utility.utility_type,
      name: utility.name,
      description: utility.description || null,
      lat: utility.lat,
      lng: utility.lng,
      inspection_url: utility.inspection_url?.trim() || null,
    }
    if (utility.id) {
      const { error } = await supabase.from('utilities').update(payload).eq('id', utility.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('utilities').insert(payload)
      if (error) throw error
    }
  }

  for (const id of changes.polygonIdsToDelete) {
    const { error } = await supabase.from('polygons').delete().eq('id', id)
    if (error) throw error
  }

  for (const polygon of changes.polygonsToUpsert) {
    const payload = {
      name: polygon.name,
      description: polygon.description || null,
      color: polygon.color,
      paths: polygon.paths,
    }
    if (polygon.id) {
      const { error } = await supabase.from('polygons').update(payload).eq('id', polygon.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('polygons').insert(payload)
      if (error) throw error
    }
  }

  for (const id of changes.suiteEntranceIdsToDelete) {
    const { error } = await supabase.from('tenants').delete().eq('id', id)
    if (error) throw error
  }

  for (const entrance of changes.suiteEntrancesToUpsert) {
    const payload = {
      building_id: entrance.building_id,
      polygon_id: entrance.polygon_id ?? null,
      name: entrance.name,
      description: entrance.description || null,
      lat: entrance.lat,
      lng: entrance.lng,
      inspection_url: entrance.inspection_url ?? null,
    }
    if (entrance.id) {
      const { error } = await supabase.from('tenants').update(payload).eq('id', entrance.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('tenants').insert(payload)
      if (error) throw error
    }
  }
}

async function main() {
  console.log(`Reading ${excelPath}`)
  const buffer = readFileSync(excelPath)
  const sheetNames = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames
  console.log('Sheets:', sheetNames.join(', '))

  const archived = archiveDormantSheets(buffer, sheetNames)
  if (archived.length) {
    console.log('Archived dormant sheets:')
    for (const path of archived) console.log(`  ${path}`)
  } else {
    console.log('No dormant sheets beyond active portfolio sheets.')
  }

  const imported = normalizePortfolioData(importPortfolioExcel(buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )))
  console.log('Excel rows:', {
    buildings: imported.buildings.length,
    rtus: imported.buildings.reduce((n, b) => n + (b.rtus?.length ?? 0), 0),
    polygons: imported.polygons.length,
    utilities: imported.utilities.length,
  })

  console.log('Fetching live portfolio…')
  const baseline = await fetchBaseline()
  console.log('Live rows:', {
    buildings: baseline.buildings.length,
    rtus: baseline.buildings.reduce((n, b) => n + (b.rtus?.length ?? 0), 0),
    polygons: baseline.polygons.length,
    utilities: baseline.utilities.length,
    suiteEntrances: baseline.suiteEntrances.length,
  })

  const pending = mergePortfolioExcelImport(baseline, imported)
  console.log('Merged rows:', {
    buildings: pending.buildings.length,
    rtus: pending.buildings.reduce((n, b) => n + (b.rtus?.length ?? 0), 0),
    polygons: pending.polygons.length,
    utilities: pending.utilities.length,
    suiteEntrances: pending.suiteEntrances.length,
  })

  await applyChanges(baseline, pending)

  if (!dryRun) {
    const after = await fetchBaseline()
    console.log('After import:', {
      buildings: after.buildings.length,
      rtus: after.buildings.reduce((n, b) => n + (b.rtus?.length ?? 0), 0),
      polygons: after.polygons.length,
      utilities: after.utilities.length,
      suiteEntrances: after.suiteEntrances.length,
    })
    console.log('Done.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
