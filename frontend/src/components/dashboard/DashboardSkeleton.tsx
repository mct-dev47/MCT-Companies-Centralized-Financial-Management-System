import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { CardSkeleton } from '@/components/common/CardSkeleton'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { Table, TableHeader, TableRow, TableHead, TableBody } from '@/components/ui/table'

export interface DashboardSkeletonProps {
  isAdmin?: boolean
}

export const DashboardSkeleton: React.FC<DashboardSkeletonProps> = ({ isAdmin = false }) => {
  return (
    <div className="space-y-5 max-w-[1600px] mx-auto pb-8 animate-in fade-in duration-300">
      {/* 1. Welcome Banner Skeleton */}
      <div className="w-full bg-white rounded-[15px] border border-stroke/20 p-5 shadow-xs flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-52 rounded-md" />
          <Skeleton className="h-3.5 w-72 rounded-md" />
        </div>
        <Skeleton className="h-9 w-36 rounded-xl hidden sm:block" />
      </div>

      {/* 2. Header and Filters Skeleton (for non-admin) */}
      {!isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-48 rounded-md" />
            <Skeleton className="h-3.5 w-80 rounded-md" />
          </div>
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-10 w-44 rounded-xl" />
            <Skeleton className="h-10 w-52 rounded-xl" />
          </div>
        </div>
      )}

      {/* 3. KPI Cards Skeleton */}
      {isAdmin ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CardSkeleton inline={false} />
          <CardSkeleton inline={false} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <CardSkeleton inline={false} />
          <CardSkeleton inline={false} />
          <CardSkeleton inline={false} />
          <CardSkeleton inline={false} />
          <CardSkeleton inline={false} />
        </div>
      )}

      {/* 4. Non-admin Charts & Recent Transactions Table */}
      {!isAdmin && (
        <>
          {/* Profit / Loss Monthly Chart Skeleton */}
          <div className="bg-white rounded-[20px] border border-stroke/20 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-48 rounded-md" />
                <Skeleton className="h-3.5 w-64 rounded-md" />
              </div>
              <Skeleton className="h-8 w-28 rounded-xl" />
            </div>
            <Skeleton className="h-60 sm:h-72 w-full rounded-xl" />
          </div>

          {/* 2 Category Summary Charts Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-[20px] border border-stroke/20 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-40 rounded-md" />
                <Skeleton className="h-4 w-24 rounded-md" />
              </div>
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
            <div className="bg-white rounded-[20px] border border-stroke/20 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-40 rounded-md" />
                <Skeleton className="h-4 w-24 rounded-md" />
              </div>
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          </div>

          {/* Recent Transactions Table Skeleton */}
          <div className="bg-white rounded-[20px] border border-stroke/20 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-44 rounded-md" />
                <Skeleton className="h-3.5 w-64 rounded-md" />
              </div>
              <Skeleton className="h-8 w-28 rounded-xl" />
            </div>
            <div className="border border-slate-200/80 rounded-xl overflow-hidden">
              <Table className="w-full">
                <TableHeader className="bg-slate-50/70">
                  <TableRow>
                    <TableHead className="w-[12%]"><Skeleton className="h-3.5 w-16 rounded" /></TableHead>
                    <TableHead className="w-[18%]"><Skeleton className="h-3.5 w-24 rounded" /></TableHead>
                    <TableHead className="w-[20%]"><Skeleton className="h-3.5 w-28 rounded" /></TableHead>
                    <TableHead className="w-[15%]"><Skeleton className="h-3.5 w-20 rounded" /></TableHead>
                    <TableHead className="w-[15%]"><Skeleton className="h-3.5 w-20 rounded" /></TableHead>
                    <TableHead className="w-[10%] text-center"><Skeleton className="h-3.5 w-14 rounded mx-auto" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableSkeleton rows={5} columns={6} />
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
