import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-base font-semibold transition-all outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        default:
          'bg-[#960C01] text-white hover:bg-[#800a01] active:bg-[#700801] disabled:bg-[#960C01]/75 disabled:opacity-75',
        destructive: 'bg-error text-white hover:brightness-95',
        outline:
          'border border-stroke/50 bg-background hover:bg-surface text-focus',
        'outline-primary':
          'border border-[#960C01] text-[#960C01] bg-background hover:bg-[#960C01]/5',
        secondary: 'bg-surface text-focus hover:bg-surface/80',
        ghost: 'hover:bg-surface text-focus',
        link: 'text-[#960C01] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-12 px-6 py-3',
        sm: 'h-10 rounded-lg px-4 text-sm',
        lg: 'h-14 rounded-lg px-8 text-lg',
        icon: 'h-12 w-12',
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
