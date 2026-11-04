import * as React from 'react'
import {
  DateRangePicker,
  type DateRange,
  type DateRangePickerProps,
} from '@/components/ui/DateRangePicker'

export type { DateRange }

export interface DateRangeFilterProps extends DateRangePickerProps {}

/**
 * Shared Date Range Filter component.
 * Re-exports the global DateRangePicker so all views across Admin
 * and Company Auditor share the exact same calendar picker with no presets.
 */
export const DateRangeFilter: React.FC<DateRangeFilterProps> = (props) => {
  return <DateRangePicker {...props} />
}
