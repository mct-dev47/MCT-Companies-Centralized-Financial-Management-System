import * as React from 'react'
import { SessionContext, type SessionContextValue } from '@/context/SessionContext'

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
