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
