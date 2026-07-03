import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Read vx.y.z label from generated buildVersion.ts or version.build.json. */
export function readBuildVersionLabel(root) {
  const generatedPath = join(root, 'src', 'generated', 'buildVersion.ts')
  if (existsSync(generatedPath)) {
    const text = readFileSync(generatedPath, 'utf8')
    const match = text.match(/BUILD_VERSION_LABEL\s*=\s*'([^']+)'/)
    if (match?.[1]) return match[1]
  }
  const jsonPath = join(root, 'version.build.json')
  if (existsSync(jsonPath)) {
    try {
      const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
      if (data.semver) return `v${data.semver}`
      // Legacy date/build format
      const { date, build } = data
      if (date && build != null) return `v${date} (${build})`
    } catch {
      /* ignore */
    }
  }
  return null
}
