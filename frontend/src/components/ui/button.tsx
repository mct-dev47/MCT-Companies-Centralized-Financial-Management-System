import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Standard Button Component conforming to Phase 2 Design Standards:
 * - Control radius: 10px (rounded-[10px])
 * - Minimum interactive height: 44px (h-11) for default/icon outside dense spreadsheet cells
 * - Variants: Primary (primary fill), Secondary (white, 1px border), Destructive (red), Ghost/Link, Icon-only
 * - Standardized focus ring, hover, disabled and loading states (with spinner + double submit protection)
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-xs sm:text-sm font-semibold transition-all outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-white hover:bg-primary-hover active:bg-primary-active shadow-xs disabled:bg-primary/70',
        primary:
          'bg-primary text-white hover:bg-primary-hover active:bg-primary-active shadow-xs disabled:bg-primary/70',
        destructive:
          'bg-primary text-white hover:bg-primary-hover active:bg-primary-active shadow-xs focus-visible:ring-primary/40',
        outline:
          'border border-stroke/40 bg-white text-focus hover:bg-surface shadow-2xs',
        secondary:
          'border border-stroke/40 bg-white text-focus hover:bg-surface shadow-2xs',
        'outline-primary':
          'border border-primary text-primary bg-white hover:bg-primary/5',
        ghost:
          'hover:bg-surface text-focus shadow-none',
        link:
          'text-primary underline-offset-4 hover:underline shadow-none p-0 h-auto font-medium',
        'icon-only':
          'h-11 w-11 p-0 rounded-[10px] border border-stroke/40 bg-white text-focus hover:bg-surface shadow-2xs shrink-0',
      },
      size: {
        default: 'h-11 px-4 sm:px-5 py-2.5 min-h-[44px]',
        sm: 'h-9 px-3.5 py-1.5 text-xs rounded-[10px] min-h-[36px]',
        lg: 'h-12 px-6 py-3 text-sm sm:text-base min-h-[48px]',
        icon: 'h-11 w-11 p-0 min-h-[44px] min-w-[44px] shrink-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isLoading?: boolean
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    const isDisabled = disabled || isLoading

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
            <span>{loadingText || children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
