import * as React from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { IconInput, type IconInputProps } from '@/components/auth/IconInput'
import { cn } from '@/lib/utils'

export interface PasswordInputProps extends Omit<IconInputProps, 'type' | 'trailingSlot'> {
  showLeadingLock?: boolean
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showLeadingLock = true, leadingIcon, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false)

    const togglePasswordVisibility = () => {
      setShowPassword((prev) => !prev)
    }

    return (
      <IconInput
        ref={ref}
        type={showPassword ? 'text' : 'password'}
        leadingIcon={
          leadingIcon !== undefined ? (
            leadingIcon
          ) : showLeadingLock ? (
            <Lock className="h-5 w-5" />
          ) : undefined
        }
        trailingSlot={
          <button
            type="button"
            onClick={togglePasswordVisibility}
            className="text-muted-fg hover:text-focus transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" />
            ) : (
              <Eye className="h-5 w-5" />
            )}
          </button>
        }
        className={cn(className)}
        {...props}
      />
    )
  }
)
PasswordInput.displayName = 'PasswordInput'

export { PasswordInput }
