import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface TablePaginationProps {
  /** 1-based current page index */
  currentPage: number
  totalPages: number
  totalItems?: number
  totalRecords?: number
  /** 0-based start index, or omit to compute from `pageSize` */
  startIndex?: number
  /** 0-based exclusive end index, or omit to compute from `pageSize` */
  endIndex?: number
  pageSize?: number
  onPageChange: (page: number) => void
  /** Singular/plural noun, defaults to 'records' */
  itemLabel?: string
  disabled?: boolean
  className?: string
}

/**
 * Canonical TablePagination footer used across all tables.
 * Displays "Showing X-Y of Z records", "Page N out of M", and Prev/Next chevron buttons.
 */
export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  totalRecords,
  startIndex,
  endIndex,
  pageSize = 10,
  onPageChange,
  itemLabel = 'records',
  disabled = false,
  className,
}) => {
  const effectiveTotal = totalRecords !== undefined ? totalRecords : (totalItems ?? 0)
  const safeTotalPages = Math.max(1, totalPages)
  const safeCurrent = Math.min(Math.max(1, currentPage), safeTotalPages)
  const resolvedStart =
    startIndex !== undefined ? startIndex : (safeCurrent - 1) * pageSize
  const resolvedEnd =
    endIndex !== undefined
      ? endIndex
      : Math.min(resolvedStart + pageSize, effectiveTotal)

  return (
    <div
      className={cn(
        'pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg',
        className
      )}
    >
      <span className="font-medium text-focus/80">
        {effectiveTotal === 0
          ? `Showing 0 of 0 ${itemLabel}`
          : `Showing ${resolvedStart + 1}-${resolvedEnd} of ${effectiveTotal} ${itemLabel}`}
      </span>

      <div className="flex items-center gap-2 self-end sm:self-auto">
        <span className="text-xs text-muted-fg italic">
          Page {safeCurrent} out of {safeTotalPages}
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || safeCurrent <= 1}
          onClick={() => onPageChange(Math.max(1, safeCurrent - 1))}
          className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-stroke/40 text-focus hover:bg-surface disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || safeCurrent >= safeTotalPages}
          onClick={() => onPageChange(Math.min(safeTotalPages, safeCurrent + 1))}
          className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-stroke/40 text-focus hover:bg-surface disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

