/** Canonical localStorage keys — UI-only persistence (no portfolio data). */
export const STORAGE_KEYS = {
  settings: 'bme-settings',
  searchHistory: 'bme-search-history',
  hardRefreshView: 'bme-hard-refresh-view',
  lastExcelImportFile: 'bme-last-excel-import-file',
  rtuBudgets: 'bme-rtu-budgets',
  buildingYearBudgets: 'bme-building-year-budgets',
  buildingYearBudgetNotes: 'bme-building-year-budget-notes',
  buildingYearBudgetStatuses: 'bme-building-year-budget-statuses',
  buildingYearBudgetJobTypes: 'bme-building-year-budget-job-types',
  /** Capex budget rows excluded from Cost Center totals (`address::year`). */
  rcbExcludedBudgets: 'bme-rcb-excluded-budgets',
} as const
