import { RTU_AGE_CRITICAL, RTU_AGE_WARN } from '@/lib/constants'
import { getColor } from '@/lib/colors'
import { resolveManagerDisplayName } from '@/lib/managerNames'
import { hasPlaceholderGps, hasVacant, mlCount } from '@/lib/dataQuality'
import { getRtuAge, getRtuYear } from '@/lib/rtu'
import type { RtuDocument } from '@/lib/rtuDocuments'
import type { RtuPicture } from '@/lib/rtuPictures'
import { showToastSuccess } from '@/lib/toast'
import type { Building, LayerKey, Polygon, Rtu, SuiteEntrance, Utility } from '@/types/domain'
import { LAYER_COLORS } from '@/lib/constants'

const VACANT_RE = /^(vacant|no information)$/i

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Google Maps InfoWindow strips `hidden`; use inline display toggles instead. */
const RTU_PICTURE_IMG_ONLOAD =
  "var m=this.parentElement.querySelector('.iw-pictures-missing');if(m)m.style.display='none'"
const RTU_PICTURE_IMG_ONERROR =
  "this.classList.add('iw-pictures-img--missing');var m=this.parentElement.querySelector('.iw-pictures-missing');if(m)m.style.display='flex'"

function closeButton(): string {
  return '<button class="iw-close" data-iw-action="close" title="Close">✕</button>'
}

