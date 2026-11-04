import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-focus focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-white shadow-xs hover:bg-primary/90',
        secondary:
          'border-transparent bg-muted text-foreground hover:bg-muted/80',
        destructive:
          'border-transparent bg-destructive text-white shadow-xs hover:bg-destructive/90',
        outline: 'text-foreground border-stroke/40',
        expense: 'border-transparent bg-[#FEE2E2] text-primary font-medium',
        paid: 'border-transparent bg-[#DCFCE7] text-[#16A34A] font-medium',
        pending: 'border-transparent bg-[#FEF3C7] text-[#D97706] font-medium',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
