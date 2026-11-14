import { z } from '@/lib/validation/zod'

export const createUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must not exceed 100 characters')
    .regex(/^[\p{L}\s.'-]+$/u, 'Full name contains invalid characters'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .regex(/^[a-zA-Z0-9._%+-]+@gmail\.com$/i, 'Only @gmail.com email addresses are allowed'),
  assignedCompany: z.string().optional(),
  assignedCompanies: z.array(z.string()).min(1, 'Please select at least one company'),
  role: z.string().min(1, 'Role is required'),
  avatarUrl: z.string().optional(),
})

export type CreateUserFormValues = z.infer<typeof createUserSchema>

export const createCompanySchema = z.object({
  name: z.string().trim().min(1, 'Company name is required'),
  address: z.string().trim().min(1, 'Address is required'),
  contactNumber: z
    .string()
    .trim()
    .min(1, 'Contact number is required')
    .regex(/^09\d{9}$/, 'Contact number must be exactly 11 digits starting with 09'),
  telephoneNumber: z
    .string()
    .trim()
    .refine((val) => !val || /^\d{8}$/.test(val), {
      message: 'Telephone number must be exactly 8 digits',
    })
    .optional(),
  startingBalance: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? 0 : val),
    z.coerce
      .number({
        invalid_type_error: 'Starting balance must be a valid number',
      })
      .min(0, 'Starting balance must be 0 or greater')
      .default(0)
  ),
  pettyCash: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? 0 : val),
    z.coerce
      .number({
        invalid_type_error: 'Petty cash must be a valid number',
      })
      .min(0, 'Petty cash must be 0 or greater')
      .default(0)
  ),
  logoUrl: z.string().optional(),
  // Optional legacy fields for backward compatibility
  email: z.string().trim().optional(),
  contactPerson: z.string().trim().optional(),
  contactPersonEmail: z.string().trim().optional(),
  currentBalance: z.number().min(0).optional(),
})

export type CreateCompanyFormValues = z.infer<typeof createCompanySchema>
