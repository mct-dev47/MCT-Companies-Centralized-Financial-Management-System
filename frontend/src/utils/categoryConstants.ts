import type { TransactionCategory } from '@/services/dashboardService'

export const CATEGORY_COLORS: Record<string, string> = {
  'Petty Cash': '#F59E0B',      // Amber
  'Rendered Fee': '#3B82F6',    // Blue
  'BBMP Foundation': '#8B5CF6', // Purple
  'HDMF': '#10B981',            // Emerald
  'Philhealth': '#06B6D4',      // Cyan
  'Electricity': '#EF4444',     // Red
  'BIR': '#F97316',             // Orange
  'Payroll': '#6366F1',         // Indigo
  'SSS': '#14B8A6',             // Teal
  'Hotel Supplies': '#EC4899',  // Pink
  'Revolving Funds': '#84CC16', // Lime
  // Sales categories
  'Sales Revenue': '#2563EB',
  'Service Income': '#0D9488',
  'Product Sales': '#7C3AED',
  'Catering': '#DB2777',
  'Other Income': '#65A30D',
  'Rental Income': '#059669',
}

export const CATEGORY_COLOR_PALETTE: string[] = [
  '#2563EB', // Blue
  '#0D9488', // Teal
  '#7C3AED', // Violet
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#EC4899', // Pink
  '#EF4444', // Red
  '#6366F1', // Indigo
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#84CC16', // Lime
  '#8B5CF6', // Purple
]

export function getCategoryColor(categoryName: string, index?: number): string {
  const trimmed = (categoryName || '').trim()
  if (CATEGORY_COLORS[trimmed]) {
    return CATEGORY_COLORS[trimmed]
  }
  const lower = trimmed.toLowerCase()
  for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
    if (key.toLowerCase() === lower) {
      return val
    }
  }
  if (typeof index === 'number' && index >= 0) {
    return CATEGORY_COLOR_PALETTE[index % CATEGORY_COLOR_PALETTE.length]
  }
  let hash = 0
  for (let i = 0; i < lower.length; i++) {
    hash = (hash * 31 + lower.charCodeAt(i)) >>> 0
  }
  return CATEGORY_COLOR_PALETTE[hash % CATEGORY_COLOR_PALETTE.length]
}

export const CATEGORY_LIST: TransactionCategory[] = [
  'Petty Cash',
  'Rendered Fee',
  'BBMP Foundation',
  'HDMF',
  'Philhealth',
  'Electricity',
  'BIR',
  'Payroll',
  'SSS',
  'Hotel Supplies',
  'Revolving Funds',
]

// Categories offered on the Add Sales forms
export const SALES_CATEGORY_LIST: string[] = [
  'Sales Revenue',
  'Service Income',
  'Product Sales',
  'Catering',
  'Other Income',
]
