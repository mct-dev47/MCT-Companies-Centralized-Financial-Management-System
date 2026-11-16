import * as React from 'react'
import { Building2 } from 'lucide-react'
import {
  type DateRange,
} from '@/components/ui/DateRangePicker'
import { TransactionDateRangeControl } from '@/components/transactions/TransactionDateRangeControl'

export interface DashboardFilterState {
  dateRange: DateRange
  company?: string
}

interface DashboardHeaderProps {
  filters: DashboardFilterState
  onFiltersChange: (newFilters: DashboardFilterState) => void
  activeCompanyName?: string
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  filters,
  onFiltersChange,
  activeCompanyName,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-1">
      <div className="min-w-0 shrink">
        <p className="text-xs sm:text-sm text-muted-fg font-normal truncate max-w-md xl:max-w-xl">
          {activeCompanyName
            ? `Viewing financial records and transactions for ${activeCompanyName}.`
            : "Viewing authorized company records and financial summaries."}
        </p>
      </div>

      {/* Uniform Filter Bar: Date Range Picker & Active Company Indicator */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 flex-wrap sm:flex-nowrap self-start sm:self-auto max-w-full">
        <TransactionDateRangeControl
          value={filters.dateRange}
          onChange={(newDateRange) => {
            onFiltersChange({ ...filters, dateRange: newDateRange })
          }}
          className="shrink-0"
        />

        {activeCompanyName && (
          <div className="inline-flex items-center gap-1.5 h-10 sm:h-11 px-3.5 rounded-full border border-stroke/60 bg-white text-focus text-xs sm:text-sm font-semibold shadow-xs select-none shrink-0">
            <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate max-w-[180px] sm:max-w-[220px]">{activeCompanyName}</span>
          </div>
        )}
      </div>
    </div>
  )
}