function moveButton(attrs: Record<string, string>): string {
  const dataAttrs = Object.entries(attrs)
    .map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`)
    .join('')
  return `<button class="iw-move-btn" data-iw-action="move"${dataAttrs} title="Move this marker">↔ Move</button>`
}

function actionFooter(buttons: string): string {
  return buttons ? `<div class="iw-foot"><div class="iw-actions">${buttons}</div></div>` : ''
}

function copyButton(): string {
  return `<button class="iw-copy-btn" data-iw-action="copy-all" title="Copy all information">📋 Copy</button>`
}

function pictureButton(): string {
  return `<button class="iw-pic-btn" data-iw-action="pictures" title="View RTU pictures">🖼 Picture</button>`
}

function documentsButton(): string {
  return `<button class="iw-doc-btn" data-iw-action="documents" title="View RTU documents">📄 Documents</button>`
}

function editTextButton(): string {
  return `<button class="iw-edit-btn" data-iw-action="edit-text" title="Edit RTU name and description">✎ Edit</button>`
}

function assignPendingPictureButton(count: number): string {
  return `<button type="button" class="iw-pic-btn" data-iw-action="picture-assign-pending" title="Assign the closest pending photo within range">📎 Assign pending photo${count > 1 ? ` (${count} nearby)` : ''}</button>`
}

function inspection360TourButton(hasTour: boolean): string {
  const title = hasTour
    ? 'Open the hooked QR-360° tour for this gate'
    : 'Open the QR-360° tour viewer and open or create a project for this gate'
  return `<button type="button" class="iw-pic-btn" data-iw-action="inspection360-open" title="${title}">🌐 Enter QR-360° Tour</button>`
}

function isUtilitySphereGate(layerKey: LayerKey): boolean {
  return layerKey === 'electrical' || layerKey === 'sprinkler'
}

function buildRtuDocumentsBodyHtml(documents: RtuDocument[] | 'loading'): string {
  if (documents === 'loading') {
    return '<div class="iw-documents-empty">Loading…</div>'
  }
  if (documents.length === 0) {
    return '<div class="iw-documents-empty">No documents on Cloudflare for this RTU.</div>'
  }
  return `<label class="iw-documents-select-all-wrap">
      <input type="checkbox" class="iw-documents-select-all" data-iw-action="documents-select-all" checked />
      <span>Select all</span>
    </label>
    <ul class="iw-documents-list">${documents
    .map(
      (doc) =>
        `<li class="iw-documents-item">
          <label class="iw-documents-check-wrap" title="Select for download">
            <input type="checkbox" class="iw-documents-check" data-iw-document-url="${escapeHtml(doc.url)}" data-iw-document-file="${escapeHtml(doc.fileName)}" checked />
          </label>
          <a class="iw-documents-link" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(doc.fileName)}">${escapeHtml(doc.label)}</a>
        </li>`,
    )
    .join('')}</ul>`
}

/** Cloudflare R2 rtu-documents bucket — document list body. */
export function buildRtuDocumentsContainerHtml(documents: RtuDocument[] | 'loading'): string {
  return `<div class="iw-documents" data-iw-documents-root>
    <div class="iw-documents-head">Documents <span class="iw-documents-sub">Cloudflare R2</span></div>
    ${buildRtuDocumentsBodyHtml(documents)}
  </div>`
}

export function buildRtuDocumentsPageHtml(
  rtu: Rtu,
  buildingAddress: string,
  documents: RtuDocument[] | 'loading',
): string {
  const name = rtu.name ?? ''
  const age = getRtuAge(rtu)
  let ageLine = ''
  if (age != null) {
    if (age >= RTU_AGE_CRITICAL) {
      ageLine = `<span class="iw-rtu-age critical" style="margin-left:6px">${age} yrs old</span>`
    } else if (age >= RTU_AGE_WARN) {
      ageLine = `<span class="iw-rtu-age warn" style="margin-left:6px">${age} yrs old</span>`
    }
  }

  const backBtn = `<button type="button" class="iw-back-btn" data-iw-action="documents-back" title="Back to RTU details">← Details</button>`
  const hasDocs = documents !== 'loading' && documents.length > 0
  const downloadBtn = hasDocs
    ? `<button type="button" class="iw-doc-btn" data-iw-action="documents-download" title="Select documents and download">⬇ Download</button>`
    : ''

  return `<div class="iw iw-documents-page" data-iw-building="${escapeHtml(buildingAddress)}" data-iw-rtu="${escapeHtml(name)}">
    <div class="iw-head"><div class="iw-name">${escapeHtml(name)}${ageLine}</div>${closeButton()}</div>
    <div class="iw-body iw-documents-page-body">${buildRtuDocumentsContainerHtml(documents)}</div>
    ${actionFooter(`${backBtn}${downloadBtn}`)}
  </div>`
}

function copySource(text: string): string {
  return `<textarea class="iw-copy-source" readonly aria-hidden="true" tabindex="-1">${escapeHtml(text)}</textarea>`
}

function plainRow(label: string, value: string): string {
  const width = Math.max(12, label.length + 1)
  return `${label.padEnd(width)}${value}`
}

function plainDetailLines(desc: string): string[] {
  return desc.split(/\r?\n/).filter(Boolean).map((line) => {
    const idx = line.indexOf(':')
    if (idx > 0) {
      return plainRow(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
    }
    return line
  })
}

export function copyPopupText(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(() => showToastSuccess('📋 Copied popup contents'))
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  showToastSuccess('📋 Copied popup contents')
}

function buildingBadgeText(building: Building): string {
  const parts = [building.park.replace(/\s*\(x\s*\d+\)/, '').trim()]
  if (building.cluster?.trim()) parts.push(building.cluster.trim())
  return parts.join('  ')
}

function isPolygonVacant(polygon: Polygon): boolean {
  return VACANT_RE.test((polygon.description ?? '').trim())
}

function buildingOperatorDisplay(building: Building): string {
  const name = building.buildingOperator?.trim() || ''
  const phone = building.operatorPhone?.trim() || ''
  if (name && phone) return `${name} · ${phone}`
  if (name) return name
  if (phone) return phone
  return '—'
}

export function buildBuildingInfoPlainText(
  building: Building,
  tenantPolygons: Polygon[] = [],
  managerRenames: Record<string, string> = {},
): string {
  const lines: string[] = [building.address, buildingBadgeText(building), '']
  lines.push(plainRow('BU #', building.bu || '—'))
  lines.push(plainRow('Portfolio', building.cluster || building.park || '—'))
  lines.push(
    plainRow('Manager', resolveManagerDisplayName(building.manager ?? '', managerRenames) || '—'),
  )
  lines.push(plainRow('Operator', buildingOperatorDisplay(building)))
  lines.push(plainRow('Sq Ft', building.sqft || '—'))

  if (building.rtus?.length) {
    let nCritical = 0
    let nWarn = 0
    for (const r of building.rtus) {
      const age = getRtuAge(r)
      if (age == null) continue
      if (age >= RTU_AGE_CRITICAL) nCritical++
      else if (age >= RTU_AGE_WARN) nWarn++
    }
    let title = `RTUs (${building.rtus.length})`
    if (nCritical > 0) title += ` · ${nCritical} CRITICAL`
    else if (nWarn > 0) title += ' · SOME AGING'
    lines.push('', title)

    for (const r of building.rtus) {
      const age = getRtuAge(r)
      const yr = getRtuYear(r)
      let nameLine = r.name
      if (age != null && age >= RTU_AGE_CRITICAL) nameLine += `  ${age} yrs`
      else if (age != null && age >= RTU_AGE_WARN) nameLine += `  ${age} yrs`
      lines.push(nameLine)
      const mModel = r.description.match(/Model[:\s]+([^\r\n]+)/i)
      const mMake = r.description.match(/Make[:\s]+([^\r\n]+)/i)
      const detail = [mModel?.[1]?.trim(), mMake?.[1]?.trim(), yr ? `(${yr})` : '']
        .filter(Boolean)
        .join(' · ')
      if (detail) lines.push(`  ${detail}`)
    }
  }

  if (tenantPolygons.length) {
    lines.push('', `Tenant Polygons (${tenantPolygons.length})`)
    for (const polygon of tenantPolygons) {
      const desc = polygon.description || ''
      lines.push(desc ? `${polygon.name}  ${desc}` : polygon.name)
    }
  }

  return lines.join('\n').trimEnd()
}

export function buildDetailInfoPlainText(
  layerKey: LayerKey,
  data: Rtu | Utility | SuiteEntrance,
  options?: { buildingAddress?: string },
): string {
  void options?.buildingAddress
  const name = data.name ?? ''
  const lines: string[] = [name]

  if (layerKey === 'inspection360') {
    lines.push('')
    lines.push('360° inspection gate')
    if (options?.buildingAddress) lines.push(`Building: ${options.buildingAddress}`)
    const entrance = data as SuiteEntrance
    if (entrance.description) lines.push(...plainDetailLines(entrance.description))
    if (entrance.inspection_url) lines.push(`Tour URL: ${entrance.inspection_url}`)
    else lines.push('Tour URL: not connected yet')
    return lines.join('\n').trimEnd()
  }

  if (
    (layerKey === 'electrical' || layerKey === 'sprinkler') &&
    'utility_type' in data
  ) {
    const utility = data as Utility
    lines.push('')
    lines.push(layerKey === 'electrical' ? 'Electrical room 360° gate' : 'Sprinkler room 360° gate')
    if (utility.description) lines.push(...plainDetailLines(utility.description))
    if (utility.inspection_url) lines.push(`Tour URL: ${utility.inspection_url}`)
    else lines.push('Tour URL: not connected yet')
    return lines.join('\n').trimEnd()
  }

  if (layerKey === 'rtu') {
    const age = getRtuAge(data as Rtu)
    if (age != null) {
      if (age >= RTU_AGE_CRITICAL) lines[0] = `${name}  ${age} yrs old`
      else if (age >= RTU_AGE_WARN) lines[0] = `${name}  ${age} yrs old`
    }
  }

  lines.push('')
  lines.push(...plainDetailLines(data.description ?? ''))

  return lines.join('\n').trimEnd()
}

function isTenantVacant(polygon: Polygon): boolean {
  return isPolygonVacant(polygon)
}

function buildingStatusBadges(building: Building, tenantPolygons: Polygon[]): string {
  let badges = ''
  if (hasVacant(building, tenantPolygons)) {
    badges += ` <span class="iw-badge" style="background:rgba(251,146,60,.2);color:#fb923c;border:1px solid rgba(251,146,60,.4)">VACANT</span>`
  }
  const ml = mlCount(building)
  if (ml) {
    badges += ` <span class="iw-badge" style="background:rgba(167,139,250,.2);color:#a78bfa;border:1px solid rgba(167,139,250,.4)">ML×${ml}</span>`
  }
  return badges
}

export function buildBuildingInfoHtml(
  building: Building,
  tenantPolygons: Polygon[] = [],
  managerRenames: Record<string, string> = {},
  options?: { showMove?: boolean },
): string {
  const bColor = getColor(building.park)
  const managerLabel = resolveManagerDisplayName(building.manager ?? '', managerRenames) || '—'
  const operatorLabel = buildingOperatorDisplay(building)

  let badges = `<span class="iw-badge" style="background:${bColor}22;color:${bColor};border:1px solid ${bColor}44">${escapeHtml(building.park.replace(/\s*\(x\s*\d+\)/, ''))}</span>`
  if (building.cluster?.trim()) {
    badges += ` <span class="iw-badge" style="background:rgba(125,184,255,.12);color:#7db8ff;border:1px solid rgba(125,184,255,.3)">${escapeHtml(building.cluster)}</span>`
  }
  badges += buildingStatusBadges(building, tenantPolygons)

  const stats = [
    `<div class="iw-row"><strong>BU #</strong><span class="iw-val">${escapeHtml(building.bu || '—')}</span></div>`,
    `<div class="iw-row"><strong>Portfolio</strong><span class="iw-val">${escapeHtml(building.cluster || building.park || '—')}</span></div>`,
    `<div class="iw-row"><strong>Manager</strong><span class="iw-val">${escapeHtml(managerLabel)}</span></div>`,
    `<div class="iw-row"><strong>Operator</strong><span class="iw-val">${escapeHtml(operatorLabel)}</span></div>`,
    `<div class="iw-row"><strong>Sq Ft</strong><span class="iw-val">${escapeHtml(building.sqft || '—')}</span></div>`,
  ].join('')

  let rtuHtml = ''
  if (building.rtus?.length) {
    let nCritical = 0
    let nWarn = 0
    for (const r of building.rtus) {
      const age = getRtuAge(r)
      if (age == null) continue
      if (age >= RTU_AGE_CRITICAL) nCritical++
      else if (age >= RTU_AGE_WARN) nWarn++
    }
    let agingLabel = ''
    if (nCritical > 0) {
      agingLabel = ` <span style="color:#ff6060;font-weight:700;font-size:10px">· ${nCritical} CRITICAL</span>`
    } else if (nWarn > 0) {
      agingLabel = ' <span style="color:#fbbf24;font-weight:700;font-size:10px">· SOME AGING</span>'
    }

    const items = building.rtus
      .map((r) => {
        const age = getRtuAge(r)
        const yr = getRtuYear(r)
        let ageBadge = ''
        if (age != null && age >= RTU_AGE_CRITICAL) {
          ageBadge = ` <span class="iw-rtu-age critical">${age} yrs</span>`
        } else if (age != null && age >= RTU_AGE_WARN) {
          ageBadge = ` <span class="iw-rtu-age warn">${age} yrs</span>`
        }
        const mModel = r.description.match(/Model[:\s]+([^\r\n]+)/i)
        const mMake = r.description.match(/Make[:\s]+([^\r\n]+)/i)
        const detail = [mModel?.[1]?.trim(), mMake?.[1]?.trim(), yr ? `(${yr})` : '']
          .filter(Boolean)
          .join(' · ')
        return `<div class="iw-rtu"><div class="iw-rtu-name">${escapeHtml(r.name)}${ageBadge}</div>${detail ? `<div class="iw-rtu-detail">${escapeHtml(detail)}</div>` : ''}</div>`
      })
      .join('')

    rtuHtml = `<div class="iw-section"><div class="iw-section-title">RTUs (${building.rtus.length})${agingLabel}</div>${items}</div>`
  }

  let tenantHtml = ''
  if (tenantPolygons.length) {
    const items = tenantPolygons
      .map((polygon) => {
        const vacClass = isTenantVacant(polygon) ? ' vacant' : ''
        return `<div class="iw-tenant${vacClass}"><span class="iw-tenant-unit">${escapeHtml(polygon.name)}</span>${escapeHtml(polygon.description || '')}</div>`
      })
      .join('')
    tenantHtml = `<div class="iw-section"><div class="iw-section-title">Tenant Polygons (${tenantPolygons.length})</div>${items}</div>`
  }

  const plainText = buildBuildingInfoPlainText(building, tenantPolygons, managerRenames)
  const showMove = options?.showMove !== false
  const moveBtn = showMove
    ? moveButton({
        'iw-kind': 'building',
        'iw-building': building.address,
      })
    : ''

  return `<div class="iw">${copySource(plainText)}<div class="iw-head"><div class="iw-name">${escapeHtml(building.address)}</div><div class="iw-badges">${badges}</div>${closeButton()}</div><div class="iw-body">${stats}${rtuHtml}${tenantHtml}</div>${actionFooter(`${copyButton()}${moveBtn}`)}</div>`
}

