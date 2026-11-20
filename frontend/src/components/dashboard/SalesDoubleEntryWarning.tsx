import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { getSalesDoubleEntryWarning } from '@/config/companyFeatures'

/**
 * Non-blocking notice for companies (JK Property, FilCap) whose Tenant / Lending
 * modules already post income to Transactions and Bank.
 */
export const SalesDoubleEntryWarning: React.FC<{
  company?: string | null
  className?: string
}> = ({ company, className }) => {
  const message = getSalesDoubleEntryWarning(company)
  if (!message) return null

  return (
    <div
      role="note"
      className={`${className ?? ''} flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900`}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
      <span>{message}</span>
    </div>
  )
}
