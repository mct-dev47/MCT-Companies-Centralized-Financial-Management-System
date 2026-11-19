import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { FormFieldError } from '@/components/common/FormFieldError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import {
  Plus,
  Trash2,
  X,
  FileText,
  AlertCircle,
  Eye,
  CheckCircle2,
  RotateCw,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { formatRealName } from '@/utils/formatRealName'
import { formatUserFriendlyErrorMessage, notifySuccess } from '@/utils/errorUtils'
import { useSession } from '@/hooks/useSession'
import { type BankAccount } from '@/services/bankService'
import { loanService } from '@/services/loanService'
import {
  pettyCashService,
  type PettyCashLedgerEntry,
  type PettyCashCategory,
} from '@/services/pettyCashService'
import { particularsService, type CompanyParticular } from '@/services/particularsService'
import { cn } from '@/lib/utils'

export interface ReimbursementModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  company: string
  currentBalance?: number | null
  unreservedBalance?: number | null
  unreservedBalances?: Record<string, number>
  companies?: string[]
  bankAccounts?: BankAccount[]
  banksLoading?: boolean
  banksError?: string | null
  onRetryBanks?: () => void
  onSuccess?: (newRecord?: PettyCashLedgerEntry) => void
}

export interface ReimbursementLineItem {
  id: string
  particulars: string
  amount: string
  isPartialError?: boolean
}

export interface UploadedFileItem {
  id: string
  file?: File
  name: string
  size: number
  type: string
  status: 'uploading' | 'uploaded' | 'failed'
  url?: string
  error?: string
}

