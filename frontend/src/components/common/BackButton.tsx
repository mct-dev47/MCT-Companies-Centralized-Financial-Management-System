import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BackButtonProps {
  /** Custom click handler (e.g. switch detail view back to list view). */
  onClick?: () => void
  /** Route to navigate to when clicked, or fallback route if browser history is empty. */
  to?: string
  /** Fallback route when using `navigate(-1)` and history is shallow. Defaults to '/dashboard'. */
  fallbackTo?: string
  /** Button label. Defaults to 'Back'. */
  label?: string
  className?: string
}

/**
 * Canonical BackButton component:
 * - Same icon (`ArrowLeft`), label, size, pill styling, and hover state everywhere.
 * - Supports either a state callback (`onClick`), direct route (`to`), or history back with fallback.
 */
export const BackButton: React.FC<BackButtonProps> = ({
  onClick,
  to,
  fallbackTo = '/dashboard',
  label = 'Back',
  className,
}) => {
  const navigate = useNavigate()

  const handleClick = () => {
    if (onClick) {
      onClick()
      return
    }
    if (to) {
      navigate(to)
      return
    }
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate(fallbackTo)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-stroke/50 bg-white hover:bg-surface text-focus text-xs font-semibold shadow-2xs transition-colors cursor-pointer select-none self-start',
        className
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-focus/80" />
      <span>{label}</span>
    </button>
  )
}

