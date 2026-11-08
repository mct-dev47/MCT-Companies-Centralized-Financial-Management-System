import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-xs sm:text-sm font-semibold transition-all outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-white hover:bg-primary-hover active:bg-primary-active shadow-xs disabled:bg-primary/75',
        destructive:
          'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-xs',
        outline:
          'border border-stroke/50 bg-background hover:bg-surface text-focus shadow-2xs',
        'outline-primary':
          'border border-primary text-primary bg-background hover:bg-primary/5',
        secondary: 'bg-surface text-focus hover:bg-surface/80',
        ghost: 'hover:bg-surface text-focus',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 sm:h-11 px-4 sm:px-5 py-2.5 rounded-xl',
        sm: 'h-9 rounded-xl px-3.5 text-xs',
        lg: 'h-12 rounded-xl px-6 text-sm sm:text-base',
        icon: 'h-9 w-9 rounded-xl p-0',
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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
