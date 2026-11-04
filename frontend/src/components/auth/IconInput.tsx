import * as React from 'react'
import { cn } from '@/lib/utils'

export interface IconInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: React.ReactNode
  trailingSlot?: React.ReactNode
  error?: boolean
}

const IconInput = React.forwardRef<HTMLInputElement, IconInputProps>(
  ({ className, leadingIcon, trailingSlot, error, ...props }, ref) => {
    return (
      <div className="relative flex w-full items-center">
        {leadingIcon && (
          <div className="pointer-events-none absolute left-3.5 sm:left-4 flex items-center justify-center text-muted-fg peer-focus:text-focus transition-colors">
            {leadingIcon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'peer flex h-11 sm:h-12 md:h-14 w-full rounded-lg border-[0.5px] border-stroke/50 bg-background px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base text-focus shadow-none transition-colors placeholder:text-muted-fg focus-visible:border-focus focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
            leadingIcon && 'pl-10 sm:pl-11 md:pl-12',
            trailingSlot && 'pr-10 sm:pr-11 md:pr-12',
            error && 'border-error text-focus focus-visible:ring-error',
            className
          )}
          aria-invalid={error || props['aria-invalid']}
          {...props}
        />
        {trailingSlot && (
          <div className="absolute right-3.5 sm:right-4 flex items-center justify-center">
            {trailingSlot}
          </div>
        )}
      </div>
    )
  }
)
IconInput.displayName = 'IconInput'

export { IconInput }
