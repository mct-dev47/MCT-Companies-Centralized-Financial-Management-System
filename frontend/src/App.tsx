import * as React from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/routes'
import { SessionProvider } from '@/context/SessionContext'
import { CompanyProvider } from '@/context/CompanyContext'
import { Toaster } from '@/components/common/Toaster'

export default function App() {
  // Clear any stuck overflow locks left on document element or body
  React.useEffect(() => {
    if (document.documentElement.style.overflow === 'hidden') {
      document.documentElement.style.overflow = ''
    }
    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = ''
    }
  }, [])

  // Prevent accidental mouse wheel scrolling on number text fields globally
  React.useEffect(() => {
    const handleWheel = () => {
      if (
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === 'number'
      ) {
        document.activeElement.blur()
      }
    }
    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <SessionProvider>
      <CompanyProvider>
        <RouterProvider router={router} />
        <Toaster />
      </CompanyProvider>
    </SessionProvider>
  )
}
