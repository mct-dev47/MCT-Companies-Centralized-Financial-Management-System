import * as React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  getErrorPageConfig,
  type ErrorActionDefinition,
  type ErrorPageConfig,
  type ErrorVisualVariant,
} from '@/config/errorConfig'
import { ErrorBackgroundCircles } from './ErrorBackgroundCircles'
import { UnpluggedCableIllustration } from './UnpluggedCableIllustration'

export interface ErrorPageProps {
  /** HTTP Status Code or Error identifier (e.g., 404, 500, '404') */
  code?: number | string
  /** Override the default heading from config */
  title?: string
  /** Heading alias */
  heading?: string
  /** Override the default helper text from config */
  message?: string
  /** Helper text alias */
  helperText?: string
  /** Explicitly select 'code' (large number) or 'illustration' (unplugged cable) */
  variant?: ErrorVisualVariant
  /** Override or customize primary action */
  primaryAction?: ErrorActionDefinition | React.ReactNode
  /** Override or customize secondary action (pass null to hide) */
  secondaryAction?: ErrorActionDefinition | React.ReactNode | null
  /** Completely replace the actions container */
  actions?: React.ReactNode
  /** Additional container classes */
  className?: string
  /** Optional children rendered below helper text */
  children?: React.ReactNode
}

/**
 * Reusable Error Page System Component
 * 
 * Accurately implements the 404 mockup with soft maroon gradient spheres,
 * large status code / unplugged cable illustration, accessible typography,
 * pill action buttons, and responsive layout.
 */
export const ErrorPage: React.FC<ErrorPageProps> = ({
  code = 404,
  title,
  heading,
  message,
  helperText,
  variant,
  primaryAction,
  secondaryAction,
  actions,
  className = '',
  children,
}) => {
  const navigate = useNavigate()

  // Resolve config from config map
  const config: ErrorPageConfig = React.useMemo(() => {
    return getErrorPageConfig(code)
  }, [code])

  const resolvedCode = code || config.code
  const resolvedVariant = variant || config.variant
  const resolvedHeading = title || heading || config.heading
  const resolvedHelperText = message || helperText || config.helperText

  // Document title: "<code> – <heading>"
  React.useEffect(() => {
    const previousTitle = document.title
    document.title = `${resolvedCode} – ${resolvedHeading}`
    return () => {
      document.title = previousTitle
    }
  }, [resolvedCode, resolvedHeading])

  // Execute standard or custom actions
  const handleAction = (actionDef?: ErrorActionDefinition) => {
    if (!actionDef) return

    if (actionDef.onClick) {
      actionDef.onClick()
      return
    }

    const type = actionDef.action
    if (type === 'reload') {
      window.location.reload()
      return
    }

    if (type === 'back') {
      if (typeof window !== 'undefined' && window.history.length > 1) {
        navigate(-1)
      } else {
        navigate('/dashboard')
      }
      return
    }

    const target =
      actionDef.href ||
      (type === 'dashboard'
        ? '/dashboard'
        : type === 'login'
        ? '/login'
        : type === 'home'
        ? '/'
        : undefined)

    if (target) {
      navigate(target)
    }
  }

  const renderActionButton = (
    actionProp: ErrorActionDefinition | React.ReactNode | null | undefined,
    fallbackDef: ErrorActionDefinition | undefined,
    isPrimary: boolean
  ) => {
    if (actionProp === null) return null
    if (React.isValidElement(actionProp)) return actionProp

    const def = (actionProp as ErrorActionDefinition) || fallbackDef
    if (!def) return null

    const baseClasses =
      'h-12 min-h-[48px] px-8 rounded-full font-medium text-sm sm:text-base inline-flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8E0F00] focus-visible:ring-offset-2 select-none w-full sm:w-auto min-w-[160px] cursor-pointer'

    const variantClasses = isPrimary
      ? 'bg-[#8E0F00] hover:bg-[#780c00] active:bg-[#640a00] text-white shadow-sm'
      : 'border-2 border-[#8E0F00] text-[#8E0F00] hover:bg-[#8E0F00]/5 active:bg-[#8E0F00]/10'

    // If a direct href is defined and no custom onClick, render an accessible Link
    if (def.href && !def.onClick) {
      return (
        <Link
          to={def.href}
          className={`${baseClasses} ${variantClasses}`}
        >
          {def.label}
        </Link>
      )
    }

    return (
      <button
        type="button"
        onClick={() => handleAction(def)}
        className={`${baseClasses} ${variantClasses}`}
      >
        {def.label}
      </button>
    )
  }

  return (
    <main
      className={`relative min-h-screen w-full bg-white overflow-hidden flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans ${className}`}
      role="main"
      aria-labelledby="error-heading"
    >
      {/* Decorative gradient spheres matching the mockup */}
      <ErrorBackgroundCircles />

      {/* Main error content (centered, responsive, accessible) */}
      <div className="relative z-10 w-full max-w-xl mx-auto flex flex-col items-center text-center">
        {resolvedVariant === 'illustration' ? (
          <div className="flex flex-col items-center mb-4 sm:mb-6">
            <UnpluggedCableIllustration className="w-52 sm:w-64 md:w-72 h-auto mb-3" />
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold tracking-wider uppercase text-[#8E0F00] bg-[#8E0F00]/10 border border-[#8E0F00]/20 select-none">
              <span>Error {resolvedCode}</span>
            </div>
          </div>
        ) : (
          <div
            className="text-[100px] sm:text-[140px] md:text-[168px] font-[800] leading-none tracking-tight select-none text-[#8E0F00] mb-2 sm:mb-3"
            aria-hidden="true"
          >
            {resolvedCode}
          </div>
        )}

        {/* Single accessible <h1> heading */}
        <h1
          id="error-heading"
          className="text-2xl sm:text-[30px] font-semibold text-slate-900 tracking-tight leading-snug mb-3"
        >
          {resolvedHeading}
        </h1>

        {/* Helper text with WCAG AA compliant contrast (> 4.5:1) */}
        <p className="text-base text-slate-600 max-w-md mx-auto leading-relaxed mb-6 sm:mb-8">
          {resolvedHelperText}
        </p>

        {children}

        {/* Action Buttons: pill-shaped (rounded-full), 48px tall, stacked on mobile */}
        {actions ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto mt-2">
            {actions}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto mt-2">
            {renderActionButton(primaryAction, config.primaryAction, true)}
            {renderActionButton(secondaryAction, config.secondaryAction, false)}
          </div>
        )}
      </div>
    </main>
  )
}

export default ErrorPage
