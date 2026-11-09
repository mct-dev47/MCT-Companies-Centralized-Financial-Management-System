import * as React from 'react'
import { Inbox } from 'lucide-react'
import { TableRow, TableCell } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface TableEmptyStateProps {
  colSpan: number
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: React.ReactNode
  message?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/**
 * Canonical empty state row for all tables.
 */
export const TableEmptyState: React.FC<TableEmptyStateProps> = ({
  colSpan,
  icon: Icon = Inbox,
  title,
  description,
  message,
  action,
  className,
}) => {
  const effectiveDescription = description ?? message
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className={cn('py-14 text-center text-xs sm:text-sm text-muted-fg', className)}
      >
        <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center text-muted-fg/70 mb-1">
            <Icon className="w-6 h-6" />
          </div>
          <p className="font-semibold text-focus text-sm sm:text-base">{title}</p>
          {effectiveDescription && (
            <p className="text-xs text-muted-fg leading-relaxed">{effectiveDescription}</p>
          )}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </TableCell>
    </TableRow>
  )
}

