import { RouterProvider } from 'react-router-dom'
import { router } from '@/routes'
import { SessionProvider } from '@/context/SessionContext'
import { CompanyProvider } from '@/context/CompanyContext'
import { Toaster } from '@/components/common/Toaster'

export default function App() {
  return (
    <SessionProvider>
      <CompanyProvider>
        <RouterProvider router={router} />
        <Toaster />
      </CompanyProvider>
    </SessionProvider>
  )
}
