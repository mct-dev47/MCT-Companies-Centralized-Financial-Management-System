import { z } from 'zod'

export const requestResetSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
})

export type RequestResetFormValues = z.infer<typeof requestResetSchema>

export interface PasswordRules {
  minLength: boolean
  hasLetterAndNumber: boolean
}

export function validatePasswordRules(password: string): PasswordRules {
  return {
    minLength: password.length >= 8,
    hasLetterAndNumber: /[a-zA-Z]/.test(password) && /[0-9]/.test(password),
  }
}

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  })

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>
