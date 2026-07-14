export interface ThemeDefinition {
  name: string
  vars: Record<string, string>
  palette: string[]
}

export const APP_THEMES: ThemeDefinition[] = [
  {
    // QuadReal Visual Brand Guidelines V2.4 (Nov 2025)
    name: 'QuadReal Brand (default)',
    vars: {
      '--bg': '#132049',
      '--surface': '#173073',
      '--surface2': '#0f1a3a',
      '--border': '#2947A3',
      '--accent': '#4974FF',
      '--text-primary': '#ffffff',
      '--text-secondary': '#B7C9FF',
      '--text-muted': '#83A6FF',
      '--selected-bg': '#2947A3',
      '--selected-border': '#4974FF',
      '--hover-bg': '#1e3568',
      '--sqft-color': '#00B6D3',
      '--group-color': '#B7C9FF',
    },
    palette: ['#132049', '#173073', '#4974FF', '#B7C9FF'],
  },
  {
    name: 'Olive Grove',
    vars: {
      '--bg': '#2b2e18',
      '--surface': '#3a3f20',
      '--surface2': '#2b2e18',
      '--border': '#565c2e',
      '--accent': '#d4de95',
      '--text-primary': '#f2f4e8',
      '--text-secondary': '#c8cf8a',
      '--text-muted': '#a0a860',
      '--selected-bg': '#4d5426',
      '--selected-border': '#d4de95',
      '--hover-bg': '#434922',
      '--sqft-color': '#d4de95',
      '--group-color': '#c8cf8a',
    },
    palette: ['#636B2F', '#BAC095', '#D4DE95', '#3D4127'],
  },
  {
    name: 'Forest',
    vars: {
      '--bg': '#1b2e1e',
      '--surface': '#253d2c',
      '--surface2': '#1b2e1e',
      '--border': '#3a5e42',
      '--accent': '#68ba7f',
      '--text-primary': '#e8f5eb',
      '--text-secondary': '#a8d6b0',
      '--text-muted': '#78b884',
      '--selected-bg': '#2e4e35',
      '--selected-border': '#68ba7f',
      '--hover-bg': '#2a4430',
      '--sqft-color': '#cfffdc',
      '--group-color': '#a8d6b0',
    },
    palette: ['#2E6F40', '#CFFFDC', '#68BA7F', '#253D2C'],
  },
  {
    name: 'Chocolate Truffle',
    vars: {
      '--bg': '#1c0d03',
      '--surface': '#2e1105',
      '--surface2': '#1c0d03',
      '--border': '#5a2d08',
      '--accent': '#c05800',
      '--text-primary': '#fdfbd4',
      '--text-secondary': '#e8c48a',
      '--text-muted': '#b88a50',
      '--selected-bg': '#3d1a06',
      '--selected-border': '#c05800',
      '--hover-bg': '#361608',
      '--sqft-color': '#fdfbd4',
      '--group-color': '#e8c48a',
    },
    palette: ['#713600', '#C05800', '#FDFBD4', '#38240D'],
  },
  {
    name: 'Chai Latte',
    vars: {
      '--bg': '#1a1108',
      '--surface': '#2a1d0e',
      '--surface2': '#1a1108',
      '--border': '#6b3d12',
      '--accent': '#d47e30',
      '--text-primary': '#fdfbd4',
      '--text-secondary': '#e5c89a',
      '--text-muted': '#b89060',
      '--selected-bg': '#3a2510',
      '--selected-border': '#d47e30',
      '--hover-bg': '#311f0c',
      '--sqft-color': '#fdfbd4',
      '--group-color': '#e5c89a',
    },
    palette: ['#FDFBD4', '#D47E30', '#8D5A2B', '#825E34'],
  },
  {
    name: 'Electric Sky',
    vars: {
      '--bg': '#1a2030',
      '--surface': '#202a40',
      '--surface2': '#141c2e',
      '--border': '#3a5070',
      '--accent': '#66c4ff',
      '--text-primary': '#f0f8ff',
      '--text-secondary': '#a8d8f8',
      '--text-muted': '#6a98c0',
      '--selected-bg': '#253550',
      '--selected-border': '#66c4ff',
      '--hover-bg': '#1e2e45',
      '--sqft-color': '#ffc067',
      '--group-color': '#a8d8f8',
    },
    palette: ['#FFC067', '#66F4FF', '#66C4FF', '#7D99AA'],
  },
]

export function updateBldgLabelColor(bg: string, accent: string): void {
  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules ?? []
      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j] as CSSStyleRule
        if (rule.selectorText === '.bldg-label' || rule.selectorText === '.bldg-marker-label') {
          rule.style.setProperty('background', `${bg}eb`, 'important')
          rule.style.setProperty('border', `1px solid ${accent}66`, 'important')
        }
      }
    } catch {
      /* cross-origin stylesheets */
    }
  }
}

export function applyThemeVars(themeIndex: number): void {
  const theme = APP_THEMES[themeIndex] ?? APP_THEMES[0]!
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value)
  }
  updateBldgLabelColor(theme.vars['--bg']!, theme.vars['--accent']!)
}
