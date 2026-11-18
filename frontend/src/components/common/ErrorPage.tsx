import * as React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  LayoutDashboard,
  RefreshCw,
  LogIn,
  Home,
} from 'lucide-react'
import {
  getErrorPageConfig,
  type ErrorActionDefinition,
  type ErrorPageConfig,
  type ErrorVisualVariant,
} from '@/config/errorConfig'
import { ErrorBackgroundCircles } from './ErrorBackgroundCircles'
import { UnpluggedCableIllustration } from './UnpluggedCableIllustration'
import logo2Url from '@/assets/LOGO2.png'
import mct2Url from '@/assets/MCT2.png'

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
  /** Show MCT Brand Header Lockup (defaults to false for clean mockup fidelity) */
  showBrandHeader?: boolean
  /** Optional children rendered below helper text */
  children?: React.ReactNode
}

/**
 * Reusable Error Page System conforming to MCT OneUI design standards.
 *
 * Accurately implements the 404 mockup with authentic GradientCircles,
 * floating keyframe animations, mouse parallax tracking, refined typography,
 * and sleek pill-shaped action buttons.
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
  showBrandHeader = false,
  children,
}) => {
  const navigate = useNavigate()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [mouseOffset, setMouseOffset] = React.useState({ x: 0, y: 0 })

  // Parallax tracking matching Login BrandPanel
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    setMouseOffset({ x, y })
  }

  const handleMouseLeave = () => {
    setMouseOffset({ x: 0, y: 0 })
  }

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

  const getActionIcon = (def?: ErrorActionDefinition) => {
    if (!def) return null
    const type = def.action
    const label = def.label.toLowerCase()

    if (type === 'back' || (!label.includes('back to dashboard') && label.includes('back'))) {
      return <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
    }
    if (type === 'dashboard' || label.includes('dashboard')) {
      return <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
    }
    if (type === 'reload' || label.includes('again') || label.includes('reload')) {
      return <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
    }
    if (type === 'login' || label.includes('log in') || label.includes('sign in')) {
      return <LogIn className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
    }
    if (type === 'home' || label.includes('home')) {
      return <Home className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
    }
    return null
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

    const icon = getActionIcon(def)

    // Sleek, well-proportioned pill button (40-44px height, balanced padding, no bulky min-width)
    const baseClasses =
      'h-10 sm:h-11 px-5 sm:px-6 rounded-full font-medium text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-all select-none w-full sm:w-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2'

    const variantClasses = isPrimary
      ? 'bg-primary hover:bg-primary-hover active:bg-primary-active text-white shadow-xs'
      : 'border border-primary/80 hover:border-primary text-primary bg-white hover:bg-primary/5 active:bg-primary/10 shadow-2xs'

    if (def.href && !def.onClick) {
      return (
        <Link
          to={def.href}
          className={`${baseClasses} ${variantClasses}`}
        >
          {icon}
          <span>{def.label}</span>
        </Link>
      )
    }

    return (
      <button
        type="button"
        onClick={() => handleAction(def)}
        className={`${baseClasses} ${variantClasses}`}
      >
        {icon}
        <span>{def.label}</span>
      </button>
    )
  }

  return (
    <main
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`relative min-h-[100dvh] w-full bg-white overflow-hidden flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans ${className}`}
      role="main"
      aria-labelledby="error-heading"
    >
      {/* Optional Brand Header Lockup */}
      {showBrandHeader && (
        <header className="absolute top-6 left-6 sm:top-8 sm:left-10 z-20 flex items-center gap-3 select-none">
          <Link to="/dashboard" className="flex items-center gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg p-0.5">
            <img
              src={logo2Url}
              alt="MCT Logo"
              className="h-7 sm:h-8 w-auto object-contain shrink-0 group-hover:scale-105 transition-transform"
            />
            <div className="flex flex-col justify-center items-start">
              <img
                src={mct2Url}
                alt="MCT"
                className="h-3.5 sm:h-4 w-auto object-contain object-left block"
              />
              <span className="text-[9px] sm:text-[10px] font-semibold text-slate-500 tracking-wider uppercase mt-0.5 leading-tight">
                Group of Companies
              </span>
            </div>
          </Link>
        </header>
      )}

      {/* Decorative gradient spheres (Identical to Login / BrandPanel with parallax) */}
      <ErrorBackgroundCircles mouseOffset={mouseOffset} />

      {/* Main Error Content (Centered, clean, proportional) */}
      <div className="relative z-10 w-full max-w-lg mx-auto flex flex-col items-center text-center px-4">
        {resolvedVariant === 'illustration' ? (
          <div className="flex flex-col items-center mb-4 animate-in fade-in zoom-in-95 duration-300">
            {/* Standalone clean vector illustration directly on canvas */}
            <UnpluggedCableIllustration className="w-48 sm:w-60 md:w-68 h-auto mb-2" />
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wider uppercase text-primary bg-primary/8 border border-primary/15 select-none shadow-2xs">
              <span>Status {resolvedCode}</span>
            </div>
          </div>
        ) : (
          <div
            className="text-[100px] sm:text-[130px] md:text-[150px] font-[800] leading-none tracking-tight select-none text-primary mb-2 sm:mb-3 drop-shadow-xs animate-in fade-in zoom-in-95 duration-300"
            aria-hidden="true"
          >
            {resolvedCode}
          </div>
        )}

        {/* Single accessible <h1> heading */}
        <h1
          id="error-heading"
          className="text-xl sm:text-2xl md:text-[28px] font-bold text-focus tracking-tight leading-snug mb-2 sm:mb-2.5"
        >
          {resolvedHeading}
        </h1>

        {/* Helper text with WCAG AA compliant contrast (> 5.5:1) */}
        <p className="text-xs sm:text-sm md:text-[15px] text-slate-500 max-w-md mx-auto leading-relaxed mb-6 font-normal">
          {resolvedHelperText}
        </p>

        {children}

        {/* Action Buttons: sleek pill-shaped, refined size, stacked on mobile */}
        {actions ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 w-full sm:w-auto mt-1">
            {actions}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3 w-full sm:w-auto mt-1">
            {renderActionButton(primaryAction, config.primaryAction, true)}
            {renderActionButton(secondaryAction, config.secondaryAction, false)}
          </div>
        )}
      </div>
    </main>
  )
}

export default ErrorPage
