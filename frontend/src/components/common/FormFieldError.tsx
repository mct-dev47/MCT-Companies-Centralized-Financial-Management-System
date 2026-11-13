import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FormFieldErrorProps {
  id?: string
  error?: string | null | React.ReactNode
  className?: string
}

/**
 * Standard FormFieldError component conforming to Phase 2 Section G:
 * - Inline under field
 * - Red text with alert icon
 * - Accessible aria role="alert"
 */
export const FormFieldError: React.FC<FormFieldErrorProps> = ({
  id,
  error,
  className,
}) => {
  if (!error) return null

  return (
    <p
      id={id}
      role="alert"
      className={cn(
        'flex items-center gap-1.5 text-xs font-normal text-rose-600 mt-1 animate-in fade-in',
        className
      )}
    >
      <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </p>
  )
}

export default FormFieldError
