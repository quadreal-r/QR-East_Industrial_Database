/** Portfolio counts for sync summaries (Node scripts). */

export function countPortfolioStats(portfolio) {
  const buildings = portfolio?.buildings ?? []
  let rtuCount = 0
  for (const building of buildings) {
    rtuCount += building.rtus?.length ?? 0
  }
  return {
    buildingCount: buildings.length,
    rtuCount,
    utilityCount: portfolio?.utilities?.length ?? 0,
    polygonCount: portfolio?.polygons?.length ?? 0,
  }
}

export function countManifestPictures(manifest) {
  const entries = manifest?.entries ?? {}
  let count = 0
  for (const files of Object.values(entries)) {
    if (Array.isArray(files)) count += files.length
  }
  return count
}

export function countScheduleStats(schedule) {
  return {
    scheduleYearCount: Object.keys(schedule?.replacementYears ?? {}).length,
    scheduleNoteCount: Object.keys(schedule?.notes ?? {}).length,
  }
}

export function buildPortfolioSummary(
  portfolio,
  schedule,
  pricing,
  manifest,
  picturesUploaded = 0,
  pictureChunkCount = 0,
  extras = {},
) {
  const portfolioStats = countPortfolioStats(portfolio)
  const scheduleStats = countScheduleStats(schedule ?? {})
  return {
    ...portfolioStats,
    ...scheduleStats,
    pricingRowCount: pricing?.rows?.length ?? 0,
    manifestPictureCount: countManifestPictures(manifest),
    picturesUploaded,
    ...(pictureChunkCount > 0 ? { pictureChunkCount } : {}),
    ...extras,
  }
}
