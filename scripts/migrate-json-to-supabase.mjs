#!/usr/bin/env node
/**
 * One-time migration: load legacy JSON snapshots into Supabase Postgres.
 *
 * Usage:
 *   npm run migrate-json-to-supabase
 *
 * Requires in .env.local (or environment):
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnvLocal } from './lib/load-dotenv-local.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

loadDotEnvLocal()

const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function readJson(relativePath) {
  const path = join(ROOT, relativePath)
  if (!existsSync(path)) {
    console.warn(`Missing ${relativePath} — skipping`)
    return null
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function scheduleKey(address, rtu) {
  return `${address}::${rtu}`
}

async function migratePortfolio() {
  const buildings = readJson('supabase/data/buildings.json')
  const utilities = readJson('supabase/data/utilities.json')
  const polygons = readJson('supabase/data/polygons.json')
  const schedule = readJson('supabase/data/rtu-schedule.json')
  if (!buildings?.length) throw new Error('No buildings.json data found')

  const scheduleYears = schedule?.replacementYears ?? {}
  const scheduleNotes = schedule?.notes ?? {}

  console.log('Clearing existing portfolio tables…')
  await supabase.from('rtu_pictures').delete().neq('id', 0)
  await supabase.from('rtu_documents').delete().neq('id', 0)
  await supabase.from('rtus').delete().neq('id', 0)
  await supabase.from('tenants').delete().neq('id', 0)
  await supabase.from('buildings').delete().neq('id', 0)
  await supabase.from('utilities').delete().neq('id', 0)
  await supabase.from('polygons').delete().neq('id', 0)

  const buildingIdByAddress = new Map()
  let rtuCount = 0

  for (const b of buildings) {
    const { data, error } = await supabase
      .from('buildings')
      .insert({
        park: b.park,
        address: b.address,
        bu: b.bu ?? null,
        lat: b.lat,
        lng: b.lng,
        sqft: b.sqft ?? null,
        cluster: b.cluster ?? null,
        manager: b.manager ?? null,
        notes: b.notes ?? null,
        sold: Boolean(b.sold),
      })
      .select('id, address')
      .single()
    if (error) throw error
    buildingIdByAddress.set(data.address, data.id)

    for (const rtu of b.rtus ?? []) {
      const key = scheduleKey(b.address, rtu.name)
      const yearRaw = scheduleYears[key]
      const noteRaw = scheduleNotes[key]
      const { error: rtuError } = await supabase.from('rtus').insert({
        building_id: data.id,
        name: rtu.name,
        description: rtu.desc ?? rtu.description ?? null,
        lat: rtu.lat,
        lng: rtu.lng,
        replacement_year: yearRaw ? Number.parseInt(String(yearRaw), 10) : null,
        replacement_note: noteRaw?.trim() || null,
      })
      if (rtuError) throw rtuError
      rtuCount++
    }
  }

  if (utilities?.length) {
    const { error } = await supabase.from('utilities').insert(
      utilities.map((u) => ({
        utility_type: u.type ?? u.utility_type,
        name: u.name,
        description: u.desc ?? u.description ?? null,
        lat: u.lat,
        lng: u.lng,
      })),
    )
    if (error) throw error
  }

  if (polygons?.length) {
    const { error } = await supabase.from('polygons').insert(
      polygons.map((p) => ({
        name: p.name,
        description: p.desc ?? p.description ?? null,
        color: p.color ?? '#60a5fa',
        paths: p.paths,
      })),
    )
    if (error) throw error
  }

  console.log(`Portfolio: ${buildings.length} buildings, ${rtuCount} RTUs`)
  return { buildingIdByAddress, rtuCount }
}

async function migratePricing() {
  const pricing = readJson('supabase/data/rtu-pricing-rows.json')
  if (!pricing?.rows?.length) return
  await supabase.from('rtu_pricing').delete().neq('id', 0)
  const rows = pricing.rows.map((row, index) => ({
    tonnage_key: row.tonnageKey,
    label: row.label,
    notes: row.notes ?? '',
    model: row.model ?? '',
    supply_std: row.supplyStd,
    supply_hyb: row.supplyHyb,
    install: row.install,
    consulting: row.consulting,
    structural: row.structural,
    service_balancing: row.serviceBalancing,
    electrical: row.electrical,
    miscellaneous: row.miscellaneous,
    supervisory_mult: row.supervisoryMult,
    position: index,
  }))
  const { error } = await supabase.from('rtu_pricing').insert(rows)
  if (error) throw error
  await supabase.from('app_settings').upsert(
    { key: 'rtu_pricing_version', value: { version: pricing.version ?? null } },
    { onConflict: 'key' },
  )
  if (pricing.sourceFile) {
    await supabase.from('app_settings').upsert(
      { key: 'rtu_pricing_source', value: { sourceFile: pricing.sourceFile } },
      { onConflict: 'key' },
    )
  }
  console.log(`Pricing: ${rows.length} rows`)
}

async function migratePictures(buildingIdByAddress) {
  const manifest = readJson('public/database/rtu-pictures/manifest.json')
  const hiddenPath = join(ROOT, 'public/database/rtu-pictures/hidden.json')
  const hidden = existsSync(hiddenPath)
    ? new Set(JSON.parse(readFileSync(hiddenPath, 'utf8')))
    : new Set()

  if (!manifest?.entries) return

  const { data: rtus } = await supabase.from('rtus').select('id, name, building_id')
  const { data: buildings } = await supabase.from('buildings').select('id, address')
  const addressByBuildingId = new Map((buildings ?? []).map((b) => [b.id, b.address]))
  const rtuIdByKey = new Map()
  for (const rtu of rtus ?? []) {
    const address = addressByBuildingId.get(rtu.building_id)
    if (address) rtuIdByKey.set(`${address}|${rtu.name}`, rtu.id)
  }

  const pictureRows = []
  for (const [key, files] of Object.entries(manifest.entries)) {
    const [buildingAddress, rtuName] = key.split('|')
    if (!buildingAddress || !rtuName) continue
    const rtuId = rtuIdByKey.get(key) ?? null
    for (const [position, fileName] of files.entries()) {
      pictureRows.push({
        rtu_id: rtuId,
        building_address: buildingAddress,
        rtu_name: rtuName,
        file_name: fileName,
        position,
        hidden: hidden.has(`${key}|${fileName}`),
      })
    }
  }
  if (pictureRows.length) {
    const { error } = await supabase.from('rtu_pictures').insert(pictureRows)
    if (error) throw error
  }
  console.log(`Pictures metadata: ${pictureRows.length} rows`)
}

async function migrateDocuments() {
  const manifest = readJson('public/database/rtu-documents/documents-manifest.json')
  if (!manifest?.entries) return

  const { data: rtus } = await supabase.from('rtus').select('id, name, building_id')
  const { data: buildings } = await supabase.from('buildings').select('id, address')
  const addressByBuildingId = new Map((buildings ?? []).map((b) => [b.id, b.address]))
  const rtuIdByKey = new Map()
  for (const rtu of rtus ?? []) {
    const address = addressByBuildingId.get(rtu.building_id)
    if (address) rtuIdByKey.set(`${address}|${rtu.name}`, rtu.id)
  }

  let count = 0
  for (const [key, files] of Object.entries(manifest.entries)) {
    const [buildingAddress, rtuName] = key.split('|')
    if (!buildingAddress || !rtuName) continue
    const rtuId = rtuIdByKey.get(key) ?? null
    for (const [position, fileName] of files.entries()) {
      const { error } = await supabase.from('rtu_documents').insert({
        rtu_id: rtuId,
        building_address: buildingAddress,
        rtu_name: rtuName,
        file_name: fileName,
        position,
      })
      if (error) throw error
      count++
    }
  }
  console.log(`Documents metadata: ${count} rows`)
}

async function main() {
  console.log('Migrating JSON snapshots to Supabase…')
  const { buildingIdByAddress } = await migratePortfolio()
  await migratePricing()
  await migratePictures(buildingIdByAddress)
  await migrateDocuments()

  const schedule = readJson('supabase/data/rtu-schedule.json')
  if (schedule?.sourceFile) {
    await supabase.from('app_settings').upsert(
      { key: 'rtu_schedule_source', value: { sourceFile: schedule.sourceFile } },
      { onConflict: 'key' },
    )
  }

  console.log('Done.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