export function buildDetailInfoHtml(
  layerKey: LayerKey,
  data: Rtu | Utility | SuiteEntrance,
  options?: {
    showDelete?: boolean
    showMove?: boolean
    showEdit?: boolean
    buildingAddress?: string
    pendingPictureAssignCount?: number
    /** Local gate hook or remote tour — when set, overrides inspection_url for Tour row/button. */
    tourConnected?: boolean
    tourLabel?: string
  },
): string {
  const cfg = LAYER_COLORS[layerKey]
  const name = data.name ?? ''
  const desc = data.description ?? ''
  const showMove = options?.showMove !== false
  const showEdit = options?.showEdit !== false

  if (layerKey === 'inspection360') {
    const entrance = data as SuiteEntrance
    const tenantLine = desc.split(/\r?\n/).filter(Boolean)[0] ?? ''
    const hasTour =
      options?.tourConnected ?? Boolean(entrance.inspection_url?.trim())
    const tourText =
      options?.tourLabel ||
      (hasTour ? 'Connected' : 'Not connected yet')
    const tourStatus = hasTour
      ? `<div class="iw-row"><strong>Tour</strong><span class="iw-val">${escapeHtml(tourText)}</span></div>`
      : `<div class="iw-row"><strong>Tour</strong><span class="iw-val" style="opacity:.75">Not connected yet</span></div>`
    const buildingRow = options?.buildingAddress
      ? `<div class="iw-row"><strong>Building</strong><span class="iw-val">${escapeHtml(options.buildingAddress)}</span></div>`
      : ''
    const moveBtn = showMove
      ? moveButton({
          'iw-kind': 'detail',
          'iw-layer': layerKey,
          'iw-name': name,
          'iw-building': options?.buildingAddress ?? '',
        })
      : ''
    const tourBtn = inspection360TourButton(hasTour)
    const plainText = buildDetailInfoPlainText(layerKey, data, options)
    const body = [
      buildingRow,
      tenantLine
        ? `<div class="iw-row"><strong>Tenant</strong><span class="iw-val">${escapeHtml(tenantLine)}</span></div>`
        : '',
      tourStatus,
    ].join('')
    return `<div class="iw">${copySource(plainText)}<div class="iw-head"><div class="iw-name">${escapeHtml(name)}</div>${closeButton()}</div><div class="iw-body">${body}</div>${actionFooter(`${tourBtn}${moveBtn}`)}</div>`
  }

  if (isUtilitySphereGate(layerKey) && 'utility_type' in data) {
    const utility = data as Utility
    const hasTour =
      options?.tourConnected ?? Boolean(utility.inspection_url?.trim())
    const tourText =
      options?.tourLabel ||
      (hasTour ? 'Connected' : 'Not connected yet')
    const tourStatus = hasTour
      ? `<div class="iw-row"><strong>Tour</strong><span class="iw-val">${escapeHtml(tourText)}</span></div>`
      : `<div class="iw-row"><strong>Tour</strong><span class="iw-val" style="opacity:.75">Not connected yet</span></div>`
    const lines = desc.split(/\r?\n/).filter(Boolean)
    const noteRows = lines
      .map((line) => {
        const idx = line.indexOf(':')
        if (idx > 0) {
          return `<div class="iw-row"><strong>${escapeHtml(line.slice(0, idx).trim())}</strong><span class="iw-val">${escapeHtml(line.slice(idx + 1).trim())}</span></div>`
        }
        return `<div class="iw-row">${escapeHtml(line)}</div>`
      })
      .join('')
    const moveBtn = showMove
      ? moveButton({
          'iw-kind': 'detail',
          'iw-layer': layerKey,
          'iw-name': name,
          'iw-building': options?.buildingAddress ?? '',
        })
      : ''
    const deleteBtn =
      options?.showDelete === false || !showEdit
        ? ''
        : `<button class="iw-del-btn" data-iw-action="delete" data-iw-layer="${layerKey}" data-iw-name="${escapeHtml(name)}" data-iw-building="${escapeHtml(options?.buildingAddress ?? '')}" title="Delete this marker">🗑 Delete</button>`
    const tourBtn = inspection360TourButton(hasTour)
    const plainText = buildDetailInfoPlainText(layerKey, data, options)
    return `<div class="iw">${copySource(plainText)}<div class="iw-head"><div class="iw-name">${escapeHtml(name)}</div>${closeButton()}</div><div class="iw-body">${noteRows}${tourStatus}</div>${actionFooter(`${copyButton()}${tourBtn}${moveBtn}${deleteBtn}`)}</div>`
  }

  const lines = desc.split(/\r?\n/).filter(Boolean)
  const rows = lines
    .map((line) => {
      const idx = line.indexOf(':')
      if (idx > 0) {
        return `<div class="iw-row"><strong>${escapeHtml(line.slice(0, idx).trim())}</strong><span class="iw-val">${escapeHtml(line.slice(idx + 1).trim())}</span></div>`
      }
      return `<div class="iw-row">${escapeHtml(line)}</div>`
    })
    .join('')

  let ageLine = ''
  if (layerKey === 'rtu') {
    const age = getRtuAge(data as Rtu)
    if (age != null) {
      if (age >= RTU_AGE_CRITICAL) {
        ageLine = `<span class="iw-rtu-age critical" style="margin-left:6px">${age} yrs old</span>`
      } else if (age >= RTU_AGE_WARN) {
        ageLine = `<span class="iw-rtu-age warn" style="margin-left:6px">${age} yrs old</span>`
      }
    }
  }

  const badgeHtml =
    layerKey === 'rtu'
      ? ''
      : `<div class="iw-badges"><span class="iw-badge" style="background:${cfg.fill}22;color:${cfg.fill};border:1px solid ${cfg.fill}44">${layerKey.toUpperCase()}</span></div>`

  const moveBtn =
    layerKey === 'rtu' || !showMove
      ? ''
      : moveButton({
          'iw-kind': 'detail',
          'iw-layer': layerKey,
          'iw-name': name,
          'iw-building': options?.buildingAddress ?? '',
        })
  const deleteBtn =
    layerKey === 'rtu' || options?.showDelete === false || !showEdit
      ? ''
      : `<button class="iw-del-btn" data-iw-action="delete" data-iw-layer="${layerKey}" data-iw-name="${escapeHtml(name)}" data-iw-building="${escapeHtml(options?.buildingAddress ?? '')}" title="Delete this marker">🗑 Delete</button>`
  const plainText = buildDetailInfoPlainText(layerKey, data, options)

  const pictureBtn = layerKey === 'rtu' ? pictureButton() : ''
  const documentsBtn = layerKey === 'rtu' ? documentsButton() : ''
  const editTextBtn = layerKey === 'rtu' && showEdit ? editTextButton() : ''
  const assignPendingBtn =
    layerKey === 'rtu' && showEdit && (options?.pendingPictureAssignCount ?? 0) > 0
      ? assignPendingPictureButton(options!.pendingPictureAssignCount!)
      : ''
  const copyBtn = layerKey === 'rtu' ? '' : copyButton()

  return `<div class="iw">${copySource(plainText)}<div class="iw-head"><div class="iw-name">${escapeHtml(name)}${ageLine}</div>${badgeHtml}${closeButton()}</div><div class="iw-body">${rows}</div>${actionFooter(`${copyBtn}${assignPendingBtn}${pictureBtn}${documentsBtn}${editTextBtn}${moveBtn}${deleteBtn}`)}</div>`
}

