import * as React from 'react'
import { BrandPanel } from '@/components/auth/BrandPanel'
import { CompanyLinks } from '@/components/auth/CompanyLinks'

interface AuthLayoutProps {
  children: React.ReactNode
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-[100dvh] w-full max-w-full flex flex-col md:grid md:grid-cols-2 bg-background overflow-x-hidden">
      {/* Left (Brand) Panel */}
      <BrandPanel />

      {/* Right (Form) Panel */}
      <div className="flex-1 flex flex-col justify-between min-h-0 md:min-h-[100dvh] bg-background px-[clamp(1rem,4vw,3rem)] py-[clamp(0.75rem,2.5vh,2.5rem)] overflow-x-hidden">
        {/* Top spacer to balance alignment */}
        <div className="hidden md:block h-4 lg:h-6" aria-hidden="true" />

        {/* Centered Form Area */}
        <main className="my-auto flex w-full flex-col items-center justify-center py-[clamp(0.25rem,1vh,1.5rem)]">
          {children}
        </main>

        {/* Pinned Company Links Footer */}
        <CompanyLinks />
      </div>
    </div>
  )
}
