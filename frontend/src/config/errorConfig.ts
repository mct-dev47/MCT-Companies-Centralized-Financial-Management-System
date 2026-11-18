/**
 * Centralized Error Page Configuration
 * 
 * Drives all error codes from a single config map to ensure consistency,
 * strict adherence to design specifications, and easy extensibility.
 */

export type ErrorVisualVariant = 'code' | 'illustration'

export type StandardErrorAction =
  | 'dashboard'
  | 'back'
  | 'reload'
  | 'login'
  | 'home'

export interface ErrorActionDefinition {
  label: string
  action?: StandardErrorAction
  onClick?: () => void
  href?: string
}

export interface ErrorPageConfig {
  code: number | string
  variant: ErrorVisualVariant
  heading: string
  helperText: string
  primaryAction: ErrorActionDefinition
  secondaryAction?: ErrorActionDefinition
}

export const ERROR_PAGE_CONFIGS: Record<number | string, ErrorPageConfig> = {
  400: {
    code: 400,
    variant: 'code',
    heading: 'Bad request',
    helperText: 'The request could not be understood. Please check and try again.',
    primaryAction: {
      label: 'Go Back',
      action: 'back',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
  401: {
    code: 401,
    variant: 'code',
    heading: 'Session expired',
    helperText: 'Please log in again to continue.',
    primaryAction: {
      label: 'Log In',
      action: 'login',
      href: '/login',
    },
    secondaryAction: {
      label: 'Back to Home',
      action: 'home',
      href: '/',
    },
  },
  403: {
    code: 403,
    variant: 'code',
    heading: 'Access denied',
    helperText:
      "You don't have permission to view this page. Contact your administrator if you think this is a mistake.",
    primaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
    secondaryAction: {
      label: 'Go Back',
      action: 'back',
    },
  },
  404: {
    code: 404,
    variant: 'code',
    heading: 'Page not found',
    helperText:
      "The page you are looking for doesn't exist or another error occurred.",
    primaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
    secondaryAction: {
      label: 'Go Back',
      action: 'back',
    },
  },
  408: {
    code: 408,
    variant: 'illustration',
    heading: 'Request timed out',
    helperText: 'The server took too long to respond. Please try again.',
    primaryAction: {
      label: 'Try Again',
      action: 'reload',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
  429: {
    code: 429,
    variant: 'code',
    heading: 'Too many requests',
    helperText:
      "You've made too many requests. Please wait a moment and try again.",
    primaryAction: {
      label: 'Try Again',
      action: 'reload',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
  500: {
    code: 500,
    variant: 'illustration',
    heading: 'Something went wrong',
    helperText:
      'An unexpected error occurred on our end. Please try again shortly.',
    primaryAction: {
      label: 'Try Again',
      action: 'reload',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
  502: {
    code: 502,
    variant: 'illustration',
    heading: 'Bad gateway',
    helperText:
      "We're having trouble reaching the server. Please try again in a moment.",
    primaryAction: {
      label: 'Try Again',
      action: 'reload',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
  503: {
    code: 503,
    variant: 'illustration',
    heading: 'Service unavailable',
    helperText:
      'The system is temporarily down for maintenance or high traffic. Please try again soon.',
    primaryAction: {
      label: 'Try Again',
      action: 'reload',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
  504: {
    code: 504,
    variant: 'illustration',
    heading: 'Gateway timeout',
    helperText: 'The server took too long to respond. Please try again.',
    primaryAction: {
      label: 'Try Again',
      action: 'reload',
    },
    secondaryAction: {
      label: 'Back to Dashboard',
      action: 'dashboard',
      href: '/dashboard',
    },
  },
}

/** Fallback for any unknown error code */
export const DEFAULT_ERROR_CONFIG: ErrorPageConfig = {
  code: 500,
  variant: 'illustration',
  heading: 'Something went wrong',
  helperText:
    'An unexpected error occurred on our end. Please try again shortly.',
  primaryAction: {
    label: 'Try Again',
    action: 'reload',
  },
  secondaryAction: {
    label: 'Back to Dashboard',
    action: 'dashboard',
    href: '/dashboard',
  },
}

/**
 * Retrieve configuration for a status code, falling back gracefully
 * to DEFAULT_ERROR_CONFIG if code is unrecognized.
 */
export function getErrorPageConfig(code?: number | string): ErrorPageConfig {
  if (!code) return DEFAULT_ERROR_CONFIG

  const numericCode = typeof code === 'string' ? parseInt(code, 10) : code
  if (numericCode && ERROR_PAGE_CONFIGS[numericCode]) {
    return ERROR_PAGE_CONFIGS[numericCode]
  }

  if (ERROR_PAGE_CONFIGS[code]) {
    return ERROR_PAGE_CONFIGS[code]
  }

  return {
    ...DEFAULT_ERROR_CONFIG,
    code,
  }
}
