import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { RequestStep } from '@/components/auth/recovery/RequestStep'
import { VerifyStep } from '@/components/auth/recovery/VerifyStep'
import { ResetStep } from '@/components/auth/recovery/ResetStep'
import { SuccessStep } from '@/components/auth/recovery/SuccessStep'

export type RecoveryStep = 'request' | 'verify' | 'reset' | 'success'

interface RecoveryDialogProps {
  open: boolean
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({ open }) => {
  const navigate = useNavigate()
  const [step, setStep] = React.useState<RecoveryStep>('request')
  const [email, setEmail] = React.useState<string>('')
  const [resetToken, setResetToken] = React.useState<string>('')

  // Clean up all state on close or reset
  const resetFlow = React.useCallback(() => {
    setStep('request')
    setEmail('')
    setResetToken('')
  }, [])

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetFlow()
      navigate('/login')
    }
  }

  const handleCodeSent = (submittedEmail: string) => {
    setEmail(submittedEmail)
    setStep('verify')
  }

  const handleVerified = (token: string) => {
    setResetToken(token)
    setStep('reset')
  }

  const handleResetComplete = () => {
    setStep('success')
  }

  const handleFinalLogin = () => {
    resetFlow()
    navigate('/login')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px] sm:max-w-[500px] rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl">
        {step === 'request' && <RequestStep onCodeSent={handleCodeSent} />}
        {step === 'verify' && (
          <VerifyStep email={email} onVerified={handleVerified} />
        )}
        {step === 'reset' && (
          <ResetStep
            resetToken={resetToken}
            onResetComplete={handleResetComplete}
          />
        )}
        {step === 'success' && <SuccessStep onLoginClick={handleFinalLogin} />}
      </DialogContent>
    </Dialog>
  )
}