const todayIso = () => formatToYYYYMMDD(new Date())

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export const ReimbursementModal: React.FC<ReimbursementModalProps> = ({
  open,
  onOpenChange,
  company,
  currentBalance = 0,
  unreservedBalance,
  unreservedBalances,
  companies = [],
  bankAccounts: _initialBankAccounts,
  banksLoading: _banksLoading = false,
  banksError: _banksError = null,
  onRetryBanks: _onRetryBanks,
  onSuccess,
}) => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const canEditPaidBy = ['admin', 'superadmin', 'finance', 'supervisor', 'owner'].includes(userRole)

  // Form Fields
  const [expenseDate, setExpenseDate] = React.useState(todayIso)
  const [requestingCompany, setRequestingCompany] = React.useState(company)
  const [paidBy, setPaidBy] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [remarks, setRemarks] = React.useState('')

  // Company-Scoped Configurable Categories
  const [companyCategories, setCompanyCategories] = React.useState<PettyCashCategory[]>([])
  const [isLoadingCategories, setIsLoadingCategories] = React.useState(false)
  const [isAddingCategory, setIsAddingCategory] = React.useState(false)
  const [isCategoryManaging, setIsCategoryManaging] = React.useState(false)
  const [newCategoryName, setNewCategoryName] = React.useState('')
  const [isSubmittingCategory, setIsSubmittingCategory] = React.useState(false)
  const [categoryError, setCategoryError] = React.useState('')

  // Expense Lines
  const [lines, setLines] = React.useState<ReimbursementLineItem[]>([
    { id: '1', particulars: '', amount: '' },
  ])

  // Receipt Files
  const [attachments, setAttachments] = React.useState<UploadedFileItem[]>([])
  const [isDragging, setIsDragging] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  // Validation & Error States
  const [generalError, setGeneralError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isReviewing, setIsReviewing] = React.useState(false)

  // Discard Confirmation Modal
  const [isDiscardModalOpen, setIsDiscardModalOpen] = React.useState(false)

  // Combobox Saved Particulars
  const [savedParticulars, setSavedParticulars] = React.useState<CompanyParticular[]>([])
  const [activeComboboxId, setActiveComboboxId] = React.useState<string | null>(null)
  const [activeHighlightIndex, setActiveHighlightIndex] = React.useState(-1)
  const comboboxContainerRef = React.useRef<HTMLDivElement | null>(null)

  // Companies Data
  const [dbCompanies, setDbCompanies] = React.useState<string[]>([])

  // Load companies
  React.useEffect(() => {
    let mounted = true
    if (open && companies.length === 0) {
      loanService.getCompanies().then((comps) => {
        if (mounted && comps && comps.length > 0) {
          setDbCompanies(comps.map((c) => c.company_name).filter(Boolean))
        }
      }).catch(() => {})
    }
    return () => {
      mounted = false
    }
  }, [open, companies.length])

  // Load categories for selected company
  const loadCategories = React.useCallback(async (comp: string) => {
    if (!comp || comp === 'All Companies') return
    setIsLoadingCategories(true)
    try {
      const list = await pettyCashService.getCompanyCategories(comp)
      setCompanyCategories(list)
      setCategory((prev) => {
        if (prev && list.some((c) => c.name.toLowerCase() === prev.toLowerCase())) return prev
        return list.length > 0 ? list[0].name : ''
      })
    } catch (err) {
      console.warn('Failed to load categories for', comp, err)
      setCompanyCategories([])
      setCategory('')
    } finally {
      setIsLoadingCategories(false)
    }
  }, [])

  React.useEffect(() => {
    if (open && requestingCompany) {
      loadCategories(requestingCompany)
    }
  }, [open, requestingCompany, loadCategories])

  const handleCreateCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      setCategoryError('Category name cannot be empty.')
      return
    }
    setIsSubmittingCategory(true)
    setCategoryError('')
    try {
      const created = await pettyCashService.createCompanyCategory(requestingCompany, trimmed)
      const updated = [...companyCategories, created].sort((a, b) => a.name.localeCompare(b.name))
      setCompanyCategories(updated)
      setCategory(created.name)
      setNewCategoryName('')
      setIsAddingCategory(false)
      notifySuccess(`Category "${created.name}" created for ${requestingCompany}.`)
      if (fieldErrors.category) {
        setFieldErrors((prev) => {
          const next = { ...prev }
          delete next.category
          return next
        })
      }
    } catch (err: any) {
      setCategoryError(formatUserFriendlyErrorMessage(err, 'Failed to create category.'))
    } finally {
      setIsSubmittingCategory(false)
    }
  }

  const handleDeleteCategory = async (catId: number, catName: string) => {
    try {
      await pettyCashService.deleteCompanyCategory(catId)
      const updated = companyCategories.filter((c) => c.category_id !== catId)
      setCompanyCategories(updated)
      if (category.toLowerCase() === catName.toLowerCase()) {
        setCategory(updated.length > 0 ? updated[0].name : '')
      }
      notifySuccess(`Category "${catName}" removed.`)
    } catch (err: any) {
      setCategoryError(formatUserFriendlyErrorMessage(err, 'Failed to delete category.'))
    }
  }

  // Load saved particulars for current company
  React.useEffect(() => {
    let mounted = true
    if (open && requestingCompany) {
      particularsService.getParticulars(requestingCompany).then((list) => {
        if (mounted) setSavedParticulars(list)
      }).catch(() => {})
    }
    return () => {
      mounted = false
    }
  }, [open, requestingCompany])

  // Effective unreserved petty cash balance for the selected company
  const effectiveUnreservedBalance = React.useMemo(() => {
    if (
      unreservedBalances &&
      requestingCompany &&
      typeof unreservedBalances[requestingCompany] === 'number'
    ) {
      return unreservedBalances[requestingCompany]
    }
    return unreservedBalance ?? currentBalance ?? 0
  }, [unreservedBalances, requestingCompany, unreservedBalance, currentBalance])

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      const initialComp =
        company && company !== 'All Companies'
          ? company
          : user?.assignedCompany || 'MCT Kitchen'
      setRequestingCompany(initialComp)
      setExpenseDate(todayIso())
      setPaidBy(formatRealName(user?.fullName || user?.fullName || user?.email || user?.email || ''))
      setRemarks('')
      setLines([{ id: '1', particulars: '', amount: '' }])
      setAttachments([])
      setGeneralError('')
      setFieldErrors({})
      setIsSubmitting(false)
      setIsReviewing(false)
      setIsDiscardModalOpen(false)
      setActiveComboboxId(null)
      setIsAddingCategory(false)
      setIsCategoryManaging(false)
      setNewCategoryName('')
      setCategoryError('')
    }
  }, [open, company, user])

  // Close combobox when clicking outside
  React.useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (comboboxContainerRef.current && !comboboxContainerRef.current.contains(e.target as Node)) {
        setActiveComboboxId(null)
      }
    }
    document.addEventListener('mousedown', handleDocClick)
    return () => document.removeEventListener('mousedown', handleDocClick)
  }, [])

  // Check if form has unsaved modifications
  const isDirty = React.useMemo(() => {
    const hasLineContent = lines.some((l) => l.particulars.trim() || l.amount.trim())
    const hasAttachments = attachments.length > 0
    const hasRemarks = Boolean(remarks.trim())
    return hasLineContent || hasAttachments || hasRemarks
  }, [lines, attachments, remarks])

  // Safe Close Handler: prompts discard if dirty
  const handleRequestClose = () => {
    if (isDirty && !isSubmitting) {
      setIsDiscardModalOpen(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleConfirmDiscard = () => {
    setIsDiscardModalOpen(false)
    onOpenChange(false)
  }

  const availableCompanies = React.useMemo(() => {
    const list = companies.length > 0 ? companies : dbCompanies
    return list.filter((c) => c && c !== 'All Companies')
  }, [companies, dbCompanies])

  // Live Auto-calculated Total
  const grandTotal = React.useMemo(() => {
    return lines.reduce((acc, line) => {
      const val = parseFloat(line.amount)
      return acc + (!isNaN(val) && val > 0 ? val : 0)
    }, 0)
  }, [lines])

  // Line Item Handlers
  const handleLineChange = (id: string, field: 'particulars' | 'amount', value: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const updated = { ...l, [field]: value }
        // Clear partial error when user types
        if (updated.particulars.trim() && parseFloat(updated.amount) > 0) {
          updated.isPartialError = false
        }
        return updated
      })
    )
    if (fieldErrors.lines) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next.lines
        return next
      })
    }
  }

  const handleAddLine = () => {
    const newId = String(Date.now())
    setLines((prev) => [...prev, { id: newId, particulars: '', amount: '' }])
    setTimeout(() => {
      const input = document.getElementById(`particulars-input-${newId}`)
      input?.focus()
    }, 50)
  }

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 1) {
      // Clearing instead of deleting the last remaining row
      setLines([{ id: lines[0].id, particulars: '', amount: '' }])
      return
    }
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  // Keyboard Navigation: Enter in last Amount cell adds a row
  const handleAmountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (index === lines.length - 1) {
        handleAddLine()
      } else {
        const nextId = lines[index + 1].id
        const nextInput = document.getElementById(`amount-input-${nextId}`)
        nextInput?.focus()
      }
    }
  }

  // Combobox helper: save to company list
  const handleSaveParticularToList = async (name: string, lineId: string) => {
    const trimmed = name.trim()
    if (!trimmed || !requestingCompany) return
    try {
      const saved = await particularsService.addParticular(requestingCompany, trimmed)
      if (saved) {
        setSavedParticulars((prev) => [saved, ...prev.filter((p) => p.name.toLowerCase() !== trimmed.toLowerCase())])
      }
    } catch {
      // ignore
    } finally {
      handleLineChange(lineId, 'particulars', trimmed)
      setActiveComboboxId(null)
      const amtInput = document.getElementById(`amount-input-${lineId}`)
      amtInput?.focus()
    }
  }

  // File Upload Handlers (Images: JPG, PNG, HEIC, WEBP, and PDF; Max 5 MB each; Multiple files)
  const processFiles = (files: FileList | File[]) => {
    const fileList = Array.from(files)
    if (fileList.length === 0) return

    const validExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.pdf']

    fileList.forEach((file) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
      const isValidType =
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        validExtensions.includes(ext)

      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      if (!isValidType) {
        setAttachments((prev) => [
          ...prev,
          {
            id: fileId,
            file,
            name: file.name,
            size: file.size,
            type: file.type || 'unknown',
            status: 'failed',
            error: 'Unsupported format. Use JPG, PNG, HEIC, or PDF.',
          },
        ])
        return
      }

      if (file.size > 5 * 1024 * 1024) {
        setAttachments((prev) => [
          ...prev,
          {
            id: fileId,
            file,
            name: file.name,
            size: file.size,
            type: file.type || 'unknown',
            status: 'failed',
            error: 'Exceeds max 5 MB file size limit.',
          },
        ])
        return
      }

      // Add as uploading
      const newItem: UploadedFileItem = {
        id: fileId,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        status: 'uploading',
      }
      setAttachments((prev) => [...prev, newItem])

      // Perform upload
      uploadSingleFile(newItem)
    })
  }

  const uploadSingleFile = async (item: UploadedFileItem) => {
    if (!item.file) return
    try {
      const res = await pettyCashService.uploadReceipt(item.file)
      setAttachments((prev) =>
        prev.map((att) =>
          att.id === item.id
            ? { ...att, status: 'uploaded', url: res.url, error: undefined }
            : att
        )
      )
    } catch (err: any) {
      // Receipts only ever go to the storage bucket. (This used to fall back to an inline base64
      // copy, which is how receipt files ended up saved in the database.) Show why, and let them retry.
      const reason = err instanceof Error && err.message ? err.message : 'Upload failed.'
      setAttachments((prev) =>
        prev.map((att) =>
          att.id === item.id
            ? { ...att, status: 'failed', error: `${reason} Click retry or remove.` }
            : att
        )
      )
    }
  }

  const handleRetryFile = (item: UploadedFileItem) => {
    setAttachments((prev) =>
      prev.map((att) => (att.id === item.id ? { ...att, status: 'uploading', error: undefined } : att))
    )
    uploadSingleFile(item)
  }

  const handleViewReceipt = (url?: string, _name?: string) => {
    if (!url) return
    if (url.startsWith('data:')) {
      try {
        const parts = url.split(',')
        const mimeMatch = parts[0].match(/:(.*?);/)
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
        const byteCharacters = atob(parts[1])
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: mime })
        const blobUrl = URL.createObjectURL(blob)
        window.open(blobUrl, '_blank')
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
      } catch {
        const win = window.open('')
        if (win) {
          win.document.write(`<iframe src="${url}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%;" allowfullscreen></iframe>`)
        }
      }
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id))
  }

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files)
    }
  }

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setGeneralError('')
    setFieldErrors({})

    const errors: Record<string, string> = {}

    if (!expenseDate) {
      errors.date = 'Date of expense is required.'
    } else if (expenseDate > todayIso()) {
      errors.date = 'Date of expense cannot be in the future.'
    }

    if (!requestingCompany.trim()) {
      errors.company = 'Please select a company.'
    }

    if (!paidBy.trim()) {
      errors.paidBy = 'Please enter employee name.'
    }

    if (!category.trim() || companyCategories.length === 0) {
      errors.category = 'Please add and select a category for this company.'
    }

    // Lines validation
    let hasPartialLine = false
    const validLines: Array<{ particulars: string; amount: number }> = []

    const updatedLines = lines.map((line) => {
      const part = line.particulars.trim()
      const amt = parseFloat(line.amount)
      const hasPart = Boolean(part)
      const hasAmt = !isNaN(amt) && amt > 0

      if ((hasPart && !hasAmt) || (!hasPart && hasAmt)) {
        hasPartialLine = true
        return { ...line, isPartialError: true }
      }

      if (hasPart && hasAmt) {
        validLines.push({
          particulars: part,
          amount: Math.round(amt * 100) / 100,
        })
        return { ...line, isPartialError: false }
      }

      return { ...line, isPartialError: false }
    })

    setLines(updatedLines)

    if (hasPartialLine) {
      errors.lines = 'Please complete all partially filled expense lines.'
    } else if (validLines.length === 0) {
      errors.lines = 'At least one line item with particulars and an amount > ₱0.00 is required.'
    }

    const totalAmount = validLines.reduce((acc, l) => acc + l.amount, 0)
    const roundedTotal = Math.round(totalAmount * 100) / 100

    // Check if any file is still uploading
    const isFileUploading = attachments.some((att) => att.status === 'uploading')
    if (isFileUploading) {
      setGeneralError('Please wait for files to finish uploading before submitting.')
      return
    }
    // A failed upload is never sent (it would just vanish from the request), so ask to fix it first
    if (attachments.some((att) => att.status === 'failed')) {
      setGeneralError('A receipt did not upload. Retry it or remove it before submitting.')
      return
    }

    if (roundedTotal > effectiveUnreservedBalance) {
      errors.lines = `Total expense (${formatPHP(roundedTotal)}) exceeds available unreserved petty cash (${formatPHP(effectiveUnreservedBalance)}).`
    }

    // If there are validation errors, block submit
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setGeneralError('Please fix the highlighted fields before submitting.')
      return
    }

    if (!isReviewing) {
      setIsReviewing(true)
      return
    }

    setIsSubmitting(true)

    try {
      const uploadedAttachments = attachments
        .filter((att) => att.status === 'uploaded' && att.url)
        .map((att) => ({
          file_url: att.url,
          file_name: att.name,
          file_size: att.size,
          mime_type: att.type,
        }))

      const combinedDescription = validLines.map((l) => l.particulars).join(', ')
      const primaryReceiptUrl = uploadedAttachments[0]?.file_url || null
      const httpReceiptUrl =
        primaryReceiptUrl && primaryReceiptUrl.startsWith('data:') ? null : primaryReceiptUrl
      const attachmentsJson = uploadedAttachments.length > 0 ? JSON.stringify(uploadedAttachments) : null

      await pettyCashService.createTopUp({
        company: requestingCompany,
        company_name: requestingCompany,
        amount: 0,
        date: expenseDate,
        description: combinedDescription,
        status: 'Settled',
        request_type: 'reimbursement',
        paid_by: paidBy.trim(),
        receipt_url: httpReceiptUrl,
        attachments: attachmentsJson,
        items: JSON.stringify(validLines),
        category: category.trim(),
        total_expenses: roundedTotal,
        company_funded_amount: roundedTotal,
        employee_out_of_pocket: 0,
        existing_expense_id: null,
      })

      notifySuccess('Petty cash expense recorded successfully.')

      const newEntry: PettyCashLedgerEntry = {
        id: `pc-${Date.now()}`,
        recordId: Date.now(),
        type: 'expense',
        requestType: 'replenishment_disbursement',
        companyName: requestingCompany,
        date: expenseDate,
        description: combinedDescription,
        category: category.trim(),
        paidBy: paidBy.trim(),
        receiptUrl: primaryReceiptUrl,
        attachments: attachmentsJson,
        items: JSON.stringify(validLines),
        amountRequested: roundedTotal,
        totalExpenses: roundedTotal,
        companyFundedAmount: roundedTotal,
        employeeOutOfPocket: 0,
        amountIn: 0,
        amountOut: roundedTotal,
        runningBalance: currentBalance || 0,
        status: '',
        auditStatus: 'Pending Audit',
        createdAt: new Date().toISOString(),
      }

      onSuccess?.(newEntry)
      onOpenChange(false)
    } catch (err: any) {
      const msg = formatUserFriendlyErrorMessage(err, 'Failed to record petty cash expense.')
      setGeneralError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isUploadingActive = attachments.some((att) => att.status === 'uploading')

  return (
    <>
      <Dialog open={open} onOpenChange={handleRequestClose}>
        <DialogContent
          className="sm:max-w-[700px] lg:max-w-[740px] max-h-[90vh] overflow-y-auto rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl"
          onPointerDownOutside={(e) => {
            if (isDirty) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (isDirty) {
              e.preventDefault()
              setIsDiscardModalOpen(true)
            }
          }}
        >
          {/* 1. Header */}
          <DialogHeader className="text-left pb-3.5 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                  Record Petty Expense
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
                  Record an expense paid from company petty cash.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            {/* 2. Details Section (2-Column Grid) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Row 1, Left: Date of Expense */}
              <div className="space-y-1">
                <Label htmlFor="expense-date" className="text-xs font-semibold text-focus">
                  Date of expense <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="expense-date"
                    type="date"
                    value={expenseDate}
                    max={todayIso()}
                    onChange={(e) => {
                      setExpenseDate(e.target.value)
                      if (fieldErrors.date) {
                        setFieldErrors((prev) => {
                          const n = { ...prev }
                          delete n.date
                          return n
                        })
                      }
                    }}
                    required
                    className={cn(
                      'h-10 rounded-xl border bg-white text-xs text-focus shadow-2xs focus-visible:ring-1 focus-visible:ring-focus',
                      fieldErrors.date ? 'border-red-500 ring-1 ring-red-500' : 'border-stroke/50'
                    )}
                  />
                </div>
                <FormFieldError error={fieldErrors.date} />
              </div>

              {/* Row 1, Right: Company */}
              <div className="space-y-1">
                <Label htmlFor="reimbursement-company" className="text-xs font-semibold text-focus">
                  Company <span className="text-red-500">*</span>
                </Label>
                <Dropdown
                  id="reimbursement-company"
                  value={requestingCompany}
                  onChange={(val) => {
                    setRequestingCompany(String(val))
                    if (fieldErrors.company) {
                      setFieldErrors((prev) => {
                        const n = { ...prev }
                        delete n.company
                        return n
                      })
                    }
                  }}
                  options={availableCompanies.map((c) => ({ value: c, label: c }))}
                  error={fieldErrors.company}
                  aria-label="Requesting Company"
                />
                <FormFieldError error={fieldErrors.company} />
              </div>

              {/* Row 2, Left: Paid by */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="reimbursement-paid-by" className="text-xs font-semibold text-focus">
                    Paid by <span className="text-red-500">*</span>
                  </Label>
                  {!canEditPaidBy && (
                    <span className="text-[10.5px] text-muted-fg font-normal">(Logged-in account)</span>
                  )}
                </div>
                <Input
                  id="reimbursement-paid-by"
                  type="text"
                  placeholder="Employee name"
                  value={paidBy}
                  readOnly={!canEditPaidBy}
                  onChange={(e) => {
                    if (canEditPaidBy) setPaidBy(e.target.value)
                    if (fieldErrors.paidBy) {
                      setFieldErrors((prev) => {
                        const n = { ...prev }
                        delete n.paidBy
                        return n
                      })
                    }
                  }}
                  required
                  className={cn(
                    'h-10 rounded-xl border text-xs text-focus shadow-2xs',
                    !canEditPaidBy ? 'bg-slate-50 cursor-not-allowed text-muted-fg' : 'bg-white',
                    fieldErrors.paidBy ? 'border-red-500 ring-1 ring-red-500' : 'border-stroke/50'
                  )}
                />
                <FormFieldError error={fieldErrors.paidBy} />
              </div>

              {/* Row 2, Right: Category (Configurable per company) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="reimbursement-category" className="text-xs font-semibold text-focus">
                    Category <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    {companyCategories.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsCategoryManaging((prev) => !prev)}
                        className="text-[11px] font-semibold text-muted-fg hover:text-focus transition-colors cursor-pointer"
                      >
                        {isCategoryManaging ? 'Done' : 'Manage'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingCategory((prev) => !prev)
                        setCategoryError('')
                        setNewCategoryName('')
                      }}
                      className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{isAddingCategory ? 'Cancel' : 'Add Category'}</span>
                    </button>
                  </div>
                </div>

                {/* Inline Add Category Input */}
                {isAddingCategory && (
                  <div className="p-2.5 rounded-xl border border-primary/30 bg-primary/5 space-y-2 animate-in fade-in-50 duration-150">
                    <div className="text-[11px] font-bold text-focus">
                      New Category for <span className="text-primary">{requestingCompany}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        placeholder="e.g. Office Supplies, Fuel..."
                        value={newCategoryName}
                        onChange={(e) => {
                          setNewCategoryName(e.target.value)
                          if (categoryError) setCategoryError('')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleCreateCategory()
                          }
                        }}
                        className="h-8 rounded-lg text-xs bg-white border-stroke/50 flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={isSubmittingCategory || !newCategoryName.trim()}
                        onClick={handleCreateCategory}
                        className="h-8 px-3 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-white cursor-pointer"
                      >
                        {isSubmittingCategory ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                    <FormFieldError error={categoryError} />
                  </div>
                )}

                {/* Manage / Delete Existing Categories List */}
                {isCategoryManaging && companyCategories.length > 0 && (
                  <div className="p-2 rounded-xl border border-stroke/40 bg-slate-50 space-y-1 max-h-36 overflow-y-auto">
                    <div className="text-[11px] font-semibold text-muted-fg px-1 pb-1 border-b border-stroke/20">
                      Manage {requestingCompany} Categories
                    </div>
                    {companyCategories.map((cat) => (
                      <div
                        key={cat.category_id}
                        className="flex items-center justify-between px-2 py-1 rounded-lg text-xs bg-white border border-stroke/20 hover:bg-slate-100"
                      >
                        <span className="font-medium text-focus truncate">{cat.name}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat.category_id, cat.name)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
                          title={`Delete ${cat.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Category Dropdown or Empty Warning */}
                {isLoadingCategories ? (
                  <div className="h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 flex items-center text-xs text-muted-fg">
                    <RotateCw className="w-3.5 h-3.5 animate-spin mr-2" />
                    <span>Loading categories for {requestingCompany}…</span>
                  </div>
                ) : companyCategories.length === 0 ? (
                  <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/70 text-amber-900 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                      <span>Please add categories</span>
                    </div>
                  </div>
                ) : (
                  <Dropdown
                    id="reimbursement-category"
                    value={category}
                    onChange={(val) => {
                      setCategory(String(val))
                      if (fieldErrors.category) {
                        setFieldErrors((prev) => {
                          const n = { ...prev }
                          delete n.category
                          return n
                        })
                      }
                    }}
                    placeholder="Select a category…"
                    options={companyCategories.map((cat) => ({ value: cat.name, label: cat.name }))}
                    error={fieldErrors.category}
                    aria-label="Expense Category"
                  />
                )}

                <FormFieldError error={fieldErrors.category} />
              </div>
            </div>

            {/* 3. Expense Lines (Small spreadsheet-style table inside modal) */}
            <div className="space-y-2 pt-1" ref={comboboxContainerRef}>
              <div className="rounded-xl border border-stroke/40 overflow-hidden bg-white shadow-2xs">
                {/* Table Header */}
                <div className="grid grid-cols-[1fr_130px_36px] bg-slate-50 border-b border-stroke/30 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                  <div>PARTICULARS</div>
                  <div className="text-right">AMOUNT (₱)</div>
                  <div></div>
                </div>

                {/* Rows */}
                <div className="divide-y divide-stroke/20">
                  {lines.map((line, idx) => {
                    const filteredParticulars = savedParticulars.filter((p) =>
                      p.name.toLowerCase().includes(line.particulars.toLowerCase().trim())
                    )
                    const isComboboxOpen = activeComboboxId === line.id
                    const exactMatch = savedParticulars.some(
                      (p) => p.name.toLowerCase() === line.particulars.trim().toLowerCase()
                    )
                    const showSaveOption =
                      line.particulars.trim().length > 0 && !exactMatch

                    return (
                      <div
                        key={line.id}
                        className={cn(
                          'grid grid-cols-[1fr_130px_36px] items-center px-2 py-1.5 transition-colors relative',
                          line.isPartialError && 'bg-red-50/50'
                        )}
                      >
                        {/* Particulars Input with Dropdown / Free text */}
                        <div className="relative pr-2">
                          <Input
                            id={`particulars-input-${line.id}`}
                            type="text"
                            placeholder="What was bought / paid for"
                            value={line.particulars}
                            onFocus={() => {
                              setActiveComboboxId(line.id)
                              setActiveHighlightIndex(-1)
                            }}
                            onChange={(e) => {
                              handleLineChange(line.id, 'particulars', e.target.value)
                              setActiveComboboxId(line.id)
                              setActiveHighlightIndex(-1)
                            }}
                            className={cn(
                              'h-9 rounded-lg text-xs bg-transparent border-transparent hover:border-stroke/40 focus:border-focus focus:bg-white transition-all',
                              line.isPartialError && !line.particulars.trim() && 'border-red-400 bg-red-50'
                            )}
                          />

                          {/* Particulars Combobox Dropdown */}
                          {isComboboxOpen && (
                            <div className="absolute left-0 top-full mt-1 w-full bg-white rounded-xl border border-stroke/30 shadow-xl p-1 z-50 max-h-48 overflow-y-auto animate-in fade-in-50 zoom-in-95 duration-100">
                              {filteredParticulars.length === 0 && !showSaveOption && (
                                <div className="px-3 py-2 text-[11px] text-muted-fg italic">
                                  No saved particulars yet. Type one to use freely.
                                </div>
                              )}

                              {filteredParticulars.map((p, pIdx) => (
                                <div
                                  key={p.id}
                                  onClick={() => {
                                    handleLineChange(line.id, 'particulars', p.name)
                                    setActiveComboboxId(null)
                                    const amtInput = document.getElementById(`amount-input-${line.id}`)
                                    amtInput?.focus()
                                  }}
                                  className={cn(
                                    'px-3 py-2 rounded-lg text-xs font-medium text-focus hover:bg-slate-50 cursor-pointer flex items-center justify-between',
                                    activeHighlightIndex === pIdx && 'bg-slate-100'
                                  )}
                                >
                                  <span>{p.name}</span>
                                </div>
                              ))}

                              {showSaveOption && (
                                <div
                                  onClick={() => handleSaveParticularToList(line.particulars, line.id)}
                                  className="px-3 py-2 rounded-lg text-xs font-semibold text-primary hover:bg-primary/5 cursor-pointer border-t border-stroke/20 flex items-center gap-1.5 mt-0.5"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Save "{line.particulars.trim()}" to my list</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Amount Input */}
                        <div className="pl-1">
                          <Input
                            id={`amount-input-${line.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={line.amount}
                            onChange={(e) => handleLineChange(line.id, 'amount', e.target.value)}
                            onKeyDown={(e) => handleAmountKeyDown(e, idx)}
                            className={cn(
                              'h-9 text-right font-semibold text-xs tabular-nums bg-transparent border-transparent hover:border-stroke/40 focus:border-focus focus:bg-white transition-all',
                              line.isPartialError && !(parseFloat(line.amount) > 0) && 'border-red-400 bg-red-50'
                            )}
                          />
                        </div>

                        {/* Remove Row Button */}
                        <div className="text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer inline-flex items-center justify-center"
                            title={lines.length > 1 ? 'Remove line' : 'Clear line'}
                            aria-label={lines.length > 1 ? 'Remove line' : 'Clear line'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Below Table Row: "+ Add line" on Left, Live "Total: ₱0.00" on Right */}
              <div className="flex items-center justify-between px-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddLine}
                  className="h-8 px-3 rounded-lg text-xs font-semibold border-stroke/50 text-focus hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5 text-primary" />
                  <span>+ Add line</span>
                </Button>

                <div className="flex items-center gap-3 text-sm font-bold text-focus tabular-nums">
                  <span className="text-xs font-medium text-muted-fg">
                    Available: {formatPHP(effectiveUnreservedBalance)}
                  </span>
                  <span>
                    Total: <span className="text-focus">{formatPHP(grandTotal)}</span>
                  </span>
                </div>
              </div>

              <FormFieldError error={fieldErrors.lines} className="px-1" />
            </div>

            {/* 4. Receipt / Proof Upload (OPTIONAL) */}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-semibold text-focus flex items-center justify-between">
                <span>Receipt / proof (optional)</span>
                <span className="text-[11px] text-muted-fg font-normal">JPG, PNG, HEIC, PDF (Max 5 MB each)</span>
              </Label>

              <input
                id="reimbursement-attachments"
                name="attachments"
                type="file"
                ref={fileInputRef}
                multiple
                accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
                onChange={(e) => {
                  if (e.target.files) processFiles(e.target.files)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                className="hidden"
              />

              {/* Dashed Drop Area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  'border-2 border-dashed rounded-xl p-3 sm:p-3.5 text-center cursor-pointer transition-all flex items-center justify-center gap-2.5',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-stroke/60 hover:border-stroke hover:bg-slate-50/50'
                )}
              >
                <div className="text-xs font-medium text-focus/80 flex items-center gap-2">
                  <span className="text-base leading-none">📎</span>
                  <span>Click to upload receipt (image or PDF) or drag and drop</span>
                </div>
              </div>

              {/* Attachments List */}
              {attachments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className={cn(
                        'p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs transition-colors',
                        att.status === 'failed'
                          ? 'border-red-200 bg-red-50/50 text-red-900'
                          : att.status === 'uploading'
                          ? 'border-slate-200 bg-slate-50/80 text-focus'
                          : 'border-emerald-200 bg-emerald-50/30 text-focus'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {att.status === 'uploading' ? (
                          <div className="w-6 h-6 rounded-md bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 animate-spin">
                            <RotateCw className="w-3.5 h-3.5" />
                          </div>
                        ) : att.status === 'failed' ? (
                          <div className="w-6 h-6 rounded-md bg-red-600 text-white flex items-center justify-center shrink-0">
                            <AlertCircle className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="font-semibold text-xs truncate max-w-[280px] sm:max-w-[360px]" title={att.name}>
                            {att.name}
                          </div>
                          <div className="text-[10px] text-muted-fg flex items-center gap-1.5">
                            <span>{formatFileSize(att.size)}</span>
                            {att.status === 'uploading' && <span className="text-blue-600 font-medium">Uploading…</span>}
                            {att.status === 'failed' && <span className="text-red-600 font-medium">{att.error || 'Failed'}</span>}
                            {att.status === 'uploaded' && <span className="text-emerald-700 font-medium">Attached</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {att.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => handleRetryFile(att)}
                            className="px-2 py-1 rounded-md text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer"
                          >
                            Retry
                          </button>
                        )}
                        {att.status === 'uploaded' && att.url && (
                          <button
                            type="button"
                            onClick={() => handleViewReceipt(att.url, att.name)}
                            className="p-1 rounded-md text-slate-500 hover:text-focus hover:bg-slate-100 transition-colors cursor-pointer"
                            title="View receipt"
                            aria-label="View receipt"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(att.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Remove file"
                          aria-label="Remove file"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 5. Remarks (Optional Textarea) */}
            <div className="space-y-1 pt-1">
              <Label htmlFor="reimbursement-remarks" className="text-xs font-semibold text-focus">
                Remarks (optional)
              </Label>
              <textarea
                id="reimbursement-remarks"
                rows={3}
                placeholder="Add any extra context or notes here…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full rounded-xl border border-stroke/50 bg-white p-3 text-xs text-focus shadow-2xs focus-visible:ring-1 focus-visible:ring-focus outline-none resize-none transition-all placeholder:text-muted-fg/70"
              />
            </div>

            {/* 6. Footer: Error on Left, Cancel & Submit on Right */}
            <div className="pt-3 border-t border-stroke/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                {generalError && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1.5 leading-snug">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                    <span>{generalError}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 shrink-0 self-end sm:self-auto">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (isReviewing) {
                      setIsReviewing(false)
                    } else {
                      handleRequestClose()
                    }
                  }}
                  disabled={isSubmitting}
                  className="h-11 px-5 rounded-[10px] text-xs font-semibold cursor-pointer"
                >
                  {isReviewing ? 'Back to Edit' : 'Cancel'}
                </Button>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSubmitting || isUploadingActive}
                  isLoading={isSubmitting}
                  className="h-11 px-6 rounded-[10px] text-xs font-semibold cursor-pointer"
                >
                  <span>{isReviewing ? 'Submit Petty Expense' : 'Review Petty Expense'}</span>
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Discard Changes Confirmation Modal */}
      <ConfirmModal
        open={isDiscardModalOpen}
        title="Discard changes?"
        description="You have unsaved changes in this petty cash entry. Are you sure you want to discard them?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="destructive"
        actionType="warning"
        onConfirm={handleConfirmDiscard}
        onClose={() => setIsDiscardModalOpen(false)}
      />
    </>
  )
}
