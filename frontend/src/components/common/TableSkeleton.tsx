import * as React from 'react'
import { TableRow, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface TableSkeletonColumn {
  width?: string
  align?: 'left' | 'center' | 'right'
  shape?: 'text' | 'pill' | 'button' | 'avatar-text'
}

export interface TableSkeletonProps {
  columns: number | TableSkeletonColumn[]
  rows?: number
  className?: string
}

const DEFAULT_WIDTHS = ['w-20', 'w-28', 'w-24', 'w-36', 'w-20', 'w-16', 'w-20', 'w-14']

/**
 * Canonical TableSkeleton component used across all tables during loading.
 * Renders `rows` animated skeleton rows matching the table column count and shapes.
 */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  columns,
  rows = 5,
  className,
}) => {
  const colSpecs: TableSkeletonColumn[] = React.useMemo(() => {
    if (typeof columns === 'number') {
      return Array.from({ length: columns }, (_, idx) => ({
        width: DEFAULT_WIDTHS[idx % DEFAULT_WIDTHS.length],
        align: idx === columns - 1 ? 'center' : 'left',
        shape: idx === columns - 1 ? 'button' : 'text',
      }))
    }
    return columns
  }, [columns])

  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <TableRow key={rowIdx} className={cn('border-b border-slate-100 hover:bg-transparent', className)}>
          {colSpecs.map((col, colIdx) => {
            const alignClass =
              col.align === 'right'
                ? 'text-right'
                : col.align === 'center'
                  ? 'text-center'
                  : 'text-left'
            const autoMargin =
              col.align === 'right'
                ? 'ml-auto'
                : col.align === 'center'
                  ? 'mx-auto'
                  : ''

            return (
              <TableCell key={colIdx} className={cn('px-3.5 py-4', alignClass)}>
                {col.shape === 'avatar-text' ? (
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="w-8 h-8 rounded-xl shrink-0" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-28 rounded-md" />
                      <Skeleton className="h-3 w-36 rounded-md" />
                    </div>
                  </div>
                ) : col.shape === 'pill' ? (
                  <Skeleton
                    className={cn(
                      'h-5 rounded-full',
                      col.width || 'w-20',
                      autoMargin
                    )}
                  />
                ) : col.shape === 'button' ? (
                  <Skeleton
                    className={cn(
                      'h-7 rounded-lg',
                      col.width || 'w-14',
                      autoMargin
                    )}
                  />
                ) : (
                  <Skeleton
                    className={cn(
                      'h-4 rounded-md',
                      col.width || DEFAULT_WIDTHS[colIdx % DEFAULT_WIDTHS.length],
                      autoMargin
                    )}
                  />
                )}
              </TableCell>
            )
          })}
        </TableRow>
      ))}
    </>
  )
}

