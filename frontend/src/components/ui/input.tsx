import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onWheel, ...props }, ref) => {
    return (
      <input
        type={type}
        onWheel={(e) => {
          if (type === 'number') {
            e.currentTarget.blur()
          }
          onWheel?.(e)
        }}
        className={cn(
          'flex h-10 w-full rounded-xl border border-stroke/50 bg-background px-3.5 py-2 text-xs sm:text-sm text-focus shadow-none transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium placeholder:text-muted-fg focus-visible:border-focus focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error aria-invalid:focus-visible:ring-error',
          type === 'number' &&
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