export function buildPolygonInfoHtml(
  polygon: Polygon,
  options?: {
    assignedBuildingAddress?: string | null
  },
): string {
  const esc = (t: string) => escapeHtml(t)
  const buildingAddress = options?.assignedBuildingAddress ?? null
  const assignedLine = buildingAddress
    ? `<div class="iw-row"><strong>Building</strong><span class="iw-val">${esc(buildingAddress)}</span></div>`
    : ''

  return `<div class="iw"><div class="iw-head"><div class="iw-name">${esc(polygon.name || 'Polygon')}</div></div><div class="iw-body">${assignedLine}${
    polygon.description
      ? `<div class="iw-row" style="white-space:pre-wrap">${esc(polygon.description)}</div>`
      : ''
  }</div></div>`
}

export function buildDetailEditHtml(
  data: Rtu,
  options?: { buildingAddress?: string },
): string {
  const name = data.name ?? ''
  const desc = data.description ?? ''
  const buildingAttr = options?.buildingAddress
    ? ` data-iw-building="${escapeHtml(options.buildingAddress)}"`
    : ''
  const plainText = buildDetailInfoPlainText('rtu', data, options)

  return `<div class="iw iw-edit"${buildingAttr} data-iw-rtu-name="${escapeHtml(name)}">
    ${copySource(plainText)}
    <div class="iw-head"><div class="iw-name">Edit RTU</div>${closeButton()}</div>
    <div class="iw-body iw-edit-body">
      <label class="iw-edit-label">Name
        <input class="iw-edit-input" data-iw-field="name" type="text" value="${escapeHtml(name)}" />
      </label>
      <label class="iw-edit-label">Description
        <textarea class="iw-edit-textarea" data-iw-field="description" rows="6">${escapeHtml(desc)}</textarea>
      </label>
    </div>
    ${actionFooter(`${copyButton()}<button type="button" class="iw-edit-btn" data-iw-action="edit-save">Save</button><button type="button" class="iw-back-btn" data-iw-action="edit-cancel">Cancel</button>`)}
  </div>`
}

