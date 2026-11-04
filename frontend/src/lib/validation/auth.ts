import { z } from 'zod'

export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email or username is required')
    .transform((val) => (val.includes('@') ? val : `${val}@mct.com`))
    .pipe(z.string().email('Please enter a valid email address')),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false).optional(),
})

export type SignInFormValues = z.infer<typeof signInSchema>
