import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface CardSkeletonProps {
  /** Render only the inner value + subtitle placeholders inside an existing KPI card */
  inline?: boolean
  className?: string
}

/**
 * Canonical KPI / Summary Card skeleton.
 * Use `inline` inside an existing `<Card>` header/title layout, or standalone to render the full card shell.
 */
export const CardSkeleton: React.FC<CardSkeletonProps> = ({
  inline = true,
  className,
}) => {
  if (inline) {
    return (
      <div className={cn('space-y-1.5 mt-2', className)}>
        <Skeleton className="h-7 w-36 rounded-md" />
        <Skeleton className="h-3.5 w-52 rounded-md" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between',
        className
      )}
    >
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-24 rounded-md" />
        <Skeleton className="h-7 w-36 rounded-md" />
        <Skeleton className="h-3 w-48 rounded-md" />
      </div>
      <Skeleton className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl shrink-0" />
    </div>
  )
}

