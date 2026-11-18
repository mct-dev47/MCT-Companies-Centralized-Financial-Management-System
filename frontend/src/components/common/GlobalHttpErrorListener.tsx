import * as React from 'react'
import { useGlobalHttpError } from '@/services/httpErrorService'
import { ErrorPage } from '@/components/common/ErrorPage'

export interface GlobalHttpErrorListenerProps {
  children: React.ReactNode
}

/**
 * Global HTTP Error Listener
 *
 * Listens for fatal HTTP error events (401, 403, 500, 502, 503, 504).
 * When a fatal error occurs, it displays the matching ErrorPage.
 * When an error is non-fatal / inline, it leaves children mounted so
 * active forms and user input are not disrupted.
 */
export const GlobalHttpErrorListener: React.FC<GlobalHttpErrorListenerProps> = ({ children }) => {
  const { fatalError, clearFatalError } = useGlobalHttpError()

  if (fatalError) {
    return (
      <ErrorPage
        code={fatalError.status}
        primaryAction={{
          label: 'Try Again',
          action: 'reload',
          onClick: () => {
            clearFatalError()
            window.location.reload()
          },
        }}
        secondaryAction={{
          label: 'Back to Dashboard',
          action: 'dashboard',
          onClick: () => {
            clearFatalError()
          },
          href: '/dashboard',
        }}
      />
    )
  }

  return <>{children}</>
}

export default GlobalHttpErrorListener
