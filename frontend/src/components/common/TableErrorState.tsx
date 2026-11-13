import * as React from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { TableRow, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface TableErrorStateProps {
  colSpan: number
  title?: string
  message?: string | React.ReactNode
  onRetry?: () => void
  className?: string
}

/**
 * Standard TableErrorState conforming to Phase 2 Section C & G:
 * - Clear error message in plain language (no raw stack traces or codes)
 * - Designed Retry action button
 */
export const TableErrorState: React.FC<TableErrorStateProps> = ({
  colSpan,
  title = 'Failed to load records',
  message = 'There was an issue retrieving the latest data. Please check your connection and try again.',
  onRetry,
  className,
}) => {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className={cn('py-12 text-center text-xs sm:text-sm text-muted-fg', className)}
      >
        <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-[16px] bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-1 shadow-2xs">
            <AlertTriangle className="w-6 h-6 text-rose-600" aria-hidden="true" />
          </div>
          <p className="font-semibold text-focus text-sm sm:text-base">{title}</p>
          {message && (
            <p className="text-xs text-muted-fg leading-relaxed max-w-sm">{message}</p>
          )}
          {onRetry && (
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="gap-1.5 rounded-[10px]"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry</span>
              </Button>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

export default TableErrorState
