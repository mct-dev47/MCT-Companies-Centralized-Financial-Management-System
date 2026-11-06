import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Building2,
  Loader2,
  Camera,
  Upload,
  Crop,
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
  createCompanySchema,
  type CreateCompanyFormValues,
} from '@/lib/validation/employee'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { ImageCropperModal } from '@/components/common/ImageCropperModal'
import { employeeService, type Company } from '@/services/employeeService'
import { formatUserFriendlyErrorMessage, notifyError } from '@/utils/errorUtils'
import { sanitizeNumericInput } from '@/utils/numericInputUtils'
import logo2Url from '@/assets/LOGO2.png'

interface CreateCompanyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (company: Company) => void
}

export const CreateCompanyModal: React.FC<CreateCompanyModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [profilePreview, setProfilePreview] = React.useState<string | null>(null)
  const [profileFile, setProfileFile] = React.useState<File | null>(null)
  const [rawImageForCrop, setRawImageForCrop] = React.useState<string | null>(null)
  const [isCropperOpen, setIsCropperOpen] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const form = useForm<CreateCompanyFormValues>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: {
      name: '',
      address: '',
      contactNumber: '09',
      telephoneNumber: '',
      startingBalance: '' as unknown as number,
      pettyCash: '' as unknown as number,
      logoUrl: '',
    },
  })

  const [pendingValues, setPendingValues] = React.useState<CreateCompanyFormValues | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false)

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
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

  const handleCropComplete = (croppedDataUrl: string, croppedFile: File) => {
    setProfilePreview(croppedDataUrl)
    setProfileFile(croppedFile)
    form.setValue('logoUrl', croppedDataUrl)
  }

  const handleOpenCropper = () => {
    if (rawImageForCrop || profilePreview) {
      setIsCropperOpen(true)
    }
  }

  const resetFormState = React.useCallback(() => {
    form.reset({
      name: '',
      address: '',
      contactNumber: '09',
      telephoneNumber: '',
      startingBalance: '' as unknown as number,
      pettyCash: '' as unknown as number,
      logoUrl: '',
    })
    setProfilePreview(null)
    setProfileFile(null)
    setRawImageForCrop(null)
    setIsCropperOpen(false)
    setPendingValues(null)
    setIsConfirmOpen(false)
    setSubmitError(null)
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

  const onSubmit = (values: CreateCompanyFormValues) => {
    setSubmitError(null)
    setPendingValues(values)
    setIsConfirmOpen(true)
  }

  const handleConfirmCreate = async () => {
    if (!pendingValues) return
    try {
      setIsSubmitting(true)
      const created = await employeeService.createCompany({
        name: pendingValues.name,
        address: pendingValues.address,
        contactNumber: pendingValues.contactNumber,
        telephoneNumber: pendingValues.telephoneNumber || '',
        startingBalance: Number(pendingValues.startingBalance) || 0,
        pettyCash: Number(pendingValues.pettyCash) || 0,
        logoUrl: pendingValues.logoUrl,
        logoFile: profileFile || undefined,
      })
      onSuccess?.(created)
      resetFormState()
      setIsConfirmOpen(false)
      onOpenChange(false)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to create company. Please try again.')
      setSubmitError(errorMsg)
      setIsConfirmOpen(false)
      notifyError(error, 'Unable to create company. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl sm:max-w-[780px] w-full">
          <DialogHeader className="text-left sm:text-left space-y-1 pb-3 border-b border-stroke/15">
            <DialogTitle className="text-xl sm:text-2xl font-bold text-focus">
              Create Company
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
              Add company to the group
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
              {/* Company Profile Picture / Logo Upload & Cropping */}
              <div className="flex flex-col items-center justify-center py-2">
                <div
                  onClick={() => {
                    if (profilePreview) {
                      handleOpenCropper()
                    } else {
                      fileInputRef.current?.click()
                    }
                  }}
                  className="relative group h-24 w-24 sm:h-28 sm:w-28 rounded-full border-2 border-dashed border-primary/50 hover:border-primary flex items-center justify-center p-3 bg-white shadow-xs cursor-pointer transition-all overflow-hidden"
                  title={profilePreview ? 'Click to crop / adjust logo' : 'Click to upload company logo'}
                >
                  <img
                    src={profilePreview || logo2Url}
                    alt="Company Logo Preview"
                    className="h-16 w-16 sm:h-20 sm:w-20 object-contain rounded-full"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white rounded-full">
                    {profilePreview ? (
                      <>
                        <Crop className="h-5 w-5" />
                        <span className="text-[10px] font-semibold mt-1">Crop</span>
                      </>
                    ) : (
                      <>
                        <Camera className="h-5 w-5" />
                        <span className="text-[10px] font-semibold mt-1">Upload</span>
                      </>
                    )}
                  </div>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageFileChange}
                  accept="image/*"
                  className="hidden"
                />

                <div className="flex flex-wrap items-center justify-center gap-2 mt-2.5">
                  {!profilePreview ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8 px-3 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold cursor-pointer rounded-lg border border-primary/20"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Upload Logo
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOpenCropper}
                        className="h-8 px-3 text-xs text-focus font-semibold cursor-pointer rounded-lg border-stroke/40 hover:bg-surface flex items-center gap-1.5"
                      >
                        <Crop className="h-3.5 w-3.5 text-primary" />
                        Crop / Adjust
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-8 px-2.5 text-xs text-primary hover:bg-primary/10 font-semibold cursor-pointer rounded-lg"
                      >
                        <Upload className="h-3.5 w-3.5 mr-1" />
                        Change
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setProfilePreview(null)
                          setProfileFile(null)
                          setRawImageForCrop(null)
                          form.setValue('logoUrl', undefined)
                        }}
                        className="h-8 px-2.5 text-xs text-muted-fg hover:text-red-600 hover:bg-red-50 cursor-pointer rounded-lg"
                      >
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Company Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label htmlFor="company-name" className="text-xs sm:text-sm font-medium text-focus/90">
                      Company Name <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <Input
                        id="company-name"
                        placeholder="e.g. MCT Logistics"
                        className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                        aria-invalid={!!fieldState.error}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-error" />
                  </FormItem>
                )}
              />

              {/* Address */}
              <FormField
                control={form.control}
                name="address"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-1.5">
                    <Label htmlFor="company-address" className="text-xs sm:text-sm font-medium text-focus/90">
                      Address <span className="text-red-500">*</span>
                    </Label>
                    <FormControl>
                      <Input
                        id="company-address"
                        placeholder="e.g. Blk 43, Lot 24 Regalado Highway, Fairview, Quezon City"
                        className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                        aria-invalid={!!fieldState.error}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs text-error" />
                  </FormItem>
                )}
              />

              {/* Contact Number & Telephone Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contactNumber"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1.5">
                      <Label htmlFor="contact-number" className="text-xs sm:text-sm font-medium text-focus/90">
                        Contact Number <span className="text-red-500">*</span> <span className="text-muted-fg text-xs font-normal">(11 digits, starts with 09)</span>
                      </Label>
                      <FormControl>
                        <Input
                          id="contact-number"
                          type="tel"
                          inputMode="numeric"
                          maxLength={11}
                          placeholder="09171234567"
                          value={field.value || '09'}
                          onChange={(e) => {
                            let val = e.target.value.replace(/\D/g, '')
                            if (!val.startsWith('09')) {
                              if (val === '0' || val === '') {
                                val = '09'
                              } else if (val.startsWith('9')) {
                                val = '0' + val
                              } else {
                                val = '09' + val
                              }
                            }
                            field.onChange(val.slice(0, 11))
                          }}
                          onKeyDown={(e) => {
                            if (
                              (e.key === 'Backspace' || e.key === 'Delete') &&
                              (field.value === '09' || (e.currentTarget.selectionStart !== null && e.currentTarget.selectionStart <= 2 && e.currentTarget.selectionEnd !== null && e.currentTarget.selectionEnd <= 2))
                            ) {
                              e.preventDefault()
                            }
                          }}
                          className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                          aria-invalid={!!fieldState.error}
                        />
                      </FormControl>
                      <FormMessage className="text-xs text-error" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="telephoneNumber"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1.5">
                      <Label htmlFor="telephone-number" className="text-xs sm:text-sm font-medium text-focus/90">
                        Telephone Number <span className="text-muted-fg text-xs font-normal">(Optional, 8 digits)</span>
                      </Label>
                      <FormControl>
                        <Input
                          id="telephone-number"
                          type="tel"
                          inputMode="numeric"
                          maxLength={8}
                          placeholder="e.g. 81234567"
                          value={field.value}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 8)
                            field.onChange(val)
                          }}
                          className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                          aria-invalid={!!fieldState.error}
                        />
                      </FormControl>
                      <FormMessage className="text-xs text-error" />
                    </FormItem>
                  )}
                />
              </div>

              {/* Balances Row: Starting Balance and Petty Cash side-by-side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Starting Balance */}
                <FormField
                  control={form.control}
                  name="startingBalance"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1.5">
                      <Label htmlFor="starting-balance" className="text-xs sm:text-sm font-medium text-focus/90">
                        Starting Balance (₱) <span className="text-muted-fg text-xs font-normal">(Optional, default 0)</span>
                      </Label>
                      <FormControl>
                        <Input
                          id="starting-balance"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                          aria-invalid={!!fieldState.error}
                          value={field.value ?? ''}
                          onKeyDown={(e) => {
                            if (['-', '+', 'e', 'E'].includes(e.key)) {
                              e.preventDefault()
                            }
                          }}
                          onChange={(event) => {
                            const val = sanitizeNumericInput(event.target.value)
                            field.onChange(val)
                          }}
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      <FormMessage className="text-xs text-error" />
                    </FormItem>
                  )}
                />

                {/* Petty Cash */}
                <FormField
                  control={form.control}
                  name="pettyCash"
                  render={({ field, fieldState }) => (
                    <FormItem className="space-y-1.5">
                      <Label htmlFor="petty-cash" className="text-xs sm:text-sm font-medium text-focus/90">
                        Petty Cash (₱) <span className="text-muted-fg text-xs font-normal">(Optional, default 0)</span>
                      </Label>
                      <FormControl>
                        <Input
                          id="petty-cash"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="h-11 rounded-xl border-[0.5px] border-stroke/60 text-sm focus-visible:ring-1 focus-visible:ring-focus"
                          aria-invalid={!!fieldState.error}
                          value={field.value ?? ''}
                          onKeyDown={(e) => {
                            if (['-', '+', 'e', 'E'].includes(e.key)) {
                              e.preventDefault()
                            }
                          }}
                          onChange={(event) => {
                            const val = sanitizeNumericInput(event.target.value)
                            field.onChange(val)
                          }}
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      <FormMessage className="text-xs text-error" />
                    </FormItem>
                  )}
                />
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
                      <Building2 className="h-4 w-4" />
                      <span>Create Company</span>
                    </>
                  )}
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
      />

      {/* Confirmation Modal */}
      <ConfirmationDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Confirm Company Creation"
        description={
          <span>
            Are you sure you want to register{' '}
            <strong className="text-focus">{pendingValues?.name}</strong> to the
            MCT Group of Companies?
          </span>
        }
        confirmLabel="Yes, Create Company"
        actionType="add"
        variant="primary"
        isLoading={isSubmitting}
        onConfirm={handleConfirmCreate}
      />
    </>
  )
}
