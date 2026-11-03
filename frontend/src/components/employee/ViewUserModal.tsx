import * as React from 'react'
import {
  Pencil,
  Trash2,
  Loader2,
  Check,
  ShieldCheck,
  Building2,
  Mail,
  Upload,
  User as UserIcon,
  Crop,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  employeeService,
  type Company,
  type EmployeeUser,
  type UpdateUserPayload,
} from '@/services/employeeService'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'
import { ImageCropperModal } from '@/components/common/ImageCropperModal'

interface ViewUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: EmployeeUser | null
  companies: Company[]
  onUpdate?: (updated: EmployeeUser) => void
  onDelete?: (userId: string) => void
}

const ROLES = [
  'Finance',
  'Audit',
  'Supervisor',
] as const

const formatCompanyList = (names: string[]): string => {
  if (!names || names.length === 0) return 'no company'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}


export const ViewUserModal: React.FC<ViewUserModalProps> = ({
  open,
  onOpenChange,
  user,
  companies,
  onUpdate,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = React.useState(false)
  const [isConfirmEditOpen, setIsConfirmEditOpen] = React.useState(false)
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // Photo upload and cropping in edit mode
  const [editProfilePreview, setEditProfilePreview] = React.useState<string | null>(null)
  const [editAvatarFile, setEditAvatarFile] = React.useState<File | null>(null)
  const [rawImageForCrop, setRawImageForCrop] = React.useState<string | null>(null)
  const [isCropperOpen, setIsCropperOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Multi-company selection state
  const [editSelectedCompanies, setEditSelectedCompanies] = React.useState<string[]>([])

  // Edit form state
  const [formData, setFormData] = React.useState<UpdateUserPayload>({
    fullName: '',
    email: '',
    assignedCompany: '',
    role: 'Supervisor',
    avatarUrl: '',
  })


  const isProtectedAdmin = Boolean(
    user?.isProtected ||
    user?.id === '1' ||
    user?.isAdmin ||
    user?.role?.toLowerCase() === 'admin'
  )

  React.useEffect(() => {
    if (user && open) {
      const initialCompanies = user.companyNames && user.companyNames.length > 0
        ? user.companyNames
        : (user.companyName ? [user.companyName] : [])

      setFormData({
        fullName: user.fullName,
        email: user.email,
        assignedCompany: user.companyName,
        assignedCompanies: initialCompanies,
        role: user.role || (user.isAdmin ? 'Admin' : 'Supervisor'),
        avatarUrl: user.avatarUrl,
      })
      setEditSelectedCompanies(initialCompanies)
      setEditProfilePreview(user.avatarUrl || null)
      setEditAvatarFile(null)
      setRawImageForCrop(null)
      setIsCropperOpen(false)
      setActionError(null)
    }
  }, [user, open])

  const handleStartEdit = () => {
    if (user && !isProtectedAdmin) {
      const initialCompanies = user.companyNames && user.companyNames.length > 0
        ? user.companyNames
        : (user.companyName ? [user.companyName] : [])

      setFormData({
        fullName: user.fullName,
        email: user.email,
        assignedCompany: user.companyName,
        assignedCompanies: initialCompanies,
        role: user.role || (user.isAdmin ? 'Admin' : 'Supervisor'),
        avatarUrl: user.avatarUrl,
      })
      setEditSelectedCompanies(initialCompanies)
      setEditProfilePreview(user.avatarUrl || null)
      setEditAvatarFile(null)
      setRawImageForCrop(null)
      setIsCropperOpen(false)
      setIsEditing(true)
    }
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setEditAvatarFile(file)
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
    setEditProfilePreview(croppedDataUrl)
    setFormData((prev) => ({ ...prev, avatarUrl: croppedDataUrl }))
    try {
      const arr = croppedDataUrl.split(',')
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
      const bstr = atob(arr[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
      }
      setEditAvatarFile(new File([u8arr], 'user-avatar.png', { type: mime }))
    } catch {
      // ignore
    }
  }

  const handleOpenCropper = () => {
    if (rawImageForCrop || editProfilePreview) {
      setIsCropperOpen(true)
    }
  }
  const handleRoleChange = (role: string) => {
    setFormData((prev) => ({ ...prev, role }))
  }

  const handleModalOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setIsEditing(false)
      setIsConfirmEditOpen(false)
      setIsConfirmDeleteOpen(false)
      setEditProfilePreview(null)
      setEditAvatarFile(null)
      setRawImageForCrop(null)
      setIsCropperOpen(false)
    }
    onOpenChange(nextOpen)
  }

  if (!user) return null

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.role !== 'Admin' && formData.role !== 'Audit' && editSelectedCompanies.length === 0) {
      window.alert('Please select at least one assigned company.')
      return
    }
    setIsConfirmEditOpen(true)
  }

  const handleConfirmSave = async () => {
    try {
      setIsSubmitting(true)
      const resolvedCompanyIds = editSelectedCompanies
        .map((name) => {
          const comp = companies.find((c) => c.name === name || c.id === name)
          return comp ? Number(comp.id) : null
        })
        .filter((id): id is number => id !== null && !isNaN(id))

      const updated = await employeeService.updateUser(user.id, {
        fullName: formData.fullName,
        email: formData.email,
        role: formData.role,
        assignedCompany: editSelectedCompanies[0] || '',
        assignedCompanies: editSelectedCompanies,
        companyIds: resolvedCompanyIds,
        avatarFile: editAvatarFile || undefined,
        avatarUrl: editProfilePreview || formData.avatarUrl || user.avatarUrl,
      })
      setIsConfirmEditOpen(false)
      setIsEditing(false)
      setEditProfilePreview(null)
      setEditAvatarFile(null)
      setRawImageForCrop(null)
      setIsCropperOpen(false)
      onOpenChange(false)
      onUpdate?.(updated)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to update user. Please try again.')
      setActionError(errorMsg)
      setIsConfirmEditOpen(false)
      window.alert(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (isProtectedAdmin) {
      window.alert('The primary administrator account is protected and cannot be deleted.')
      return
    }
    try {
      setIsSubmitting(true)
      await employeeService.deleteUser(user.id)
      onDelete?.(user.id)
      setIsConfirmDeleteOpen(false)
      onOpenChange(false)
    } catch (error) {
      const errorMsg = formatUserFriendlyErrorMessage(error, 'Unable to delete user. Please try again.')
      setActionError(errorMsg)
      setIsConfirmDeleteOpen(false)
      window.alert(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const initials = user.fullName
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
      <Dialog open={open} onOpenChange={handleModalOpenChange}>
        <DialogContent className="sm:max-w-[640px] md:max-w-[680px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">
            {user.fullName} Details
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
                <h3 className="text-lg font-bold text-focus">Edit User Profile</h3>
                <p className="text-xs text-muted-fg mt-0.5">Update user account, role and assigned company</p>
              </div>

              {/* Editable User Profile Photo (Matching Edit Company Modal with Zoom & Crop) */}
              <div className="flex flex-col items-center justify-center py-2">
                <div
                  onClick={() => {
                    if (editProfilePreview) {
                      handleOpenCropper()
                    } else {
                      fileInputRef.current?.click()
                    }
                  }}
                  className="relative group h-24 w-24 sm:h-28 sm:w-28 rounded-full border-2 border-dashed border-primary/50 hover:border-primary flex items-center justify-center p-1 bg-red-50 text-primary font-bold text-2xl shadow-xs cursor-pointer transition-all overflow-hidden"
                  title={editProfilePreview ? 'Click to crop / adjust photo' : 'Click to upload photo'}
                >
                  {editProfilePreview ? (
                    <img
                      src={editProfilePreview}
                      alt="User Avatar Preview"
                      className="h-full w-full object-cover rounded-full"
                    />
                  ) : (
                    initials || <UserIcon className="h-10 w-10 text-primary" />
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
                  {editProfilePreview && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleOpenCropper}
                      className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Crop className="h-3 w-3 mr-1" />
                      Crop / Adjust
                    </Button>
                  )}
                  {editProfilePreview && editProfilePreview !== user.avatarUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditProfilePreview(user.avatarUrl || null)
                        setEditAvatarFile(null)
                        setRawImageForCrop(null)
                        setFormData((prev) => ({ ...prev, avatarUrl: user.avatarUrl }))
                      }}
                      className="h-7 px-2 text-xs text-muted-fg hover:text-focus cursor-pointer"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>

              {/* Form Inputs */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-user-name" className="text-xs font-medium text-focus/80">Full Name</Label>
                  <Input
                    id="edit-user-name"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="h-10 rounded-xl text-sm"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-user-email" className="text-xs font-medium text-focus/80">Email Address</Label>
                  <Input
                    id="edit-user-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="h-10 rounded-xl text-sm"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-user-role" className="text-xs font-medium text-focus/80">Role</Label>
                  <div className="relative">
                    <select
                      id="edit-user-role"
                      value={formData.role}
                      onChange={(e) => handleRoleChange(e.target.value)}
                      className="flex h-10 w-full rounded-xl border border-stroke/60 bg-white px-3 py-2 text-xs sm:text-sm text-focus shadow-none transition-colors appearance-none focus:outline-none focus:ring-1 focus:ring-focus cursor-pointer"
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
                </div>

                {/* Companies Assigned - Multi-Select Checkboxes */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-focus/80">
                      Companies Assigned ({editSelectedCompanies.length} selected)
                    </Label>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditSelectedCompanies(companies.map((c) => c.name))}
                        className="text-primary hover:underline font-medium text-[11px] cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => setEditSelectedCompanies([])}
                        className="text-muted-fg hover:text-focus text-[11px] cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="max-h-36 overflow-y-auto pr-1 space-y-1.5 rounded-xl border border-stroke/40 p-2 bg-slate-50/50">
                    {companies.map((comp) => {
                      const isSelected = editSelectedCompanies.includes(comp.name)
                      return (
                        <div
                          key={comp.id}
                          onClick={() =>
                            setEditSelectedCompanies((prev) =>
                              prev.includes(comp.name)
                                ? prev.filter((c) => c !== comp.name)
                                : [...prev, comp.name]
                            )
                          }
                          className={cn(
                            'flex items-center justify-between p-2 rounded-lg border text-xs font-medium transition-all cursor-pointer select-none',
                            isSelected
                              ? 'border-[#960C01] bg-red-50/70 text-focus ring-1 ring-[#960C01]'
                              : 'border-stroke/50 bg-white hover:bg-slate-100/70 text-focus/80'
                          )}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <div
                              className={cn(
                                'h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
                                isSelected ? 'border-[#960C01] bg-[#960C01]' : 'border-slate-300 bg-white'
                              )}
                            >
                              {isSelected && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                            </div>
                            <span className="truncate">{comp.name}</span>
                          </div>
                          {isSelected && (
                            <span className="text-[9px] font-bold text-primary uppercase px-1.5 py-0.5 rounded bg-red-100/70 shrink-0">
                              Selected
                            </span>
                          )}
                        </div>
                      )
                    })}
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
              {/* Centered Circular User Avatar Badge */}
              <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full border-2 border-primary flex items-center justify-center p-1 bg-red-50 text-primary shadow-xs font-bold text-2xl sm:text-3xl overflow-hidden">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.fullName}
                    className="h-full w-full object-cover rounded-full"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      if (e.currentTarget.parentElement) {
                        e.currentTarget.parentElement.innerText = initials || 'U'
                      }
                    }}
                  />
                ) : (
                  initials || <UserIcon className="h-10 w-10 text-primary" />
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-focus mt-3.5 tracking-tight text-center">
                {user.fullName}
              </h2>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-primary/10 text-primary border border-primary/20">
                  {user.role || (user.isAdmin ? 'Admin' : 'Supervisor')}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {user.status}
                </span>
              </div>

              {/* Key-Value Details */}
              <div className="w-full space-y-3 pt-5 mt-4 border-t border-stroke/20 text-sm">
                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-muted-fg" />
                    Email:
                  </span>
                  <span className="font-semibold text-focus text-sm text-right break-all">
                    {user.email || '—'}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0 mt-0.5 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-fg" />
                    Appointed Companies:
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end max-w-[280px]">
                    {user.companyNames && user.companyNames.length > 0 ? (
                      user.companyNames.map((cName) => (
                        <span
                          key={cName}
                          className="text-xs px-2.5 py-0.5 rounded font-medium bg-slate-100 text-focus border border-slate-200"
                        >
                          {cName}
                        </span>
                      ))
                    ) : (
                      <span className="font-semibold text-focus text-sm text-right">
                        {user.companyName || '—'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0 flex items-center gap-1.5">
                    <UserIcon className="h-3.5 w-3.5 text-muted-fg" />
                    Role:
                  </span>
                  <span className="font-semibold text-focus text-sm text-right">
                    {user.role || (user.isAdmin ? 'Admin' : 'Supervisor')}
                  </span>
                </div>



                <div className="flex items-center justify-between gap-4 py-0.5">
                  <span className="font-medium text-muted-fg text-sm shrink-0">
                    Last Login:
                  </span>
                  <span className="font-normal text-muted-fg text-xs text-right">
                    {user.lastLogin || 'Never'}
                  </span>
                </div>
              </div>

              {/* Modal Actions Footer */}
              <div className="flex items-center justify-end gap-3 pt-6 mt-4 border-t border-stroke/20 w-full">
                {isProtectedAdmin ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium w-full">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>Primary System Administrator account is protected (read-only)</span>
                  </div>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={() => setIsConfirmDeleteOpen(true)}
                      className="h-11 px-5 rounded-xl border border-stroke/50 text-focus hover:text-primary hover:border-primary/40 hover:bg-primary/5 font-medium text-sm flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4 text-primary" />
                      <span>Delete User</span>
                    </Button>

                    <Button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleStartEdit}
                      className="h-11 px-6 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                    >
                      <Pencil className="h-4 w-4" />
                      <span>Edit User</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Edit / Save Changes */}
      <ConfirmationDialog
        open={isConfirmEditOpen}
        onOpenChange={setIsConfirmEditOpen}
        title="Confirm User Changes"
        description={
          <span className="block space-y-2.5">
            <span>
              Are you sure you want to update the profile for{' '}
              <strong className="text-focus">{formData.fullName}</strong>?
            </span>
            {editSelectedCompanies.length > 0 && (
              <span className="block text-xs text-muted-fg">
                Appointed to:{' '}
                <strong className="text-focus">{formatCompanyList(editSelectedCompanies)}</strong>
              </span>
            )}
            {editSelectedCompanies.length > 0 && (
              <span className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {editSelectedCompanies.map((cName) => (
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
        confirmLabel="Yes, Save Changes"
        actionType="edit"
        variant="primary"
        isLoading={isSubmitting}
        onConfirm={handleConfirmSave}
      />

      {/* Confirmation Dialog for Delete */}
      <ConfirmationDialog
        open={isConfirmDeleteOpen}
        onOpenChange={setIsConfirmDeleteOpen}
        title="Delete User"
        description={
          <span>
            Are you sure you want to permanently remove{' '}
            <strong className="text-focus">{user.fullName}</strong> ({user.email})?
            This action cannot be undone.
          </span>
        }
        confirmLabel="Yes, Delete User"
        actionType="delete"
        variant="destructive"
        isLoading={isSubmitting}
        onConfirm={handleConfirmDelete}
      />

      {/* Image Cropper Modal */}
      <ImageCropperModal
        open={isCropperOpen}
        onOpenChange={setIsCropperOpen}
        imageSrc={rawImageForCrop || editProfilePreview}
        onCropComplete={handleCropComplete}
        title="Crop Profile Photo"
      />
    </>
  )
}
