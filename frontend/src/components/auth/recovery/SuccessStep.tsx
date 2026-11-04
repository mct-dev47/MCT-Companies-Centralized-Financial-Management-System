import * as React from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface SuccessStepProps {
  onLoginClick: () => void
}

export const SuccessStep: React.FC<SuccessStepProps> = ({ onLoginClick }) => {
  return (
    <div className="space-y-6 text-center py-2">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 border border-red-100 text-[#960C01] shadow-xs">
        <Check className="h-8 w-8 stroke-[2.5]" aria-hidden="true" />
      </div>

      <DialogHeader className="text-center sm:text-center space-y-1">
        <DialogTitle className="text-2xl font-bold tracking-tight text-[#0B0F2B] text-center">
          Password changed successfully!
        </DialogTitle>
        <DialogDescription className="text-center text-sm text-gray-500">
          Your password has been securely updated. You can now log in with your
          new credentials.
        </DialogDescription>
      </DialogHeader>

      <div className="pt-2 w-full">
        <Button
          type="button"
          onClick={onLoginClick}
          className="w-full h-12 rounded-xl text-base font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs transition-colors"
        >
          Log In
        </Button>
      </div>
    </div>
  )
}
