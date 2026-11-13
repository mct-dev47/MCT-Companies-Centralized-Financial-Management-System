import * as React from 'react'
import { cn } from '@/lib/utils'

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => (
  <div className={cn('relative w-full overflow-x-auto overscroll-x-contain', containerClassName)}>
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-xs sm:text-sm border-collapse', className)}
      {...props}
    />
  </div>
))
Table.displayName = 'Table'

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }
>(({ className, sticky = true, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'border-b border-stroke/20 bg-surface/90 backdrop-blur-xs [&_tr]:border-b [&_tr]:border-stroke/20 [&_tr]:hover:bg-transparent',
      sticky && 'sticky top-0 z-10',
      className
    )}
    {...props}
  />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('divide-y divide-stroke/15 bg-white [&_tr:last-child]:border-0', className)}
    {...props}
  />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-stroke/20 bg-surface/60 font-medium [&>tr]:last:border-b-0',
      className
    )}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-stroke/15 transition-colors hover:bg-surface/50 data-[state=selected]:bg-primary/5',
      className
    )}
    {...props}
  />
))
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { alignRight?: boolean }
>(({ className, alignRight = false, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-11 px-3.5 py-2.5 align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-fg select-none whitespace-nowrap [&:has([role=checkbox])]:pr-0',
      alignRight ? 'text-right' : 'text-left',
      className
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('px-3.5 py-3 align-middle text-focus [&:has([role=checkbox])]:pr-0', className)}
    {...props}
  />
))
TableCell.displayName = 'TableCell'

/** TableCell specialized for Money and Numeric values: Right-aligned & Tabular Nums */
const TableCellNumeric = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-3.5 py-3 align-middle text-right tabular-nums font-mono text-focus',
      className
    )}
    {...props}
  />
))
TableCellNumeric.displayName = 'TableCellNumeric'

/** TableCell specialized for truncated text with optional title tooltip */
const TableCellText = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { maxWidth?: string }
>(({ className, maxWidth = 'max-w-[200px]', children, title, ...props }, ref) => {
  const textTitle = title || (typeof children === 'string' ? children : undefined)
  return (
    <td
      ref={ref}
      title={textTitle}
      className={cn('px-3.5 py-3 align-middle text-focus truncate', maxWidth, className)}
      {...props}
    >
      {children}
    </td>
  )
})
TableCellText.displayName = 'TableCellText'

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-xs text-muted-fg', className)}
    {...props}
  />
))
TableCaption.displayName = 'TableCaption'

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCellNumeric,
  TableCellText,
  TableCaption,
}
