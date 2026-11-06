import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Check,
  UserPlus,
  Loader2,
  Upload,
  Crop,
  Building2,
  User as UserIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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

const formatCompanyList = (names: string[]): string => {
  if (!names || names.length === 0) return 'no company'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}


export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  open,
  onOpenChange,
  companies,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [pendingValues, setPendingValues] = React.useState<CreateUserFormValues | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false)

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
      form.setValue('assignedCompanies', next)
      form.setValue('assignedCompany', next[0] || '')
      if (next.length > 0) setCompanyError(null)
      setSubmitError(null)
      return next
    })
  }

  const handleSelectAllCompanies = () => {
    const all = companies.map((c) => c.name)
    setSelectedCompanies(all)
    form.setValue('assignedCompanies', all)
    form.setValue('assignedCompany', all[0] || '')
    if (all.length > 0) setCompanyError(null)
  }

  const handleClearCompanies = () => {
    setSelectedCompanies([])
    form.setValue('assignedCompanies', [])
    form.setValue('assignedCompany', '')
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
    setSubmitError(null)
    setPendingValues(null)
    setIsConfirmOpen(false)
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

  const onSubmit = (values: CreateUserFormValues) => {
    if (selectedCompanies.length === 0) {
      setCompanyError('Please select at least one assigned company.')
      return
    }
    setCompanyError(null)
    setSubmitError(null)
    setPendingValues(values)
    setIsConfirmOpen(true)
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
      setIsConfirmOpen(false)
      onOpenChange(false)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to create user. Please try again.')
      setSubmitError(errorMsg)
      setIsConfirmOpen(false)
      notifyError(error, 'Unable to create user. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[680px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left sm:text-left space-y-1">
            <DialogTitle className="text-xl sm:text-2xl font-bold text-focus">
              Create User
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-fg font-normal">
              Register an employee and appoint them to a company
            </DialogDescription>
          </DialogHeader>

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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2" autoComplete="off">
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
                    <Label htmlFor="create-full-name" className="text-xs sm:text-sm font-medium text-focus/90">
                      Full Name <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <Input
                        id="create-full-name"
                        placeholder="e.g. John Doe"
                        autoComplete="off"
                        className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                        aria-invalid={!!fieldState.error}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-error" />
                  </FormItem>
                )}
              />

              {/* 3. Email Address */}
              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label htmlFor="create-email-address" className="text-xs sm:text-sm font-medium text-focus/90">
                      Email Address <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <Input
                        id="create-email-address"
                        type="email"
                        placeholder="e.g. john.doe@example.com"
                        autoComplete="off"
                        className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                        aria-invalid={!!fieldState.error}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-error" />
                  </FormItem>
                )}
              />

              {/* 4. Role Selection */}
              <FormField
                control={form.control}
                name="role"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label htmlFor="create-user-role" className="text-xs sm:text-sm font-medium text-focus/90">
                      Role <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <div className="relative">
                        <select
                          id="create-user-role"
                          value={field.value}
                          onChange={(e) => handleRoleChange(e.target.value)}
                          className="flex h-11 w-full rounded-xl border-[0.5px] border-stroke/60 bg-background px-3.5 py-2.5 text-sm text-focus shadow-none transition-colors appearance-none focus-visible:border-focus focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus cursor-pointer"
                          aria-invalid={!!fieldState.error}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
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
                    <FormMessage className="text-xs text-error" />
                  </FormItem>
                )}
              />

              {/* 5. Company Assigned - Multi-Select Checkbox Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs sm:text-sm font-medium text-focus/90">
                      Company Assigned <span className="text-red-500">*</span>
                    </Label>
                    <span
                      className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-full transition-colors',
                        selectedCompanies.length > 0
                          ? 'bg-red-100/70 text-primary'
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

                <div className="max-h-48 overflow-y-auto pr-1 space-y-2 rounded-xl border border-stroke/40 p-2.5 bg-slate-50/50">
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
                {companyError && (
                  <p className="text-xs text-red-600 font-medium pt-1 animate-in fade-in-50">
                    {companyError}
                  </p>
                )}
              </div>



              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                  className="h-11 px-7 rounded-xl border border-stroke/50 text-focus hover:bg-surface font-medium text-sm transition-colors cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-11 px-6 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Creating…</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      <span>Create User</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal */}
      <ConfirmationDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Confirm User Creation"
        description={
          <span className="block space-y-2.5">
            <span>
              Are you sure you want to add{' '}
              <strong className="text-focus">{pendingValues?.fullName}</strong>{' '}
              appointed to{' '}
              as{' '}
              <strong className="text-focus">{pendingValues?.role}</strong>?
            </span>
            {selectedCompanies.length > 0 && (
              <span className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {selectedCompanies.map((cName) => (
                  <span
                    key={cName}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-focus border border-slate-200/80 shadow-2xs"
                  >
                    <Building2 className="h-3 w-3 text-muted-fg shrink-0" />
                    <span>{cName}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        }
        confirmLabel="Yes, Create User"
        actionType="add"
        variant="primary"
        isLoading={isSubmitting}
        onConfirm={handleConfirmCreate}
      />

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
