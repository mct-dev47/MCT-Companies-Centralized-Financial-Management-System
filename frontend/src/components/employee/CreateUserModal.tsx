import * as React from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Check,
  UserPlus,
  Loader2,
  Upload,
  Crop,
  Building2,
  User as UserIcon,
  AlertTriangle,
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { ModalReviewStep } from '@/components/common/ModalReviewStep'
import { FormFieldError } from '@/components/common/FormFieldError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import {
  createUserSchema,
  type CreateUserFormValues,
} from '@/lib/validation/employee'
import {
  employeeService,
  type Company,
  type EmployeeUser,
} from '@/services/employeeService'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { formatUserFriendlyErrorMessage, notifyError } from '@/utils/errorUtils'
import { ImageCropperModal } from '@/components/common/ImageCropperModal'
import { cn } from '@/lib/utils'

interface CreateUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companies: Company[]
  onSuccess?: (user: EmployeeUser) => void
}

const ROLES = [
  'Finance',
  'Audit',
  'Supervisor',
  'Owner',
] as const


export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  open,
  onOpenChange,
  companies,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingValues, setPendingValues] = React.useState<CreateUserFormValues | null>(null)
  const [isReviewing, setIsReviewing] = React.useState(false)

  // Profile image upload state
  const [profilePreview, setProfilePreview] = React.useState<string | null>(null)
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [rawImageForCrop, setRawImageForCrop] = React.useState<string | null>(null)
  const [isCropperOpen, setIsCropperOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Multi-company selection state
  const [selectedCompanies, setSelectedCompanies] = React.useState<string[]>([])
  const [companyError, setCompanyError] = React.useState<string | null>(null)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  // Validation warning alert banner state
  const [validationWarning, setValidationWarning] = React.useState<{
    missingFields: string[]
  } | null>(null)

  // Scroll target refs for smooth scrolling to top of modal container
  const contentRef = React.useRef<HTMLDivElement>(null)
  const topRef = React.useRef<HTMLDivElement>(null)

  const scrollToTop = React.useCallback(() => {
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (topRef.current) {
        topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }, [])

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      fullName: '',
      email: '',
      assignedCompany: '',
      assignedCompanies: [],
      role: 'Supervisor',
      avatarUrl: '',
    },
  })

  // Watch full name to generate avatar initials preview
  const watchedName = form.watch('fullName')
  const initials = React.useMemo(() => {
    return watchedName
      .trim()
      .split(' ')
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }, [watchedName])

  const toggleCompany = (companyName: string) => {
    setSelectedCompanies((prev) => {
      const exists = prev.includes(companyName)
      const next = exists ? prev.filter((c) => c !== companyName) : [...prev, companyName]
      form.setValue('assignedCompanies', next, { shouldValidate: true })
      form.setValue('assignedCompany', next[0] || '')
      if (next.length > 0) {
        setCompanyError(null)
        form.clearErrors('assignedCompanies')
      }
      setValidationWarning(null)
      setSubmitError(null)
      return next
    })
  }

  const handleSelectAllCompanies = () => {
    const all = companies.map((c) => c.name)
    setSelectedCompanies(all)
    form.setValue('assignedCompanies', all, { shouldValidate: true })
    form.setValue('assignedCompany', all[0] || '')
    if (all.length > 0) {
      setCompanyError(null)
      form.clearErrors('assignedCompanies')
    }
    setValidationWarning(null)
  }

  const handleClearCompanies = () => {
    setSelectedCompanies([])
    form.setValue('assignedCompanies', [], { shouldValidate: true })
    form.setValue('assignedCompany', '')
    setValidationWarning(null)
  }

  // Handle image upload with FileReader preview & open cropper
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setAvatarFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        setRawImageForCrop(result)
        setIsCropperOpen(true)
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''

  }

  const handleCropComplete = (croppedDataUrl: string) => {
    setProfilePreview(croppedDataUrl)
    form.setValue('avatarUrl', croppedDataUrl)
    try {
      const arr = croppedDataUrl.split(',')
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
      const bstr = atob(arr[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
      }
      setAvatarFile(new File([u8arr], 'user-avatar.png', { type: mime }))
    } catch {
      // ignore
    }
  }

  const handleOpenCropper = () => {
    if (rawImageForCrop || profilePreview) {
      setIsCropperOpen(true)
    }
  }

  const handleRoleChange = (role: string) => {
    form.setValue('role', role)
  }

  const resetFormState = React.useCallback(() => {
    form.reset({
      fullName: '',
      email: '',
      assignedCompany: '',
      assignedCompanies: [],
      role: 'Supervisor',
      avatarUrl: '',
    })
    setProfilePreview(null)
    setAvatarFile(null)
    setRawImageForCrop(null)
    setIsCropperOpen(false)
    setSelectedCompanies([])
    setCompanyError(null)
    setValidationWarning(null)
    setSubmitError(null)
    setPendingValues(null)
    setIsReviewing(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [form])

  React.useEffect(() => {
    if (open) {
      resetFormState()
    }
  }, [open, resetFormState])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetFormState()
    }
    onOpenChange(nextOpen)
  }

  const collectMissingFields = (errors?: FieldErrors<CreateUserFormValues>): string[] => {
    const missing: string[] = []

    const nameVal = form.getValues('fullName')?.trim() || ''
    if (errors?.fullName || !nameVal || nameVal.length < 2) {
      missing.push('Full Name (minimum 2 characters)')
    }

    const emailVal = form.getValues('email')?.trim() || ''
    if (errors?.email || !emailVal || !emailVal.toLowerCase().endsWith('@gmail.com')) {
      missing.push('Email Address (valid @gmail.com format)')
    }

    const roleVal = form.getValues('role')
    if (errors?.role || !roleVal) {
      missing.push('Role')
    }

    if (selectedCompanies.length === 0 || errors?.assignedCompanies) {
      missing.push('Assigned Company (at least one company selection)')
    }

    return missing
  }

  const onInvalidSubmit = (errors: FieldErrors<CreateUserFormValues>) => {
    const missing = collectMissingFields(errors)
    if (selectedCompanies.length === 0) {
      setCompanyError('Please select at least one assigned company.')
    }
    if (missing.length > 0) {
      setValidationWarning({ missingFields: missing })
      scrollToTop()
    }
  }

  const onSubmit = (values: CreateUserFormValues) => {
    if (selectedCompanies.length === 0) {
      setCompanyError('Please select at least one assigned company.')
      setValidationWarning({
        missingFields: ['Assigned Company (at least one company selection)'],
      })
      scrollToTop()
      return
    }
    setCompanyError(null)
    setSubmitError(null)
    setValidationWarning(null)
    setPendingValues(values)
    setIsReviewing(true)
  }

  const handleConfirmCreate = async () => {
    if (!pendingValues) return
    try {
      setIsSubmitting(true)
      const resolvedCompanyIds = selectedCompanies
        .map((name) => {
          const comp = companies.find((c) => c.name === name || c.id === name || c.name.trim().toLowerCase() === name.trim().toLowerCase())
          return comp ? Number(comp.id) : null
        })
        .filter((id): id is number => id !== null && !isNaN(id))

      const created = await employeeService.createUser({
        fullName: pendingValues.fullName,
        email: pendingValues.email,
        assignedCompany: selectedCompanies[0] || '',
        assignedCompanies: selectedCompanies,
        companyIds: resolvedCompanyIds,
        role: pendingValues.role,
        // Single-use setup invitation generated on backend
        avatarFile: avatarFile || undefined,
      })
      if (!created.companyNames || created.companyNames.length < selectedCompanies.length) {
        created.companyNames = selectedCompanies
        created.companyName = selectedCompanies.join(', ')
      }
      onSuccess?.(created)
      resetFormState()
      setIsReviewing(false)
      onOpenChange(false)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to create user. Please try again.')
      setSubmitError(errorMsg)
      setIsReviewing(false)
      notifyError(error, 'Unable to create user. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          ref={contentRef}
          className="sm:max-w-[680px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl"
        >
          <div ref={topRef} />
          <DialogHeader className="text-left sm:text-left pb-3 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                  Create User
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
                  Register an employee and appoint them to a company
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Validation Warning Alert Banner */}
          {validationWarning && (
            <div
              role="alert"
              className="p-4 my-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm animate-in fade-in-0 duration-200 shadow-2xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-amber-950 text-sm">
                      Please complete all required fields
                    </p>
                    <p className="text-xs text-amber-800">
                      The following required fields must be completed before creating the user:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-900 font-medium pt-1">
                      {validationWarning.missingFields.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setValidationWarning(null)}
                  className="text-amber-600 hover:text-amber-800 p-1 rounded-lg hover:bg-amber-100/60 transition-colors cursor-pointer shrink-0"
                  aria-label="Dismiss warning"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {submitError && (
            <div className="p-3 my-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start justify-between gap-2">
              <span>{submitError}</span>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                className="text-red-500 hover:text-red-700 font-bold ml-auto cursor-pointer"
              >
                &times;
              </button>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={isReviewing ? (e) => { e.preventDefault(); handleConfirmCreate(); } : form.handleSubmit(onSubmit, onInvalidSubmit)} className="space-y-4 pt-2" autoComplete="off">
              {isReviewing ? (
                <ModalReviewStep
                  title="Review New User Account"
                  subtitle="Please verify the user credentials and permissions before creating."
                  errorMessage={submitError}
                  items={[
                    { label: 'Full Name', value: pendingValues?.fullName, highlight: true },
                    { label: 'Email', value: pendingValues?.email },
                    { label: 'Role', value: pendingValues?.role },
                    { label: 'Assigned Companies', value: selectedCompanies.join(', ') || 'All / None' },
                  ]}
                />
              ) : (
                <>
              {/* 1. Display Profile Image Upload */}
              <div className="flex flex-col items-center justify-center py-1">
                <div
                  onClick={() => {
                    if (profilePreview) {
                      handleOpenCropper()
                    } else {
                      fileInputRef.current?.click()
                    }
                  }}
                  className="relative group h-24 w-24 sm:h-28 sm:w-28 rounded-full border-2 border-dashed border-primary/50 hover:border-primary flex items-center justify-center p-1 bg-red-50/40 shadow-xs cursor-pointer transition-all overflow-hidden"
                  title={profilePreview ? 'Click to crop / adjust photo' : 'Click to upload display profile photo'}
                >
                  {profilePreview ? (
                    <img
                      src={profilePreview}
                      alt="Profile Preview"
                      className="h-full w-full object-cover rounded-full"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-primary">
                      {initials ? (
                        <span className="text-2xl font-bold tracking-tight">{initials}</span>
                      ) : (
                        <UserIcon className="h-10 w-10 text-primary/70" />
                      )}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white rounded-full">
                    <Crop className="h-5 w-5" />
                    <span className="text-[10px] font-semibold mt-1">Crop</span>
                  </div>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageFileChange}
                  accept="image/*"
                  className="hidden"
                />

                <div className="flex items-center gap-2 mt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold cursor-pointer"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Upload Photo
                  </Button>
                  {profilePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleOpenCropper}
                      className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold cursor-pointer flex items-center gap-1"
                    >
                      <Crop className="h-3 w-3 mr-1" />
                      Crop / Adjust
                    </Button>
                  )}
                  {profilePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setProfilePreview(null)
                        setRawImageForCrop(null)
                        form.setValue('avatarUrl', undefined)
                      }}
                      className="h-7 px-2 text-xs text-muted-fg hover:text-focus cursor-pointer"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>

              {/* 2. Full Name */}
              <FormField
                control={form.control}
                name="fullName"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label
                      htmlFor="create-full-name"
                      className={cn(
                        'text-xs sm:text-sm font-medium transition-colors',
                        fieldState.error ? 'text-red-600 font-semibold' : 'text-focus/90'
                      )}
                    >
                      Full Name <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <Input
                        id="create-full-name"
                        placeholder="e.g. John Doe"
                        autoComplete="off"
                        className={cn(
                          'h-11 rounded-xl border-[0.5px] text-sm focus-visible:ring-1 transition-colors',
                          fieldState.error
                            ? 'border-red-500 ring-1 ring-red-500 focus-visible:border-red-500 focus-visible:ring-red-500 bg-red-50/10'
                            : 'border-stroke/60 focus-visible:ring-focus'
                        )}
                        aria-invalid={!!fieldState.error}
                        {...field}
                        onChange={(e) => {
                          field.onChange(e)
                          setValidationWarning(null)
                        }}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-error font-medium" />
                  </FormItem>
                )}
              />

              {/* 3. Email Address */}
              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label
                      htmlFor="create-email-address"
                      className={cn(
                        'text-xs sm:text-sm font-medium transition-colors',
                        fieldState.error ? 'text-red-600 font-semibold' : 'text-focus/90'
                      )}
                    >
                      Email Address <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <Input
                        id="create-email-address"
                        type="email"
                        placeholder="e.g. john.doe@gmail.com"
                        autoComplete="off"
                        className={cn(
                          'h-11 rounded-xl border-[0.5px] text-sm focus-visible:ring-1 transition-colors',
                          fieldState.error
                            ? 'border-red-500 ring-1 ring-red-500 focus-visible:border-red-500 focus-visible:ring-red-500 bg-red-50/10'
                            : 'border-stroke/60 focus-visible:ring-focus'
                        )}
                        aria-invalid={!!fieldState.error}
                        {...field}
                        onChange={(e) => {
                          field.onChange(e)
                          setValidationWarning(null)
                        }}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-error font-medium" />
                  </FormItem>
                )}
              />

              {/* 4. Role Selection */}
              <FormField
                control={form.control}
                name="role"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label
                      htmlFor="create-user-role"
                      className={cn(
                        'text-xs sm:text-sm font-medium transition-colors',
                        fieldState.error ? 'text-red-600 font-semibold' : 'text-focus/90'
                      )}
                    >
                      Role <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <div className="relative">
                        <Dropdown
                          id="create-user-role"
                          value={field.value}
                          onChange={(val) => {
                            handleRoleChange(String(val))
                            setValidationWarning(null)
                          }}
                          options={ROLES.map((role) => ({ value: role, label: role }))}
                          aria-label="User Role"
                          error={fieldState.error?.message}
                        />
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-fg">
                          <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs text-error font-medium" />
                  </FormItem>
                )}
              />

              {/* 5. Company Assigned - Multi-Select Checkbox Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label
                      className={cn(
                        'text-xs sm:text-sm font-medium transition-colors',
                        companyError ? 'text-red-600 font-semibold' : 'text-focus/90'
                      )}
                    >
                      Company Assigned <span className="text-red-500">*</span>
                    </Label>
                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-full transition-colors',
                        selectedCompanies.length > 0
                          ? 'bg-red-100/70 text-primary'
                          : companyError
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : 'bg-slate-100 text-muted-fg'
                      )}
                    >
                      {selectedCompanies.length === 0
                        ? 'None selected'
                        : `${selectedCompanies.length} selected`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={handleSelectAllCompanies}
                      className="text-primary hover:underline font-medium text-[11px] cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleClearCompanies}
                      className="text-muted-fg hover:text-focus text-[11px] cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div
                  className={cn(
                    'max-h-48 overflow-y-auto pr-1 space-y-2 rounded-xl border p-2.5 transition-colors',
                    companyError
                      ? 'border-red-500 ring-1 ring-red-500 bg-red-50/20'
                      : 'border-stroke/40 bg-slate-50/50'
                  )}
                >
                  {companies.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-fg">No companies available</div>
                  ) : (
                    companies.map((comp) => {
                      const isSelected = selectedCompanies.includes(comp.name)
                      return (
                        <div
                          key={comp.id}
                          onClick={() => toggleCompany(comp.name)}
                          className={cn(
                            'flex items-center justify-between p-2.5 rounded-xl border text-sm font-medium transition-all cursor-pointer select-none',
                            isSelected
                              ? 'border-[#960C01] bg-red-50/70 text-focus shadow-2xs ring-1 ring-[#960C01]'
                              : 'border-stroke/50 bg-white hover:bg-slate-100/70 text-focus/80'
                          )}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              toggleCompany(comp.name)
                            }
                          }}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <div
                              className={cn(
                                'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                isSelected ? 'border-[#960C01] bg-[#960C01]' : 'border-slate-300 bg-white'
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3 text-white stroke-[3]" />}
                            </div>
                            <div className="flex items-center gap-2 truncate">
                              <Building2
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  isSelected ? 'text-primary' : 'text-muted-fg'
                                )}
                              />
                              <span className="text-xs sm:text-sm font-semibold truncate">
                                {comp.name}
                              </span>
                            </div>
                          </div>

                          {isSelected && (
                            <span className="text-[10px] font-bold text-primary uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100/70 shrink-0">
                              Selected
                            </span>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
                <FormFieldError error={companyError} />
              </div>

                </>
              )}

              {/* Action buttons - Standard Phase 2 Layout */}
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-stroke/20">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (isReviewing) {
                      setIsReviewing(false)
                    } else {
                      onOpenChange(false)
                    }
                  }}
                  disabled={isSubmitting}
                  className="h-11 px-5 rounded-[10px] text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  {isReviewing ? 'Back to Edit' : 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting}
                  isLoading={isSubmitting}
                  className="h-11 px-6 rounded-[10px] text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  <span>{isReviewing ? 'Create User' : 'Review User'}</span>
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Image Cropper Modal */}
      <ImageCropperModal
        open={isCropperOpen}
        onOpenChange={setIsCropperOpen}
        imageSrc={rawImageForCrop || profilePreview}
        onCropComplete={handleCropComplete}
        title="Crop Profile Photo"
      />
    </>
  )
}
