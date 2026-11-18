import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ErrorPage } from '@/components/common/ErrorPage'
import { ERROR_PAGE_CONFIGS } from '@/config/errorConfig'

export interface ErrorPageRouteProps {
  code?: number | string
}

/**
 * Route-level Error Page
 *
 * Supports URL parameter `/error/:code` and query string `/error?code=...`.
 * Allows quick developer/tester switching between error states.
 */
export const ErrorPageRoute: React.FC<ErrorPageRouteProps> = ({ code: propCode }) => {
  const { code: paramCode } = useParams<{ code?: string }>()
  const [searchParams] = useSearchParams()
  const queryCode = searchParams.get('code')

  const resolvedCode = propCode || paramCode || queryCode || 404

  return <ErrorPage code={resolvedCode} />
}

export { ErrorPage }
export { ERROR_PAGE_CONFIGS }
export default ErrorPageRoute