export function buildRtuPicturesHtml(
  rtu: Rtu,
  buildingAddress: string,
  pictures: RtuPicture[],
  pictureIndex: number,
): string {
  const name = rtu.name ?? ''
  const age = getRtuAge(rtu)
  let ageLine = ''
  if (age != null) {
    if (age >= RTU_AGE_CRITICAL) {
      ageLine = `<span class="iw-rtu-age critical" style="margin-left:6px">${age} yrs old</span>`
    } else if (age >= RTU_AGE_WARN) {
      ageLine = `<span class="iw-rtu-age warn" style="margin-left:6px">${age} yrs old</span>`
    }
  }

  const total = pictures.length
  const safeIndex = total ? Math.min(Math.max(pictureIndex, 0), total - 1) : 0
  const current = total ? pictures[safeIndex]! : null

  const body = !total
    ? `<div class="iw-pictures-empty">No pictures yet.</div>
      <p class="iw-pictures-hint">Choose images from your computer to attach to this RTU.</p>`
    : `<div class="iw-pictures-view">
      <div class="iw-pictures-frame">
        <button type="button" class="iw-pictures-nav iw-pictures-nav-prev" data-iw-action="picture-prev" title="Previous picture"${total <= 1 ? ' disabled' : ''} aria-label="Previous picture">‹</button>
        <button type="button" class="iw-pictures-link" data-iw-action="picture-open-viewer" title="Open full size in viewer">
          <img class="iw-pictures-img" src="${escapeHtml(current!.thumbUrl)}" alt="${escapeHtml(current!.fileName)}" onload="${RTU_PICTURE_IMG_ONLOAD}" onerror="${RTU_PICTURE_IMG_ONERROR}" />
          <div class="iw-pictures-missing" style="display:none">Image not found on server. Use Add pictures to upload a replacement, or Hide to remove this entry.</div>
        </button>
        <button type="button" class="iw-pictures-nav iw-pictures-nav-next" data-iw-action="picture-next" title="Next picture"${total <= 1 ? ' disabled' : ''} aria-label="Next picture">›</button>
      </div>
    </div>
    <div class="iw-pictures-meta">
      <div class="iw-pictures-stepper">
        <button type="button" class="iw-pictures-step" data-iw-action="picture-prev" title="Previous picture"${total <= 1 ? ' disabled' : ''}>← Prev</button>
        <span class="iw-pictures-counter">${safeIndex + 1} / ${total}</span>
        <button type="button" class="iw-pictures-step" data-iw-action="picture-next" title="Next picture"${total <= 1 ? ' disabled' : ''}>Next →</button>
      </div>
      <span class="iw-pictures-name">${escapeHtml(current!.fileName)}</span>
    </div>`

  const addBtn = `<button type="button" class="iw-pic-btn" data-iw-action="picture-add" title="Add pictures from disk">＋ Add pictures</button>`
  const backBtn = `<button type="button" class="iw-back-btn" data-iw-action="pictures-back" title="Back to RTU details">← Details</button>`
  const deletePicBtn =
    total && current
      ? `<button type="button" class="iw-del-btn" data-iw-action="picture-delete" data-iw-picture-file="${escapeHtml(current.fileName)}" title="Delete this picture from the map and Cloudflare">🗑 Delete</button>`
      : ''

  return `<div class="iw iw-pictures" data-iw-building="${escapeHtml(buildingAddress)}" data-iw-rtu="${escapeHtml(name)}" data-iw-picture-index="${safeIndex}">
    <div class="iw-head"><div class="iw-name">${escapeHtml(name)}${ageLine}</div>${closeButton()}</div>
    <div class="iw-body iw-pictures-body">${body}</div>
    <input type="file" class="iw-pictures-input" data-iw-picture-input accept="image/*" multiple hidden />
    ${actionFooter(`${backBtn}${addBtn}${deletePicBtn}`)}
  </div>`
}

export function hasBadGps(building: Building): boolean {
  return hasPlaceholderGps(building)
}
