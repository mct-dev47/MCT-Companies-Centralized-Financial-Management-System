import * as React from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'
import { cn } from '@/lib/utils'

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      'flex items-center gap-1.5 sm:gap-2.5 md:gap-3 has-[:disabled]:opacity-50 justify-center outline-none focus:outline-none max-w-full overflow-x-hidden',
      containerClassName
    )}
    className={cn('disabled:cursor-not-allowed outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0', className)}
    {...props}
  />
))
InputOTP.displayName = 'InputOTP'

const InputOTPGroup = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-1.5 sm:gap-2.5 md:gap-3', className)} {...props} />
))
InputOTPGroup.displayName = 'InputOTPGroup'

const InputOTPSlot = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'> & { index: number; isError?: boolean }
>(({ index, className, isError, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex h-10 w-10 sm:h-12 sm:w-12 md:h-14 md:w-14 items-center justify-center rounded-lg border border-slate-200 bg-background text-lg sm:text-xl md:text-2xl font-bold text-focus transition-all outline-none',
        isActive && 'border-[#960C01] ring-2 ring-[#960C01]/20',
        isError && 'border-error text-error ring-1 ring-error',
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-caret-blink bg-focus duration-1000" />
        </div>
      )}
    </div>
  )
})
InputOTPSlot.displayName = 'InputOTPSlot'

const InputOTPSeparator = React.forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    -
  </div>
))
InputOTPSeparator.displayName = 'InputOTPSeparator'

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
