import * as React from 'react'
import {
  Building2,
  Mail,
  Phone,
  User,
  MapPin,
  Bell,
  Camera,
  Crop,
  Trash2,
  RotateCcw,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  BackButton,
  DropdownFilter,
  ErrorBanner,
  ImageCropperModal,
} from '@/components/common'
import { useSession } from '@/hooks/useSession'
import {
  employeeService,
  type Company,
  type CompanyNotificationSettings,
} from '@/services/employeeService'
import { notifyNotificationsUpdated } from '@/services/notificationService'
import {
  notifyError,
  notifySuccess,
  notifyWarning,
} from '@/utils/errorUtils'
import logo2Url from '@/assets/LOGO2.png'

type NotificationSettings = Pick<
  CompanyNotificationSettings,
  'transactionAlerts' | 'loanReminders' | 'dailySummary' | 'auditAlerts'
>

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  transactionAlerts: true,
  loanReminders: true,
  dailySummary: false,
  auditAlerts: true,
}

export const SettingsPage: React.FC = () => {
  const { user, updateUser } = useSession()
  const isAuditor = user?.role === 'Supervisor'
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  // Company data states
  const [companies, setCompanies] = React.useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [successBanner, setSuccessBanner] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Form Fields
  const [companyName, setCompanyName] = React.useState('')
  const [contactPerson, setContactPerson] = React.useState('')
  const [telephoneNumber, setTelephoneNumber] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [logoUrl, setLogoUrl] = React.useState<string>(logo2Url)
  const [logoFile, setLogoFile] = React.useState<File | null>(null)
  const [isCropperOpen, setIsCropperOpen] = React.useState(false)
  const [imageToCrop, setImageToCrop] = React.useState<string | null>(null)

  // Toggle Switches: Notifications
  const [notificationSettings, setNotificationSettings] =
    React.useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)
  const [savedNotificationSettings, setSavedNotificationSettings] =
    React.useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)

  // Load notification settings for target company ID
  const loadNotificationSettingsForCompany = React.useCallback(
    async (companyId: string) => {
      if (!companyId) return
      try {
        const loaded = await employeeService.getCompanyNotificationSettings(companyId)
        const normalized: NotificationSettings = {
          transactionAlerts: loaded.transactionAlerts,
          loanReminders: loaded.loanReminders,
          dailySummary: loaded.dailySummary,
          auditAlerts: loaded.auditAlerts,
        }
        setNotificationSettings(normalized)
        setSavedNotificationSettings(normalized)
      } catch {
        setNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
        setSavedNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
      }
    },
    []
  )

  // Populate state with target company
  const populateCompanyData = React.useCallback(
    (target: Company, fetchSettings = true) => {
      setSelectedCompanyId(target.id)
      setCompanyName(target.name)
      setContactPerson(target.contactPerson || '')
      setTelephoneNumber(target.telephoneNumber || target.contactNumber || '')
      setEmail(target.email || '')
      setAddress(target.address)
      setLogoUrl(target.logoUrl || logo2Url)
      if (fetchSettings) {
        void loadNotificationSettingsForCompany(target.id)
      }
    },
    [loadNotificationSettingsForCompany]
  )

  // Load companies from employeeService
  const loadCompanies = React.useCallback(async () => {
    try {
      setLoading(true)
      const list = await employeeService.getCompanies()
      setCompanies(list)

      let target: Company | undefined
      if (isAuditor) {
        target = list.find(
          (c) => c.name.toLowerCase() === assignedCompany.toLowerCase()
        )
      }
      if (!target && list.length > 0) {
        target = list[0]
      }

      if (target) {
        populateCompanyData(target, true)
      }
    } finally {
      setLoading(false)
    }
  }, [isAuditor, assignedCompany, populateCompanyData])

  React.useEffect(() => {
    void loadCompanies()
  }, [loadCompanies])

  // Auto-dismiss success banner
  React.useEffect(() => {
    if (successBanner) {
      const timer = setTimeout(() => setSuccessBanner(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [successBanner])

  // Profile image upload handler (opens cropper)
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      notifyWarning('File size exceeds 5MB limit. Please upload a smaller image.')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      if (e.target?.result) {
        setImageToCrop(e.target.result as string)
        setIsCropperOpen(true)
      }
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleOpenCropperForCurrent = () => {
    if (logoUrl) {
      setImageToCrop(logoUrl)
      setIsCropperOpen(true)
    }
  }

  const handleCropComplete = (croppedDataUrl: string, croppedFile: File) => {
    setLogoUrl(croppedDataUrl)
    setLogoFile(croppedFile)
    setIsCropperOpen(false)
    updateUser({ avatarUrl: croppedDataUrl })
  }

  // Reset image to default
  const handleRemoveImage = () => {
    setLogoUrl(logo2Url)
    setLogoFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    updateUser({ avatarUrl: logo2Url })
  }

  // Save changes handler
  const handleSaveChanges = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!selectedCompanyId) return

    try {
      setSaving(true)
      const results = await Promise.allSettled([
        employeeService.updateCompany(selectedCompanyId, {
          name: companyName,
          contactPerson,
          telephoneNumber,
          contactNumber: telephoneNumber,
          email,
          address,
          logoUrl: logoFile ? undefined : logoUrl,
          logoFile: logoFile || undefined,
        }),
        employeeService.updateCompanyNotificationSettings(
          selectedCompanyId,
          notificationSettings
        ),
      ])

      const [companyResult, notifResult] = results
      let hasError = false

      if (notifResult.status === 'fulfilled') {
        const updatedSettings = notifResult.value
        const persistedNotifs: NotificationSettings = {
          transactionAlerts: updatedSettings.transactionAlerts,
          loanReminders: updatedSettings.loanReminders,
          dailySummary: updatedSettings.dailySummary,
          auditAlerts: updatedSettings.auditAlerts,
        }
        setNotificationSettings(persistedNotifs)
        setSavedNotificationSettings(persistedNotifs)
        notifyNotificationsUpdated()
      } else {
        hasError = true
        notifyError(notifResult.reason, 'Failed to update notification settings.')
      }

      if (companyResult.status === 'fulfilled') {
        const updated = companyResult.value
        setLogoFile(null)
        const finalAvatar = updated.logoUrl || logoUrl
        if (updated.logoUrl) {
          setLogoUrl(updated.logoUrl)
        }
        updateUser({ avatarUrl: finalAvatar })

        setCompanies((prev) =>
          prev.map((c) =>
            c.id === selectedCompanyId
              ? {
                  ...c,
                  name: updated.name || companyName,
                  contactPerson,
                  telephoneNumber,
                  email,
                  address,
                  logoUrl: updated.logoUrl || logoUrl,
                }
              : c
          )
        )
      } else {
        hasError = true
        notifyError(companyResult.reason, 'Failed to update company profile.')
      }

      if (!hasError) {
        const msg = 'Company profile and settings have been saved successfully.'
        setSuccessBanner(msg)
        notifySuccess(msg)
      } else if (companyResult.status === 'fulfilled' || notifResult.status === 'fulfilled') {
        setSuccessBanner('Some settings saved, but other changes encountered errors.')
      }
    } catch (err) {
      notifyError(err, 'Failed to save settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Discard changes
  const handleDiscardChanges = () => {
    const original = companies.find((c) => c.id === selectedCompanyId)
    if (original) {
      populateCompanyData(original, false)
    }
    setNotificationSettings(savedNotificationSettings)
  }

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId)
  const companyOptions = React.useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name })),
    [companies]
  )

  return (
    <div className="space-y-6 sm:space-y-8 max-w-[1600px] w-full mx-auto pb-16 animate-in fade-in duration-300">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <BackButton className="mb-2" />
          <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
            Settings
          </h1>
          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
            Manage company profile and notification preferences.
          </p>
        </div>

        {/* Right Action Controls: Company Selector (Admin) & Save Changes */}
        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto shrink-0">
          {/* Company Selector Dropdown (Admin only) */}
          {!isAuditor && companies.length > 0 && (
            <DropdownFilter
              value={selectedCompanyId}
              placeholder="Select Company"
              menuTitle="Configuring Company"
              icon={Building2}
              options={companyOptions}
              onChange={(companyId) => {
                const found = companies.find((c) => c.id === companyId)
                if (found) populateCompanyData(found)
              }}
              ariaLabel="Select company to configure"
            />
          )}

          {/* Discard Changes Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleDiscardChanges}
            disabled={saving || loading}
            className="h-10 sm:h-11 px-4 rounded-xl border border-stroke/60 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border"
          >
            <RotateCcw className="h-3.5 w-3.5 text-focus/70 shrink-0" />
            <span className="hidden sm:inline">Discard</span>
          </Button>

          {/* Save Changes Button */}
          <Button
            type="button"
            onClick={() => void handleSaveChanges()}
            disabled={saving || loading}
            className="h-10 sm:h-11 px-5 rounded-xl bg-primary hover:bg-primary-hover active:bg-primary-active text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
          >
            {saving ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4 shrink-0 text-white" />
                <span>Save Changes</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Success Notification Banner */}
      <ErrorBanner
        variant="success"
        message={successBanner}
        onDismiss={() => setSuccessBanner(null)}
      />

      {/* 2. Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 items-stretch">
        {/* Left Column (2 Cols): Company Profile */}
        <div className="lg:col-span-2 flex flex-col">
          {/* Card 1: Company Profile Picture & Basic Info */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs h-full flex flex-col justify-between">
            <div>
              {/* Section Header */}
              <div className="flex items-center justify-between pb-5 border-b border-stroke/20 mb-6">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-focus">
                    Company Profile
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-fg mt-0.5">
                    General details and branding configuration for {companyName || 'your company'}.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                  {selectedCompany?.status || 'Active'}
                </span>
              </div>

              <form onSubmit={handleSaveChanges} className="space-y-6">
                {/* Profile Picture Section */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-4 rounded-2xl bg-slate-50/80 border border-slate-200/60">
                  <div className="relative group shrink-0">
                    <div className="h-24 w-24 rounded-2xl border-2 border-stroke/40 bg-white overflow-hidden shadow-xs flex items-center justify-center p-2">
                      <img
                        src={logoUrl}
                        alt="Company Profile"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute inset-0 bg-black/40 text-white rounded-2xl flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Change Profile Picture"
                    >
                      <Camera className="h-5 w-5 mb-0.5" />
                      <span className="text-[10px] font-semibold">Change</span>
                    </button>
                    <input
                      id="settings-company-logo"
                      name="companyLogo"
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </div>

                  <div className="space-y-2 flex-1">
                    <div>
                      <label className="text-xs sm:text-sm font-bold text-focus block">
                        Company Profile Picture
                      </label>
                      <p className="text-xs text-muted-fg mt-0.5">
                        Recommended square format: PNG, JPG, or WEBP (Max size: 5MB).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-9 px-3.5 rounded-full text-xs font-semibold text-focus hover:bg-surface border-stroke/60 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      >
                        <Camera className="h-3.5 w-3.5 text-muted-fg" />
                        <span>Upload New Image</span>
                      </Button>
                      {logoUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleOpenCropperForCurrent}
                          className="h-9 px-3 rounded-full text-xs font-semibold text-focus hover:bg-surface border-stroke/60 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        >
                          <Crop className="h-3.5 w-3.5 text-muted-fg" />
                          <span>Crop / Zoom</span>
                        </Button>
                      )}
                      {logoUrl !== logo2Url && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveImage}
                          className="h-9 px-3 rounded-full text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer flex items-center gap-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Reset to Default</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Form Input Fields Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  {/* Company Name */}
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold text-focus flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-fg" />
                      <span>Company Name</span>
                      <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Enter company name"
                      required
                      className="h-11 rounded-xl border border-stroke/60 bg-white text-sm text-focus shadow-xs focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </div>

                  {/* Contact Person */}
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold text-focus flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-fg" />
                      <span>Contact Person</span>
                      <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="text"
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      placeholder="Enter contact person"
                      required
                      className="h-11 rounded-xl border border-stroke/60 bg-white text-sm text-focus shadow-xs focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </div>

                  {/* Telephone Number */}
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold text-focus flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-fg" />
                      <span>Telephone Number</span>
                      <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="tel"
                      value={telephoneNumber}
                      onChange={(e) => setTelephoneNumber(e.target.value)}
                      placeholder="(02) 8000-0000 or +63 900 000 0000"
                      required
                      className="h-11 rounded-xl border border-stroke/60 bg-white text-sm text-focus shadow-xs focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold text-focus flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-fg" />
                      <span>Email Address</span>
                      <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="corporate@mctgroup.com"
                      required
                      className="h-11 rounded-xl border border-stroke/60 bg-white text-sm text-focus shadow-xs focus-visible:ring-2 focus-visible:ring-focus"
                    />
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-focus flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-fg" />
                    <span>Business Address</span>
                    <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street address, building, district, city, zip"
                    required
                    className="h-11 rounded-xl border border-stroke/60 bg-white text-sm text-focus shadow-xs focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </div>
              </form>
            </div>
          </Card>
        </div>

        {/* Right Column (1 Col): Notifications */}
        <div className="lg:col-span-1 flex flex-col">
          {/* Card: Notification Preferences */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs h-full flex flex-col justify-between">
            <div className="flex items-center gap-3 pb-4 border-b border-stroke/20 shrink-0">
              <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shrink-0">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-focus leading-tight">
                  Notification Alerts
                </h2>
                <p className="text-xs text-muted-fg mt-0.5">
                  Configure financial events and automated alerts.
                </p>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-between py-2 space-y-4">
              {/* Transaction Outflow Alerts */}
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl hover-item">
                <div className="space-y-0.5">
                  <span className="text-xs sm:text-sm font-semibold text-focus block">
                    Large Transaction Alerts
                  </span>
                  <p className="text-2xs sm:text-xs text-muted-fg">
                    Notify immediately when single withdrawals or expenses exceed ₱50,000.
                  </p>
                </div>
                <Switch
                  id="notif-tx-toggle"
                  checked={notificationSettings.transactionAlerts}
                  onCheckedChange={(val) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      transactionAlerts: val,
                    }))
                  }
                  aria-label="Toggle Large Transaction Alerts"
                />
              </div>

              {/* Loan Due Date Reminders */}
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl hover-item">
                <div className="space-y-0.5">
                  <span className="text-xs sm:text-sm font-semibold text-focus block">
                    Loan Due Date Reminders
                  </span>
                  <p className="text-2xs sm:text-xs text-muted-fg">
                    Receive advance alerts 3 days prior to loan maturity and repayment deadlines.
                  </p>
                </div>
                <Switch
                  id="notif-loan-toggle"
                  checked={notificationSettings.loanReminders}
                  onCheckedChange={(val) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      loanReminders: val,
                    }))
                  }
                  aria-label="Toggle Loan Due Date Reminders"
                />
              </div>

              {/* Daily Financial Summary */}
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl hover-item">
                <div className="space-y-0.5">
                  <span className="text-xs sm:text-sm font-semibold text-focus block">
                    Daily Financial Digest
                  </span>
                  <p className="text-2xs sm:text-xs text-muted-fg">
                    Automated end-of-day summary email of daily sales, expenses, and net liquidity.
                  </p>
                </div>
                <Switch
                  id="notif-digest-toggle"
                  checked={notificationSettings.dailySummary}
                  onCheckedChange={(val) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      dailySummary: val,
                    }))
                  }
                  aria-label="Toggle Daily Financial Digest"
                />
              </div>

              {/* Audit & Modification Alerts */}
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl hover-item">
                <div className="space-y-0.5">
                  <span className="text-xs sm:text-sm font-semibold text-focus block">
                    Audit Status Updates
                  </span>
                  <p className="text-2xs sm:text-xs text-muted-fg">
                    Alert whenever transactions are marked approved, pending review, or voided.
                  </p>
                </div>
                <Switch
                  id="notif-audit-toggle"
                  checked={notificationSettings.auditAlerts}
                  onCheckedChange={(val) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      auditAlerts: val,
                    }))
                  }
                  aria-label="Toggle Audit Status Updates"
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Image Cropper Modal */}
      <ImageCropperModal
        open={isCropperOpen}
        onOpenChange={setIsCropperOpen}
        imageSrc={imageToCrop}
        onCropComplete={handleCropComplete}
        initialShape="square"
        title="Crop & Zoom Company Photo"
      />
    </div>
  )
}
