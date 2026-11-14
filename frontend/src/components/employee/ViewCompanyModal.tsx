import * as React from 'react'
import {
  Pencil,
  Trash2,
  Loader2,
  Check,
  Upload,
  Crop,
  AlertTriangle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import logo2Url from '@/assets/LOGO2.png'
import {
  employeeService,
  type Company,
  type CreateCompanyPayload,
} from '@/services/employeeService'
import { formatPHP } from '@/lib/format'
import { authService } from '@/services/authService'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { formatUserFriendlyErrorMessage, notifyError } from '@/utils/errorUtils'
import { ImageCropperModal } from '@/components/common/ImageCropperModal'
import { sanitizeNumericInput } from '@/utils/numericInputUtils'

interface ViewCompanyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  company: Company | null
  onUpdate?: (updated: Company) => void
  onDelete?: (companyId: string) => void
}

export const ViewCompanyModal: React.FC<ViewCompanyModalProps> = ({
  open,
  onOpenChange,
  company,
  onUpdate,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = React.useState(false)
  const [isConfirmEditOpen, setIsConfirmEditOpen] = React.useState(false)
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = React.useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = React.useState('')
  const [adminPassword, setAdminPassword] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const [currentCompany, setCurrentCompany] = React.useState<Company | null>(company)
  const [isLoadingDetails, setIsLoadingDetails] = React.useState(false)

  React.useEffect(() => {
    if (open && company?.id) {
      setCurrentCompany(company)
      setIsLoadingDetails(true)
      employeeService
        .getCompany(company.id)
        .then((fresh) => {
          setCurrentCompany(fresh)
        })
        .catch((err) => {
          console.warn('Could not refresh company details from database:', err)
        })
        .finally(() => {
          setIsLoadingDetails(false)
        })
    } else if (!open) {
      setCurrentCompany(null)
      setIsLoadingDetails(false)
    }
  }, [open, company?.id])

  const activeCompany = currentCompany || company

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [profilePreview, setProfilePreview] = React.useState<string | null>(null)
  const [profileFile, setProfileFile] = React.useState<File | null>(null)
  const [rawImageForCrop, setRawImageForCrop] = React.useState<string | null>(null)
  const [isCropperOpen, setIsCropperOpen] = React.useState(false)
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})

  // Edit form state
  const [formData, setFormData] = React.useState<CreateCompanyPayload>({
    name: '',
    address: '',
    contactNumber: '',
    telephoneNumber: '',
    startingBalance: 0,
    pettyCash: 0,
    logoUrl: undefined,
  })

  const handleStartEdit = () => {
    const targetComp = activeCompany || company
    if (targetComp) {
      const rawContact = (targetComp.contactNumber || '').replace(/\D/g, '')
      let initContact = rawContact
      if (!initContact.startsWith('09')) {
        if (initContact.startsWith('9')) {
          initContact = '0' + initContact
        } else if (initContact === '0' || initContact === '') {
          initContact = '09'
        } else {
          initContact = '09' + initContact
        }
      }
      initContact = initContact.slice(0, 11)

      setFormData({
        name: targetComp.name,
        address: targetComp.address,
        contactNumber: initContact,
        telephoneNumber: targetComp.telephoneNumber || '',
        startingBalance: targetComp.startingBalance ?? 0,
        pettyCash: targetComp.pettyCash ?? 0,
        logoUrl: targetComp.logoUrl,
      })
      setProfilePreview(targetComp.logoUrl || null)
      setProfileFile(null)
      setRawImageForCrop(null)
      setIsCropperOpen(false)
      setFormErrors({})
      setActionError(null)
      setIsEditing(true)
    }
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setProfileFile(file)
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
    setFormData((prev) => ({ ...prev, logoUrl: croppedDataUrl }))
    try {
      const arr = croppedDataUrl.split(',')
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
      const bstr = atob(arr[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
      }
      setProfileFile(new File([u8arr], 'company-logo.png', { type: mime }))
    } catch {
      // ignore
    }
  }

  const handleOpenCropper = () => {
    if (rawImageForCrop || profilePreview) {
      setIsCropperOpen(true)
    }
  }

  const handleModalOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setIsEditing(false)
      setIsConfirmEditOpen(false)
      setIsConfirmDeleteOpen(false)
      setDeleteConfirmationName('')
      setProfilePreview(null)
      setProfileFile(null)
      setRawImageForCrop(null)
      setIsCropperOpen(false)
      setFormErrors({})
    }
    onOpenChange(nextOpen)
  }

  if (!activeCompany) return null

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errors: Record<string, string> = {}
    if (!formData.contactNumber || !/^09\d{9}$/.test(formData.contactNumber)) {
      errors.contactNumber = 'Contact number must be exactly 11 digits starting with 09'
    }
    if (formData.telephoneNumber && !/^\d{8}$/.test(formData.telephoneNumber)) {
      errors.telephoneNumber = 'Telephone number must be exactly 8 digits'
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})
    setIsConfirmEditOpen(true)
  }

  const handleConfirmSave = async () => {
    const targetId = activeCompany.id
    try {
      setIsSubmitting(true)
      const updated = await employeeService.updateCompany(targetId, {
        ...formData,
        startingBalance: formData.startingBalance === ('' as unknown as number) ? 0 : (Number(formData.startingBalance) || 0),
        pettyCash: formData.pettyCash === ('' as unknown as number) ? 0 : (Number(formData.pettyCash) || 0),
        logoFile: profileFile || undefined,
      })
      setCurrentCompany(updated)
      onUpdate?.(updated)
      setIsConfirmEditOpen(false)
      setIsEditing(false)
      setProfileFile(null)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to update company. Please try again.')
      setActionError(errorMsg)
      setIsConfirmEditOpen(false)
      notifyError(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isDeleteMatch = Boolean(
    activeCompany &&
    deleteConfirmationName.trim() === activeCompany.name.trim() &&
    adminPassword.trim().length > 0
  )

  const handleOpenDeleteConfirm = () => {
    setDeleteConfirmationName('')
    setAdminPassword('')
    setActionError(null)
    setIsConfirmDeleteOpen(true)
  }

  const handleDeleteOpenChange = (nextOpen: boolean) => {
    setIsConfirmDeleteOpen(nextOpen)
    setDeleteConfirmationName('')
    setAdminPassword('')
    if (!nextOpen) {
      setActionError(null)
    }
  }

  const handleConfirmDelete = async () => {
    if (!activeCompany) return
    if (deleteConfirmationName.trim() !== activeCompany.name.trim()) return
    if (!adminPassword.trim()) {
      notifyError('Please enter your admin password to reauthenticate.')
      return
    }

    try {
      setIsSubmitting(true)
      const reauthToken = await authService.reauthenticate(adminPassword.trim())
      await employeeService.deleteCompany(activeCompany.id, reauthToken)
      onDelete?.(activeCompany.id)
      setIsConfirmDeleteOpen(false)
      setDeleteConfirmationName('')
      setAdminPassword('')
      onOpenChange(false)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to delete company. Please check your password and try again.')
      setActionError(errorMsg)
      setIsConfirmDeleteOpen(false)
      setDeleteConfirmationName('')
      setAdminPassword('')
      notifyError(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleModalOpenChange}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            if (document.activeElement && e.currentTarget.contains(document.activeElement)) {
              e.preventDefault()
              ;(document.activeElement as HTMLElement)?.blur()
            }
          }}
          className="sm:max-w-[640px] md:max-w-[680px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl max-h-[85vh] overflow-y-auto"
        >
          <DialogTitle className="sr-only">
            {activeCompany.name} Details
          </DialogTitle>

          {actionError && (
            <div className="p-3 my-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start justify-between gap-2">
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-red-500 hover:text-red-700 font-bold ml-auto cursor-pointer"
              >
                &times;
              </button>
            </div>
          )}

          {isEditing ? (
            /* Edit Form View in Portrait Orientation */
            <form onSubmit={handleFormSubmit} className="space-y-4 pt-1">
              <div className="border-b border-stroke/20 pb-3 text-center sm:text-left">
                <h3 className="text-lg font-bold text-focus">Edit Company Profile</h3>
                <p className="text-xs text-muted-fg mt-0.5">Update company branding and information</p>
              </div>

              {/* Editable Company Profile Picture / Logo */}
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
                    onError={(e) => {
                      const target = e.currentTarget
                      target.onerror = null
                      target.src = logo2Url
                    }}
                    className="h-14 w-14 sm:h-16 sm:w-16 object-contain"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white rounded-full">
                    <Crop className="h-5 w-5" />
                    <span className="text-[10px] font-semibold mt-1">Crop</span>
                  </div>
                </div>

                <input
                  id="view-company-logo"
                  name="companyLogo"
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
                    className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Upload Logo
                  </Button>
                  {profilePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleOpenCropper}
                      className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold flex items-center gap-1"
                    >
                      <Crop className="h-3 w-3 mr-1" />
                      Crop / Adjust
                    </Button>
                  )}
                  {profilePreview && profilePreview !== company.logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setProfilePreview(company.logoUrl || null)
                        setRawImageForCrop(null)
                        setFormData((prev) => ({ ...prev, logoUrl: company.logoUrl }))
                      }}
                      className="h-7 px-2 text-xs text-muted-fg hover:text-focus"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>

              {/* Form Inputs */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-comp-name" className="text-xs font-medium text-focus/80">Company Name</Label>
                  <Input
                    id="edit-comp-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="h-10 rounded-xl text-sm"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-comp-addr" className="text-xs font-medium text-focus/80">Address</Label>
                  <Input
                    id="edit-comp-addr"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="h-10 rounded-xl text-sm"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-comp-contact-num" className="text-xs font-medium text-focus/80">
                      Contact Number <span className="text-primary">*</span>
                      <span className="text-[10px] text-muted-fg ml-1">(11 digits, starts with 09)</span>
                    </Label>
                    <Input
                      id="edit-comp-contact-num"
                      type="tel"
                      inputMode="numeric"
                      maxLength={11}
                      value={formData.contactNumber || '09'}
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
                        val = val.slice(0, 11)
                        setFormData({ ...formData, contactNumber: val })
                        if (formErrors.contactNumber) setFormErrors((prev) => ({ ...prev, contactNumber: '' }))
                      }}
                      onKeyDown={(e) => {
                        if (
                          (e.key === 'Backspace' || e.key === 'Delete') &&
                          (formData.contactNumber === '09' || (e.currentTarget.selectionStart !== null && e.currentTarget.selectionStart <= 2 && e.currentTarget.selectionEnd !== null && e.currentTarget.selectionEnd <= 2))
                        ) {
                          e.preventDefault()
                        }
                      }}
                      placeholder="09171234567"
                      className="h-10 rounded-xl text-sm"
                      required
                    />
                    {formErrors.contactNumber && (
                      <p className="text-xs text-rose-500">{formErrors.contactNumber}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="edit-comp-tel-num" className="text-xs font-medium text-focus/80">
                      Telephone Number
                      <span className="text-[10px] text-muted-fg ml-1">(Optional, 8 digits)</span>
                    </Label>
                    <Input
                      id="edit-comp-tel-num"
                      type="tel"
                      inputMode="numeric"
                      maxLength={8}
                      value={formData.telephoneNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 8)
                        setFormData({ ...formData, telephoneNumber: val })
                        if (formErrors.telephoneNumber) setFormErrors((prev) => ({ ...prev, telephoneNumber: '' }))
                      }}
                      placeholder="81234567"
                      className="h-10 rounded-xl text-sm"
                    />
                    {formErrors.telephoneNumber && (
                      <p className="text-xs text-rose-500">{formErrors.telephoneNumber}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-comp-start-bal" className="text-xs font-medium text-focus/80">
                      Starting Balance (₱) <span className="text-[10px] text-muted-fg ml-1">(Optional, default 0)</span>
                    </Label>
                    <Input
                      id="edit-comp-start-bal"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={formData.startingBalance === undefined || formData.startingBalance === null ? '' : formData.startingBalance}
                      onKeyDown={(e) => {
                        if (['-', '+', 'e', 'E'].includes(e.key)) {
                          e.preventDefault()
                        }
                      }}
                      onChange={(e) => {
                        const val = sanitizeNumericInput(e.target.value)
                        setFormData({
                          ...formData,
                          startingBalance: val === '' ? ('' as unknown as number) : (val as unknown as number),
                        })
                      }}
                      className="h-10 rounded-xl text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-comp-petty-cash" className="text-xs font-medium text-focus/80">
                      Petty Cash (₱) <span className="text-[10px] text-muted-fg ml-1">(Optional, default 0)</span>
                    </Label>
                    <Input
                      id="edit-comp-petty-cash"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={formData.pettyCash === undefined || formData.pettyCash === null ? '' : formData.pettyCash}
                      onKeyDown={(e) => {
                        if (['-', '+', 'e', 'E'].includes(e.key)) {
                          e.preventDefault()
                        }
                      }}
                      onChange={(e) => {
                        const val = sanitizeNumericInput(e.target.value)
                        setFormData({
                          ...formData,
                          pettyCash: val === '' ? ('' as unknown as number) : (val as unknown as number),
                        })
                      }}
                      className="h-10 rounded-xl text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons: Both on right side */}
              <div className="flex items-center justify-end gap-3 pt-6 mt-4 border-t border-stroke/20">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => setIsEditing(false)}
                  className="h-11 px-7 rounded-xl border border-stroke/50 text-focus hover:bg-surface font-medium text-sm transition-colors cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-11 px-7 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Save Changes</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            /* View Mode in Portrait Orientation */
            <div className="flex flex-col items-center pt-2">
              {/* Centered Circular Logo/Profile Badge */}
              <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full border-2 border-primary flex items-center justify-center p-3 bg-white shadow-xs overflow-hidden">
                <img
                  src={activeCompany.logoUrl || logo2Url}
                  alt={activeCompany.name}
                  onError={(e) => {
                    const target = e.currentTarget
                    target.onerror = null
                    target.src = logo2Url
                  }}
                  className="h-14 w-14 sm:h-16 sm:w-16 object-contain"
                />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-focus mt-3.5 tracking-tight text-center">
                {activeCompany.name}
              </h2>

              {/* Properly Aligned Key-Value Details */}
              <div className="w-full space-y-3 pt-5 mt-4 border-t border-stroke/20 text-sm">
                <div className="flex items-start justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0 mt-0.5">
                    Address:
                  </span>
                  <span className="font-semibold text-focus text-right text-xs sm:text-sm leading-relaxed max-w-[240px]">
                    {activeCompany.address || '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0">
                    Contact Number:
                  </span>
                  <span className="font-semibold text-focus text-sm text-right tabular-nums">
                    {activeCompany.contactNumber || '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0">
                    Telephone Number:
                  </span>
                  <span className="font-semibold text-focus text-sm text-right tabular-nums">
                    {activeCompany.telephoneNumber || '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0">
                    Starting Balance:
                  </span>
                  <span className="font-semibold text-focus text-sm text-right tabular-nums">
                    {formatPHP(Number(activeCompany.startingBalance) || 0)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0">
                    Petty Cash:
                  </span>
                  <span className="font-semibold text-focus text-sm text-right tabular-nums">
                    {formatPHP(Number(activeCompany.pettyCash) || 0)}
                  </span>
                </div>
              </div>

              {/* Modal Actions Footer: Both buttons on right side, Cancel removed */}
              <div className="flex items-center justify-end gap-3 pt-6 mt-4 border-t border-stroke/20 w-full">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={handleOpenDeleteConfirm}
                  className="h-11 px-5 rounded-xl border border-stroke/50 text-focus hover:text-primary hover:border-primary/40 hover:bg-primary/5 font-medium text-sm flex items-center gap-2 transition-colors"
                >
                  <Trash2 className="h-4 w-4 text-primary" />
                  <span>Delete Company</span>
                </Button>

                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleStartEdit}
                  className="h-11 px-6 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm flex items-center gap-2 shadow-sm transition-all"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Edit Company</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Edit / Save Changes */}
      <ConfirmationDialog
        open={isConfirmEditOpen}
        onOpenChange={setIsConfirmEditOpen}
        title="Confirm Profile Changes"
        description={
          <span>
            Are you sure you want to update the company profile for{' '}
            <strong className="text-focus">{formData.name}</strong>?
          </span>
        }
        confirmLabel="Yes, Save Changes"
        actionType="edit"
        variant="primary"
        isLoading={isSubmitting}
        onConfirm={handleConfirmSave}
      />

      {/* Confirmation Dialog for Delete */}
      <ConfirmationDialog
        open={isConfirmDeleteOpen}
        onOpenChange={handleDeleteOpenChange}
        title="Delete Company"
        description={
          <span>
            Are you sure you want to permanently remove{' '}
            <strong className="text-focus">{activeCompany.name}</strong> from the MCT
            Group of Companies? This action cannot be undone.
          </span>
        }
        confirmLabel="Yes, Delete Company"
        actionType="delete"
        variant="destructive"
        isLoading={isSubmitting}
        confirmDisabled={!isDeleteMatch}
        onConfirm={handleConfirmDelete}
      >
        <div className="space-y-4 pt-2 text-left w-full">
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-rose-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>Permanent deletion warning</span>
            </div>
            <p className="text-xs text-rose-700 leading-relaxed">
              This action permanently purges all financial records, sales, expenses, receivables, tenant leases, and linked bank accounts associated with <strong className="font-semibold text-rose-950">{company.name}</strong>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-company-name" className="text-xs sm:text-sm font-medium text-focus block">
              Please type <span className="font-bold select-all text-primary">"{company.name}"</span> to confirm.
            </Label>
            <Input
              id="confirm-company-name"
              type="text"
              value={deleteConfirmationName}
              onChange={(e) => setDeleteConfirmationName(e.target.value)}
              placeholder={company.name}
              autoComplete="off"
              className="h-10 text-sm rounded-xl border-stroke/50 focus:border-primary focus:ring-primary/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-admin-password" className="text-xs sm:text-sm font-medium text-focus block">
              Confirm Admin Password <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="confirm-admin-password"
              name="adminPassword"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter your current password"
              autoComplete="current-password"
              className="h-10 text-sm rounded-xl border-stroke/50 focus:border-primary focus:ring-primary/20"
            />
          </div>
        </div>
      </ConfirmationDialog>

      {/* Image Cropper Modal */}
      <ImageCropperModal
        open={isCropperOpen}
        onOpenChange={setIsCropperOpen}
        imageSrc={rawImageForCrop || profilePreview}
        onCropComplete={handleCropComplete}
        title="Crop Company Logo"
      />
    </>
  )
}
