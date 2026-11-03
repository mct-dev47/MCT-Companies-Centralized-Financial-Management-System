import * as React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft,
  Plus,
  Trash2,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Calendar,
  Building2,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Tag,
  CreditCard,
  Landmark,
  User,
  Receipt,
} from 'lucide-react'
import { receivablesStore, type CustomerType } from '@/services/receivablesStore'
import { receivablesService } from '@/services/receivablesService'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { BackButton, ErrorBanner } from '@/components/common'
import { notifyWarning } from '@/utils/errorUtils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { salesService } from '@/services/salesService'
import { expenseService } from '@/services/expenseService'
import { pettyCashService } from '@/services/pettyCashService'
import { loanService, type CompanyOption } from '@/services/loanService'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import {
  formatParticularsString,
  parseParticulars,
  normalizeParticularStatus,
  deriveRecordStatusFromParticulars,
  type ParticularItem,
} from '@/utils/particularsUtils'
import { cn } from '@/lib/utils'
import { SALES_CATEGORY_LIST } from '@/utils/categoryConstants'
import { bankService, type BankAccount } from '@/services/bankService'
import { isCompanyMatch } from '@/utils/companyUtils'

export interface UnpaidAssignmentRow {
  rowId: string
  saleLineIndex: number
  particulars: string
  quantity: number
  unitPrice: number
  total: number
  customerType: CustomerType
  customerName: string
}

interface ParticularsRow {
  id: string
  pettyCashCategory?: string
  particulars: string
  unitPrice: number | ''
  quantity: number | ''
  status: 'Paid' | 'Unpaid' | 'Pending' | 'On hold'
}

const SALES_PAYMENT_METHODS = [
  'Cash',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'Cheque',
  'Bank Transfer',
  'In-house',
] as const

const EXPENSE_PAYMENT_METHODS = [
  'Cash',
  'Petty Cash',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'Cheque',
  'Bank Transfer',
  'In-house',
] as const

export const PREDEFINED_PETTY_CASH_CATEGORIES = [
  'Office Supplies',
  'Courier',
  'Transportation',
  'Fuel',
  'Toll & Parking',
  'Meals & Snacks',
  'Pantry',
  'Cleaning',
  'Kitchen Supplies',
  'Repairs',
  'Electrical',
  'First Aid',
  'Notarial Fees',
  'Representation',
  'Errands',
  'Rent',
] as const

export const PREDEFINED_PETTY_CASH_PARTICULARS = PREDEFINED_PETTY_CASH_CATEGORIES

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Petty Cash',
  'Rendered Fee',
  'BBMP Foundation',
  'HDMF',
  'Philhealth',
  'Electricity',
  'BIR',
  'Payroll',
  'SSS',
  'Hotel Supplies',
  'Revolving Funds',
] as const

const DEPRECATED_OLD_CATEGORIES = new Set([
  'gcash',
  'maya',
  'panda',
  'package 1',
  'in-house',
  'cheque',
  'cash',
  'bank transfer',
  'paymongo',
  'office supplies',
  'kitchen & food supplies',
  'utilities',
  'salaries & wages',
  'rent & lease',
  'maintenance & repairs',
  'transportation & logistics',
  'marketing & advertising',
  'equipment',
  'petty cash replenishment',
])

interface AddTransactionSheetPageProps {
  initialType?: 'Sales' | 'Expense'
}

export const AddTransactionSheetPage: React.FC<AddTransactionSheetPageProps> = ({
  initialType,
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useSession()
  const { activeCompany } = useCompany()
  const isAuditor = user?.role === 'Supervisor'
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'
  const isCompanyLocked = isAuditor || Boolean(activeCompany && activeCompany !== 'All Companies')

  const editItem =
    (location.state as any)?.editSale ||
    (location.state as any)?.editExpense ||
    (location.state as any)?.editTransaction ||
    null

  const isEditMode = Boolean(editItem)

  // Strict transaction type determined by initialType or URL path (Sales stays in Sales, Expense stays in Expense)
  const transactionType: 'Sales' | 'Expense' = React.useMemo(() => {
    if (initialType) return initialType
    if (editItem?.type) return editItem.type === 'Expense' ? 'Expense' : 'Sales'
    const path = location.pathname.toLowerCase()
    if (path.includes('expense')) return 'Expense'
    return 'Sales'
  }, [initialType, location.pathname, editItem])

  // Top header metadata form fields
  const [date, setDate] = React.useState(() => formatToYYYYMMDD(new Date()))
  const initialCompany = React.useMemo(() => {
    if (isAuditor) return assignedCompany
    if (editItem?.company) return editItem.company
    if (activeCompany && activeCompany !== 'All Companies') return activeCompany
    return 'MCT Kitchen'
  }, [isAuditor, assignedCompany, editItem?.company, activeCompany])
  const [selectedCompany, setSelectedCompany] =
    React.useState<string>(initialCompany)

  // Keep selectedCompany in sync if user profile or active company changes
  React.useEffect(() => {
    if (isAuditor && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    } else if (activeCompany && activeCompany !== 'All Companies') {
      setSelectedCompany(activeCompany)
    }
  }, [isAuditor, user?.assignedCompany, activeCompany])

  // Payment Method state
  const [paymentMethod, setPaymentMethod] = React.useState<string>('Cash')
  const [chequeNo, setChequeNo] = React.useState<string>('')

  // Multi-step workflow state: 'encode' (spreadsheet) vs 'assign_unpaid' (unpaid entries assignment page)
  const [currentStep, setCurrentStep] = React.useState<'encode' | 'assign_unpaid'>('encode')
  const [unpaidAssignments, setUnpaidAssignments] = React.useState<UnpaidAssignmentRow[]>([])


  const [knownDebtors, setKnownDebtors] = React.useState(() =>
    receivablesStore.getPeopleSummaries()
  )

  React.useEffect(() => {
    setKnownDebtors(receivablesStore.getPeopleSummaries())
  }, [])

  React.useEffect(() => {
    const state = location.state as any
    if (state?.prefilledUnpaidItems && Array.isArray(state.prefilledUnpaidItems) && state.prefilledUnpaidItems.length > 0) {
      const normalizedPrefilled: UnpaidAssignmentRow[] = state.prefilledUnpaidItems.map(
        (it: any, idx: number) => {
          const rawType = String(it.customerType || '').toLowerCase()
          const resolvedType: CustomerType =
            rawType === 'staff' || rawType === 'internal' ? 'Staff' : 'External'
          return {
            rowId: it.rowId || `row-${idx + 1}`,
            saleLineIndex: typeof it.saleLineIndex === 'number' ? it.saleLineIndex : idx,
            particulars: String(it.particulars || '').trim(),
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice) || Number(it.total) || 0,
            total: Number(it.total) || 0,
            customerType: resolvedType,
            customerName: String(it.customerName || ''),
          }
        }
      )
      setRows(
        normalizedPrefilled.map((it) => ({
          id: it.rowId,
          pettyCashCategory: '',
          particulars: it.particulars,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          status: 'Unpaid',
        }))
      )
      setUnpaidAssignments(normalizedPrefilled)
      setCurrentStep('assign_unpaid')
      if (state.sourceCompany) {
        setSelectedCompany(state.sourceCompany)
      }
      if (state.sourceDate) {
        setDate(state.sourceDate)
      }
    }
  }, [location.state])

  // Bank Accounts state initialized synchronously from cache for 0ms Deposit Bank availability
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>(() =>
    bankService.getCachedAccounts(initialCompany)
  )
  const [isLoadingBanks, setIsLoadingBanks] = React.useState<boolean>(
    () => bankService.getCachedAccounts(initialCompany).length === 0
  )
  const [selectedBankAccountId, setSelectedBankAccountId] =
    React.useState<string>(() => {
      const cached = bankService.getCachedAccounts(initialCompany)
      return cached.length > 0 ? cached[0].id : ''
    })

  React.useEffect(() => {
    let mounted = true
    const targetComp = isAuditor ? assignedCompany : selectedCompany
    const cached = bankService.getCachedAccounts(targetComp)
    if (cached.length > 0) {
      setBankAccounts(cached)
      setIsLoadingBanks(false)
    } else {
      setIsLoadingBanks(true)
    }

    bankService
      .getAccounts(targetComp)
      .then((accounts) => {
        if (mounted) {
          setBankAccounts(accounts || [])
          setIsLoadingBanks(false)
        }
      })
      .catch(() => {
        if (mounted) {
          setIsLoadingBanks(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [isAuditor, assignedCompany, selectedCompany])

  // Filter available bank accounts strictly by the selected company
  const availableBankAccounts = React.useMemo(() => {
    const targetComp = isAuditor ? assignedCompany : selectedCompany
    if (!targetComp || targetComp === 'All Companies') return bankAccounts
    const matching = bankAccounts.filter((a) =>
      isCompanyMatch(a.companyName, targetComp)
    )
    if (matching.length > 0) return matching
    const general = bankAccounts.filter(
      (a) =>
        !a.companyName ||
        a.companyName.toLowerCase().includes('general') ||
        a.companyName.toLowerCase().includes('unassigned')
    )
    // Never leak other companies' bank accounts when scoped to a specific company
    return general
  }, [bankAccounts, selectedCompany, isAuditor, assignedCompany])

  // Auto-select the first bank account of the company immediately if available
  React.useEffect(() => {
    if (availableBankAccounts.length > 0) {
      const exists = availableBankAccounts.some(
        (a) => a.id === selectedBankAccountId
      )
      if (!exists) {
        setSelectedBankAccountId(availableBankAccounts[0].id)
      }
    } else if (!isLoadingBanks) {
      setSelectedBankAccountId('')
    }
  }, [availableBankAccounts, selectedBankAccountId, isLoadingBanks])

  // Category state
  const [category, setCategory] = React.useState<string>('Rendered Fee')
  const [categories, setCategories] = React.useState<string[]>([])
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] =
    React.useState(false)
  const [newCategoryName, setNewCategoryName] = React.useState('')
  const [isSavingCategory, setIsSavingCategory] = React.useState(false)
  const [categorySaveError, setCategorySaveError] = React.useState('')

  // Check if current expense transaction is Petty Cash (strictly tied to payment method)
  const isPettyCash =
    transactionType === 'Expense' &&
    paymentMethod.trim().toLowerCase() === 'petty cash'

  // Dynamic companies list loaded strictly from database
  const [dbCompanies, setDbCompanies] = React.useState<string[]>([])

  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((companies: CompanyOption[]) => {
      if (mounted && companies.length > 0) {
        const names = companies.map((c) => c.company_name).filter(Boolean)
        setDbCompanies(names)
        if (!selectedCompany && names.length > 0) {
          if (activeCompany && activeCompany !== 'All Companies') {
            setSelectedCompany(activeCompany)
          } else {
            setSelectedCompany(names[0])
          }
        }
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  // Category loader: Sales use the fixed sales list; Expenses merge defaults with DB categories
  React.useEffect(() => {
    if (transactionType === 'Sales') {
      setCategories(SALES_CATEGORY_LIST)
      setCategory((prev) =>
        editItem?.category && editItem.category !== 'None'
          ? editItem.category
          : SALES_CATEGORY_LIST.includes(prev)
            ? prev
            : SALES_CATEGORY_LIST[0]
      )
      return
    }
    if (transactionType !== 'Expense') return

    let mounted = true
    expenseService.getCategories().then((cats) => {
      if (mounted) {
        const fetchedNames = (cats || [])
          .map((c) => c.name?.trim())
          .filter(Boolean)
          .filter((name) => !DEPRECATED_OLD_CATEGORIES.has(name.toLowerCase()))

        const combined = Array.from(
          new Set([
            ...DEFAULT_EXPENSE_CATEGORIES,
            ...fetchedNames,
            ...(editItem?.category ? [editItem.category] : []),
          ])
        )
        setCategories(combined)
        setCategory((prev) => {
          if (paymentMethod.trim().toLowerCase() === 'petty cash') {
            return 'Petty Cash'
          }
          if (editItem?.category && combined.includes(editItem.category)) {
            return editItem.category
          }
          if (
            prev &&
            prev.trim().toLowerCase() !== 'petty cash' &&
            combined.includes(prev)
          ) {
            return prev
          }
          return 'Rendered Fee'
        })
      }
    })
    return () => {
      mounted = false
    }
  }, [transactionType, editItem])

  const handleSaveNewCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      setCategorySaveError('Category name cannot be empty')
      return
    }
    setIsSavingCategory(true)
    setCategorySaveError('')
    try {
      const saved = await expenseService.createCategory(trimmed)
      const savedName = saved.name || trimmed
      setCategories((prev) => {
        if (prev.some((c) => c.toLowerCase() === savedName.toLowerCase()))
          return prev
        return [...prev, savedName]
      })
      setCategory(savedName)
      if (paymentMethod.trim().toLowerCase() === 'petty cash') {
        setPaymentMethod('Cash')
      }
      setIsAddCategoryModalOpen(false)
      setNewCategoryName('')
    } catch (err: any) {
      console.error('Failed to create category:', err)
      setCategorySaveError(err?.message || 'Failed to save category')
    } finally {
      setIsSavingCategory(false)
    }
  }

  // Dynamic document title
  React.useEffect(() => {
    document.title = isEditMode
      ? `Edit ${transactionType} (Excel Sheet) - MCT Centralized Financial System`
      : `Add ${transactionType} (Excel Sheet) - MCT Centralized Financial System`
  }, [transactionType, isEditMode])

  // Prevent editing only if transaction has explicitly been audited and verified by an auditor
  React.useEffect(() => {
    if (editItem && (editItem.auditStatus === 'Verified' || editItem.isAudited)) {
      notifyWarning(
        'This transaction has already been audited and verified by the auditor. Records cannot be edited.'
      )
      navigate(transactionType === 'Sales' ? '/sales' : '/expense', {
        replace: true,
      })
    }
  }, [editItem, transactionType, navigate])

  // Pre-fill form fields and particulars rows when editing an existing transaction
  React.useEffect(() => {
    if (!editItem) return

    if (editItem.rawDate) {
      setDate(editItem.rawDate)
    } else if (editItem.date) {
      setDate(normalizeDateToYYYYMMDD(editItem.date))
    }
    if (editItem.company) {
      setSelectedCompany(editItem.company)
    }
    if (editItem.paymentMethod) {
      setPaymentMethod(editItem.paymentMethod)
    }
    if (editItem.chequeNo) {
      setChequeNo(editItem.chequeNo)
    }
    if (editItem.category && editItem.category !== 'None') {
      setCategory(editItem.category)
    }

    const fallbackTotal =
      editItem.amount ||
      editItem.deposit ||
      editItem.withdrawal ||
      editItem.netAmount ||
      0

    // Populate rows from structured items or parsed particulars string
    if (
      editItem.items &&
      Array.isArray(editItem.items) &&
      editItem.items.length > 0
    ) {
      setRows(
        editItem.items.map((it: any, idx: number) => ({
          id: it.id || `row-${idx}`,
          pettyCashCategory: '',
          particulars: it.particulars || '',
          unitPrice:
            typeof it.unitPrice === 'number' && it.unitPrice > 0
              ? it.unitPrice
              : it.total || fallbackTotal || '',
          quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1,
          status: normalizeParticularStatus(
            it.status || editItem.status,
            'Paid'
          ),
        }))
      )
    } else if (editItem.particulars) {
      const parsed = parseParticulars(
        editItem.particulars,
        null,
        fallbackTotal
      )
      if (parsed.length > 0) {
        setRows(
          parsed.map((p, idx) => ({
            id: p.id || `row-${idx}`,
            pettyCashCategory: '',
            particulars: p.particulars,
            unitPrice:
              typeof p.unitPrice === 'number' && p.unitPrice > 0
                ? p.unitPrice
                : p.total || fallbackTotal || '',
            quantity:
              typeof p.quantity === 'number' && p.quantity > 0 ? p.quantity : 1,
            status: normalizeParticularStatus(
              p.status || editItem.status,
              'Paid'
            ),
          }))
        )
      }
    }
  }, [editItem])

  // Excel-style rows state: start with exactly 1 row (user can add more rows as needed)
  const [rows, setRows] = React.useState<ParticularsRow[]>([
    {
      id: 'row-1',
      pettyCashCategory: '',
      particulars: '',
      unitPrice: '',
      quantity: 1,
      status: 'Paid',
    },
  ])

  // Submission state
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successBanner, setSuccessBanner] = React.useState<{
    count: number
    total: number
    type: string
  } | null>(null)

  // Input refs to focus on newly added row
  const particularsInputRefs = React.useRef<{
    [key: string]: HTMLInputElement | null
  }>({})

  // Row operations
  const handleAddRow = () => {
    const newId = `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    setRows((prev) => [
      ...prev,
      {
        id: newId,
        pettyCashCategory: '',
        particulars: '',
        unitPrice: '',
        quantity: 1,
        status: 'Paid',
      },
    ])
    setTimeout(() => {
      particularsInputRefs.current[newId]?.focus()
    }, 50)
  }

  const handleRemoveRow = (id: string) => {
    if (rows.length <= 1) {
      setRows([
        {
          id: 'row-1',
          pettyCashCategory: '',
          particulars: '',
          unitPrice: '',
          quantity: 1,
          status: 'Paid',
        },
      ])
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const handleRowChange = (
    id: string,
    field: keyof Omit<ParticularsRow, 'id'>,
    value: string | number
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        return {
          ...r,
          [field]: value,
        }
      })
    )
  }

  // Handle Enter key on row: if on last row, auto-create next row
  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rowIndex === rows.length - 1) {
        handleAddRow()
      } else {
        const nextId = rows[rowIndex + 1].id
        particularsInputRefs.current[nextId]?.focus()
      }
    }
  }

  // Calculations
  const calculatedRows = React.useMemo(() => {
    return rows.map((r) => {
      const price = typeof r.unitPrice === 'number' ? r.unitPrice : 0
      const qty = typeof r.quantity === 'number' ? r.quantity : 0
      const total = price * qty
      const hasDescription = isPettyCash
        ? r.particulars.trim().length > 0 ||
          (r.pettyCashCategory && r.pettyCashCategory.trim().length > 0)
        : r.particulars.trim().length > 0
      return {
        ...r,
        numericPrice: price,
        numericQty: qty,
        rowTotal: total,
        isValid: Boolean(hasDescription && price > 0 && qty > 0),
      }
    })
  }, [rows, isPettyCash])

  const grandTotal = React.useMemo(() => {
    return calculatedRows.reduce((sum, r) => sum + r.rowTotal, 0)
  }, [calculatedRows])

  const paidCashTotal = React.useMemo(() => {
    return calculatedRows
      .filter((r) => r.rowTotal > 0 && r.status === 'Paid')
      .reduce((sum, r) => sum + r.rowTotal, 0)
  }, [calculatedRows])

  const unpaidPendingTotal = React.useMemo(() => {
    return calculatedRows
      .filter((r) => r.rowTotal > 0 && r.status !== 'Paid')
      .reduce((sum, r) => sum + r.rowTotal, 0)
  }, [calculatedRows])

  const hasUnpaidItems = React.useMemo(() => {
    if (transactionType !== 'Sales') return false
    return rows.some(
      (r) => r.status === 'Unpaid' || r.status === 'Pending'
    )
  }, [transactionType, rows])

  const validRowsCount = React.useMemo(() => {
    return calculatedRows.filter((r) => r.isValid).length
  }, [calculatedRows])

  // Petty cash wallet balance for the selected company (null = unknown / backend unavailable)
  const pettyCashCompany = isAuditor ? assignedCompany : selectedCompany
  const [pettyBalance, setPettyBalance] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!isPettyCash) return
    let isMounted = true
    pettyCashService
      .getSummary(pettyCashCompany)
      .then((s) => isMounted && setPettyBalance(s.balance))
      .catch(() => isMounted && setPettyBalance(null))
    return () => {
      isMounted = false
    }
  }, [isPettyCash, pettyCashCompany])
  const exceedsPettyCash =
    isPettyCash && pettyBalance !== null && grandTotal > pettyBalance

  const totalQuantity = React.useMemo(() => {
    return calculatedRows
      .filter((r) => r.isValid)
      .reduce((sum, r) => sum + r.numericQty, 0)
  }, [calculatedRows])

  // Handle Save
  const handleSave = async () => {
    setErrorMessage(null)

    // Validation
    const validItems = calculatedRows.filter((r) => r.isValid)
    if (validItems.length === 0) {
      setErrorMessage(
        'Please enter at least one valid row with Particulars, Price Each (> 0), and Quantity (> 0).'
      )
      return
    }

    if (!date) {
      setErrorMessage('Please select a valid transaction date.')
      return
    }

    const todayIso = formatToYYYYMMDD(new Date())
    if (date > todayIso) {
      setErrorMessage('Transaction date cannot be in the future.')
      return
    }

    const companyToUse = isAuditor ? assignedCompany : selectedCompany

    // If bank accounts are still loading when user clicks save immediately, await the in-flight request
    let effectiveBankId = selectedBankAccountId
    let currentCompanyBanks = availableBankAccounts
    if (!isPettyCash && currentCompanyBanks.length === 0) {
      try {
        setIsLoadingBanks(true)
        const fetched = await bankService.getAccounts(companyToUse)
        setBankAccounts(fetched || [])
        const matched = (fetched || []).filter(
          (a) =>
            isCompanyMatch(a.companyName, companyToUse) ||
            !a.companyName ||
            a.companyName.toLowerCase().includes('general')
        )
        currentCompanyBanks = matched
        if (matched.length > 0 && !effectiveBankId) {
          effectiveBankId = matched[0].id
          setSelectedBankAccountId(matched[0].id)
        }
      } catch {
        // ignore network error and fall through to check
      } finally {
        setIsLoadingBanks(false)
      }
    }

    if (!isPettyCash && currentCompanyBanks.length === 0) {
      setErrorMessage(
        `Ensure that you have a bank account associated with ${companyToUse} before adding ${transactionType.toLowerCase()} transactions.`
      )
      return
    }

    if (exceedsPettyCash) {
      setErrorMessage(
        `Insufficient petty cash (${formatPHP(pettyBalance ?? 0)} available). Top up petty cash first.`
      )
      return
    }

    // Check if there are unpaid items in Sales or Expense, preserving each row's 0-based index in validItems
    const unpaidWithIndices = validItems
      .map((it, lineIdx) => ({ it, lineIdx }))
      .filter(({ it }) => it.status === 'Unpaid' || it.status === 'Pending')

    // Step 1: If on encode step and unpaid items exist:
    if (transactionType === 'Sales' && unpaidWithIndices.length > 0 && currentStep === 'encode') {
      const existingLinked =
        isEditMode && editItem?.id
          ? receivablesStore
              .getSales()
              .filter((r) => r.sale_id !== null && Number(r.sale_id) === Number(editItem.id))
          : []

      setUnpaidAssignments(
        unpaidWithIndices.map(({ it, lineIdx }) => {
          const matchedExisting =
            existingLinked.find((r) => r.sale_line_index === lineIdx) ||
            existingLinked.find(
              (r) =>
                r.sale_line_index === null &&
                r.items_summary.trim().toLowerCase() === it.particulars.trim().toLowerCase()
            )
          return {
            rowId: it.id,
            saleLineIndex: lineIdx,
            particulars: it.particulars.trim(),
            quantity: it.numericQty,
            unitPrice: it.numericPrice,
            total: it.rowTotal,
            customerType: matchedExisting?.customer_type || 'External',
            customerName: matchedExisting?.customer_name || '',
          }
        })
      )
      setCurrentStep('assign_unpaid')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // AC-1: If saving an Expense with unpaid items, save expense and redirect to /sales/add prefilled
    if (transactionType === 'Expense' && unpaidWithIndices.length > 0 && currentStep === 'encode') {
      setIsSubmitting(true)
      try {
        const itemizedParticulars: ParticularItem[] = validItems.map((item, idx) => {
          let text = item.particulars.trim()
          if (isPettyCash && item.pettyCashCategory?.trim()) {
            text = text ? `${item.pettyCashCategory.trim()} - ${text}` : item.pettyCashCategory.trim()
          }
          return {
            id: item.id || `item-${idx}`,
            particulars: text,
            quantity: item.numericQty,
            unitPrice: item.numericPrice,
            total: item.rowTotal,
            status: normalizeParticularStatus(item.status, 'Paid'),
          }
        })
        const formattedParticulars = formatParticularsString(itemizedParticulars)
        const companyToUse = isAuditor ? assignedCompany : selectedCompany

        if (!isEditMode) {
          await expenseService.addExpense({
            company: companyToUse,
            date,
            particulars: formattedParticulars,
            amount: grandTotal,
            category: isPettyCash ? 'Petty Cash' : category.trim() || 'Rendered Fee',
            paymentMethod,
            chequeNo: chequeNo.trim() || undefined,
            status: 'Pending',
            items: itemizedParticulars,
            bankAccountId: effectiveBankId || undefined,
          })
        }

        const transferredAssignments: UnpaidAssignmentRow[] = unpaidWithIndices.map(
          ({ it }, idx) => ({
            rowId: it.id,
            saleLineIndex: idx,
            particulars: it.particulars.trim(),
            quantity: it.numericQty,
            unitPrice: it.numericPrice,
            total: it.rowTotal,
            customerType: 'Staff',
            customerName: '',
          })
        )

        setIsSubmitting(false)
        navigate('/sales/add', {
          state: {
            prefilledUnpaidItems: transferredAssignments,
            sourceCompany: companyToUse,
            sourceDate: date,
            fromExpense: true,
          },
          replace: true,
        })
        return
      } catch (err: any) {
        setIsSubmitting(false)
        setErrorMessage(err?.message || 'Failed to save expense before transferring unpaid items.')
        return
      }
    }

    // Step 2: If on assign_unpaid step, ensure each unpaid item has a customer/staff name
    if (currentStep === 'assign_unpaid') {
      const missingIdx = unpaidAssignments.findIndex((u) => !u.customerName.trim())
      if (missingIdx !== -1) {
        setErrorMessage(
          `Please provide a Customer or Staff Name for unpaid item #${missingIdx + 1}: "${unpaidAssignments[missingIdx].particulars}".`
        )
        return
      }
    }

    setIsSubmitting(true)
    try {
      // Map valid sheet rows to structured ParticularItems
      const itemizedParticulars: ParticularItem[] = validItems.map((item, idx) => {
        let text = item.particulars.trim()
        if (isPettyCash && item.pettyCashCategory?.trim()) {
          text = text
            ? `${item.pettyCashCategory.trim()} - ${text}`
            : item.pettyCashCategory.trim()
        }
        return {
          id: item.id || `item-${idx}`,
          particulars: text,
          quantity: item.numericQty,
          unitPrice: item.numericPrice,
          total: item.rowTotal,
          status: normalizeParticularStatus(item.status, 'Paid'),
        }
      })

      // Combine into formatted particulars text
      const formattedParticulars = formatParticularsString(itemizedParticulars)

      // Calculate batch status from particulars: all Paid -> Paid, all Unpaid -> Unpaid, mixed/pending -> Pending
      const overallStatus = deriveRecordStatusFromParticulars(
        itemizedParticulars,
        'Paid'
      )

      if (isEditMode) {
        if (transactionType === 'Sales') {
          await salesService.updateSale(editItem.id, {
            company: companyToUse,
            date,
            particulars: formattedParticulars,
            amount: grandTotal,
            paymentMethod: paymentMethod,
            chequeNo: chequeNo.trim() || undefined,
            category: category || SALES_CATEGORY_LIST[0],
            status: overallStatus,
            items: itemizedParticulars,
            bankAccountId: effectiveBankId || undefined,
          })

          // Sync unpaid entries to Receivables ledger (1 receivable per unpaid line linked by sale_id + sale_line_index)
          if (unpaidAssignments.length > 0) {
            await receivablesStore.refreshFromBackend()
            const parsedEditSaleId = Number(editItem.id)
            const currentLinked = !Number.isNaN(parsedEditSaleId)
              ? receivablesStore
                  .getSales()
                  .filter((r) => r.sale_id !== null && Number(r.sale_id) === parsedEditSaleId)
              : []

            for (const u of unpaidAssignments) {
              const resolvedType: CustomerType = u.customerType === 'Staff' ? 'Staff' : 'External'
              const apiCustomerType = resolvedType === 'Staff' ? 'Internal' : 'External'
              const existingAtLine = currentLinked.find(
                (r) => r.sale_line_index === u.saleLineIndex
              )

              if (existingAtLine) {
                if (
                  existingAtLine.customer_name.trim() !== u.customerName.trim() ||
                  existingAtLine.customer_type !== resolvedType
                ) {
                  await receivablesStore.editSale(existingAtLine.id, {
                    customer_name: u.customerName.trim(),
                    customer_type: resolvedType,
                  })
                }
              } else {
                await receivablesService.createReceivable({
                  customer_name: u.customerName.trim(),
                  customer_type: apiCustomerType,
                  items_summary: u.particulars || 'Food Order',
                  total_amount: u.total,
                  amount_paid: 0,
                  payment_option: 'Pay Later',
                  payment_method:
                    paymentMethod === 'GCash'
                      ? 'GCash'
                      : paymentMethod === 'Bank Transfer'
                        ? 'Bank Transfer'
                        : 'Cash',
                  notes: chequeNo.trim() ? `Ref: ${chequeNo.trim()}` : undefined,
                  company_name: companyToUse,
                  sale_id: !Number.isNaN(parsedEditSaleId) ? parsedEditSaleId : undefined,
                  sale_line_index: u.saleLineIndex,
                  date,
                })
              }
            }
            await receivablesStore.refreshFromBackend()
          }
        } else {
          await expenseService.updateExpense(editItem.id, {
            company: companyToUse,
            date,
            particulars: formattedParticulars,
            withdrawal: grandTotal,
            netAmount: grandTotal,
            category: isPettyCash ? 'Petty Cash' : category || 'Rendered Fee',
            paymentMethod: paymentMethod,
            chequeNo: chequeNo.trim() || undefined,
            status: overallStatus,
            items: itemizedParticulars,
            bankAccountId: effectiveBankId || undefined,
          })
        }
      } else {
        if (transactionType === 'Sales') {
          const createdSale = await salesService.addSale({
            company: companyToUse,
            date,
            particulars: formattedParticulars,
            amount: grandTotal,
            paymentMethod: paymentMethod,
            chequeNo: chequeNo.trim() || undefined,
            category: category || SALES_CATEGORY_LIST[0],
            status: overallStatus,
            items: itemizedParticulars,
            bankAccountId: effectiveBankId || undefined,
          })

          // Create 1 Receivable per unpaid line linked by sale_id and sale_line_index
          if (unpaidAssignments.length > 0) {
            const parsedSaleId = createdSale?.id ? Number(createdSale.id) : NaN
            for (const u of unpaidAssignments) {
              const resolvedType: CustomerType = u.customerType === 'Staff' ? 'Staff' : 'External'
              const apiCustomerType = resolvedType === 'Staff' ? 'Internal' : 'External'
              await receivablesService.createReceivable({
                customer_name: u.customerName.trim(),
                customer_type: apiCustomerType,
                items_summary: u.particulars || 'Food Order',
                total_amount: u.total,
                amount_paid: 0,
                payment_option: 'Pay Later',
                payment_method:
                  paymentMethod === 'GCash'
                    ? 'GCash'
                    : paymentMethod === 'Bank Transfer'
                      ? 'Bank Transfer'
                      : 'Cash',
                notes: chequeNo.trim() ? `Ref: ${chequeNo.trim()}` : undefined,
                company_name: companyToUse,
                sale_id: !Number.isNaN(parsedSaleId) ? parsedSaleId : undefined,
                sale_line_index: u.saleLineIndex,
                date,
              })
            }
            await receivablesStore.refreshFromBackend()
          }
        } else {
          await expenseService.addExpense({
            company: companyToUse,
            date,
            particulars: formattedParticulars,
            amount: grandTotal,
            category: isPettyCash ? 'Petty Cash' : category || 'Rendered Fee',
            paymentMethod: paymentMethod,
            chequeNo: chequeNo.trim() || undefined,
            status: overallStatus,
            items: itemizedParticulars,
            bankAccountId: effectiveBankId || undefined,
          })
        }
      }

      // Refresh bank accounts cache in background after recording a transaction
      bankService.invalidateCache()
      bankService.prefetchAccounts(companyToUse)

      setSuccessBanner({
        count: validItems.length,
        total: grandTotal,
        type: isEditMode ? `${transactionType} (Updated)` : transactionType,
      })

      // Redirect back after brief delay
      setTimeout(() => {
        navigate(transactionType === 'Sales' ? '/sales' : '/expense')
      }, 900)
    } catch (err: any) {
      console.error('Failed to save entries:', err)
      setErrorMessage(
        err?.message || 'Failed to save transactions. Please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setRows([
      {
        id: 'row-1',
        pettyCashCategory: '',
        particulars: '',
        unitPrice: '',
        quantity: 1,
        status: 'Paid',
      },
    ])
    setErrorMessage(null)
  }

  const isSales = transactionType === 'Sales'

  return (
    <div className="space-y-6 pb-16 w-full max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 animate-in fade-in duration-300">
      {/* ========================================================================= */}
      {/* STEP 2: DEDICATED UNPAID SPREADSHEET PAGE (ASSIGN CUSTOMER TYPE & NAME)   */}
      {/* ========================================================================= */}
      {currentStep === 'assign_unpaid' ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Header */}
          <div className="space-y-2">
            <BackButton
              onClick={() => {
                setErrorMessage(null)
                setCurrentStep('encode')
              }}
              label="Back to Edit Particulars Spreadsheet"
            />

            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-focus tracking-tight">
                Assign Unpaid Entries (Receivables)
              </h1>
              <p className="text-xs sm:text-sm text-muted-fg font-normal mt-1">
                The following items were marked as <strong>Unpaid</strong>. Assign the Customer Type and Name for each line item to automatically record them into the Receivables ledger.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <ErrorBanner
              message={errorMessage}
              onDismiss={() => setErrorMessage(null)}
            />
          )}

          {/* Unpaid Entries Spreadsheet Table */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 shadow-xs overflow-hidden">
            <div className="p-4 sm:p-5 bg-rose-50/60 border-b border-rose-200/80 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-600 text-white font-bold text-xs flex items-center justify-center font-mono shadow-xs">
                  UTG
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-focus leading-tight">
                    Unpaid Entries Spreadsheet
                  </h2>
                  <p className="text-xs text-muted-fg">
                    Specify who owes each unpaid food item. You can assign different customers per row.
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table className="w-full border-collapse min-w-[840px]">
                <TableHeader className="bg-slate-50/90 border-b border-slate-200/80">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3">
                      #
                    </TableHead>
                    <TableHead className="text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                      UNPAID ITEM / PARTICULARS
                    </TableHead>
                    <TableHead className="w-20 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-2">
                      QTY
                    </TableHead>
                    <TableHead className="w-32 text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                      PRICE (₱)
                    </TableHead>
                    <TableHead className="w-36 text-right text-[11px] font-bold uppercase tracking-wider text-rose-700 border-r border-slate-200/60 py-3 px-4">
                      TOTAL OWED (₱)
                    </TableHead>
                    <TableHead className="w-44 text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      CUSTOMER TYPE <span className="text-red-500">*</span>
                    </TableHead>
                    <TableHead className="text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg py-3 px-4">
                      CUSTOMER / STAFF NAME <span className="text-red-500">*</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {unpaidAssignments.map((row, idx) => (
                    <TableRow key={row.rowId} className="border-b border-slate-200/60 hover:bg-slate-50/70 transition-colors">
                      {/* Row Index */}
                      <TableCell className="w-12 text-center text-xs font-mono font-bold text-muted-fg/70 bg-slate-50/50 border-r border-slate-200/60 select-none py-2 px-1">
                        {idx + 1}
                      </TableCell>

                      {/* Particular Description */}
                      <TableCell className="border-r border-slate-200/60 p-2.5 px-4 font-semibold text-xs sm:text-sm text-focus">
                        <span className="block truncate max-w-xs sm:max-w-md" title={row.particulars}>
                          {row.particulars}
                        </span>
                      </TableCell>

                      {/* Qty */}
                      <TableCell className="w-20 text-center border-r border-slate-200/60 p-2 font-mono text-xs sm:text-sm text-focus">
                        {row.quantity}
                      </TableCell>

                      {/* Unit Price */}
                      <TableCell className="w-32 text-right border-r border-slate-200/60 p-2 px-4 font-mono text-xs sm:text-sm text-focus">
                        {formatPHP(row.unitPrice)}
                      </TableCell>

                      {/* Total Owed */}
                      <TableCell className="w-36 text-right border-r border-slate-200/60 p-2 px-4 font-mono text-xs sm:text-sm font-bold text-rose-600 bg-rose-50/30">
                        {formatPHP(row.total)}
                      </TableCell>

                      {/* Customer / Staff Type Select Dropdown */}
                      <TableCell className="w-44 border-r border-slate-200/60 p-1.5 px-3">
                        <select
                          aria-label={`Customer type for row ${idx + 1}`}
                          value={row.customerType === 'Staff' ? 'Staff' : 'External'}
                          onChange={(e) => {
                            const val: CustomerType =
                              e.target.value === 'Staff' ? 'Staff' : 'External'
                            setUnpaidAssignments((prev) =>
                              prev.map((u, i) => (i === idx ? { ...u, customerType: val } : u))
                            )
                          }}
                          className="w-full h-9 px-3 rounded-lg border border-stroke/60 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-1 focus:ring-focus cursor-pointer"
                        >
                          <option value="External">External</option>
                          <option value="Staff">Staff</option>
                        </select>
                      </TableCell>

                      {/* Customer / Staff Name Input Field */}
                      <TableCell className="p-1.5 px-3">
                        <input
                          type="text"
                          aria-label={`Customer or staff name for row ${idx + 1}`}
                          value={row.customerName}
                          onChange={(e) => {
                            const val = e.target.value
                            const match = knownDebtors.find(
                              (p) => p.name.toLowerCase() === val.trim().toLowerCase()
                            )
                            setUnpaidAssignments((prev) =>
                              prev.map((u, i) =>
                                i === idx
                                  ? {
                                      ...u,
                                      customerName: val,
                                      ...(match ? { customerType: match.type } : {}),
                                    }
                                  : u
                              )
                            )
                          }}
                          placeholder={row.customerType === 'Staff' ? 'e.g. Maria Santos' : 'e.g. Mang Jose Mercado'}
                          className={cn(
                            'w-full h-9 px-3 rounded-lg border text-xs text-focus shadow-2xs focus:outline-none focus:ring-1 focus:ring-focus',
                            !row.customerName.trim()
                              ? 'border-rose-300 bg-rose-50/20'
                              : 'border-stroke/60 bg-white'
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Step 2 Bottom Actions Bar */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-xs font-medium text-muted-fg block">Total Sales</span>
                <span className="text-lg sm:text-xl font-bold text-focus tabular-nums">{formatPHP(grandTotal)}</span>
              </div>
              <div className="border-l border-slate-200 pl-6">
                <span className="text-xs font-medium text-muted-fg block">Paid in Cash</span>
                <span className="text-lg sm:text-xl font-bold text-emerald-600 tabular-nums">{formatPHP(paidCashTotal)}</span>
              </div>
              <div className="border-l border-slate-200 pl-6">
                <span className="text-xs font-medium text-rose-600 block">Total Utang (Owed)</span>
                <span className="text-lg sm:text-xl font-bold text-rose-600 tabular-nums">{formatPHP(unpaidPendingTotal)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end md:self-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setErrorMessage(null)
                  setCurrentStep('encode')
                }}
                disabled={isSubmitting}
                className="h-11 px-5 rounded-xl border-slate-200 text-xs sm:text-sm font-semibold text-focus hover:bg-slate-50 cursor-pointer"
              >
                Back to Edit Particulars
              </Button>

              <Button
                type="button"
                onClick={handleSave}
                disabled={isSubmitting}
                className="h-11 px-6 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving and Registering Receivables…</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Confirm & Complete Sales Record</span>
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        /* ========================================================================= */
        /* STEP 1: MAIN PARTICULARS SPREADSHEET (PURE ENCODING)                      */
        /* ========================================================================= */
        <div className="space-y-6">
      {/* 1. Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <BackButton
            onClick={() => navigate(isSales ? '/sales' : '/expense')}
            label={`Back to ${isSales ? 'Sales' : 'Expense'}`}
          />

          <div className="mt-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-focus tracking-tight">
              {isEditMode ? `Edit ${transactionType}` : `Add ${transactionType}`}
            </h1>
            <p className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
              {isEditMode
                ? `Editing particulars for ${editItem?.refNo || 'transaction'}. You can adjust particulars, unit prices, quantities, and status.`
                : isSales
                ? 'Excel-style spreadsheet entry for sales particulars, unit pricing, and deposit calculations.'
                : 'Excel-style spreadsheet entry for operational expense particulars, unit pricing, and withdrawal calculations.'}
            </p>
          </div>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm font-medium shadow-xs animate-in fade-in-50 duration-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="flex-1">
            <strong>
              Successfully recorded 1 {successBanner.type} entry with{' '}
              {successBanner.count} particulars!
            </strong>{' '}
            Total: <span className="font-bold">{formatPHP(successBanner.total)}</span>
            . Redirecting to {successBanner.type} summary...
          </div>
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <ErrorBanner
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      )}

      {/* 2. Transaction Parameters Card (Date, Company, Payment Method, Deposit Bank, Category, Cheque/Ref) */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-stroke/20">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-fg">
            Transaction Details & Setup
          </span>
          <span className="text-xs text-muted-fg font-medium">
            Applies to all particulars in this entry batch
          </span>
        </div>

        <div
          className={cn(
            'grid gap-3.5 sm:gap-4 items-start',
            isPettyCash
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'
          )}
        >
          {/* 1. Date */}
          <div className="space-y-1.5 flex flex-col justify-start">
            <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
              <Calendar className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>Date</span>
            </label>
            <input
              type="date"
              value={date}
              max={formatToYYYYMMDD(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus"
            />
          </div>

          {/* 2. Company */}
          <div className="space-y-1.5 flex flex-col justify-start">
            <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
              <Building2 className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>Company</span>
            </label>
            {isCompanyLocked ? (
              <div className="w-full h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-xs sm:text-sm text-focus font-medium flex items-center truncate shadow-2xs select-none">
                {isAuditor ? assignedCompany : (activeCompany && activeCompany !== 'All Companies' ? activeCompany : selectedCompany)}
              </div>
            ) : (
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
              >
                {dbCompanies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 3. Payment Method */}
          <div className="space-y-1.5 flex flex-col justify-start">
            <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
              <CreditCard className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>Payment Method</span>
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                const newMethod = e.target.value
                setPaymentMethod(newMethod)
                if (transactionType === 'Expense') {
                  if (newMethod.trim().toLowerCase() === 'petty cash') {
                    setCategory('Petty Cash')
                  } else if (category.trim().toLowerCase() === 'petty cash') {
                    setCategory('Rendered Fee')
                  }
                }
              }}
              className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
            >
              {(transactionType === 'Expense'
                ? EXPENSE_PAYMENT_METHODS
                : SALES_PAYMENT_METHODS
              ).map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </select>
            {isPettyCash && pettyBalance !== null && (
              <p
                className={cn(
                  'text-[11px] font-medium',
                  exceedsPettyCash ? 'text-red-600' : 'text-muted-fg'
                )}
              >
                Petty cash available:{' '}
                <span className="font-semibold">{formatPHP(pettyBalance)}</span>
              </p>
            )}
          </div>

          {/* 3b. Bank Account Dropdown (Direct destination/source for multi-bank companies) */}
          {!isPettyCash && (
            <div className="space-y-1.5 flex flex-col justify-start">
              <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
                <Landmark className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span className="truncate">
                  {transactionType === 'Sales' ? 'Deposit Bank' : 'Withdraw Bank'}
                </span>
                <span className="text-[11px] font-normal text-muted-fg shrink-0">
                  (Bank)
                </span>
              </label>
              <select
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
                disabled={isLoadingBanks && availableBankAccounts.length === 0}
                className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer disabled:opacity-70"
              >
                {availableBankAccounts.length === 0 ? (
                  <option value="">
                    {isLoadingBanks
                      ? 'Loading bank accounts...'
                      : 'No Bank Registered'}
                  </option>
                ) : (
                  <>
                    <option value="">None / Skip Bank Sync</option>
                    {availableBankAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.bankName} - {acc.accountName || acc.accountNumber} (
                        {formatPHP(acc.currentBalance)})
                      </option>
                    ))}
                  </>
                )}
              </select>
              {!isLoadingBanks && availableBankAccounts.length === 0 && (
                <p className="text-[11px] font-medium text-amber-700 flex items-center gap-1 mt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                  <span>
                    Ensure that you have a bank account associated with this
                    company.
                  </span>
                </p>
              )}
            </div>
          )}

          {/* 4. Category */}
          {!isPettyCash && (
            <div className="space-y-1.5 flex flex-col justify-start">
              <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
                <Tag className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Category</span>
              </label>
              <select
                id="transaction-category-select"
                value={category}
                onChange={(e) => {
                  if (e.target.value === '__ADD_NEW__') {
                    setIsAddCategoryModalOpen(true)
                  } else {
                    const newCat = e.target.value
                    setCategory(newCat)
                    if (
                      transactionType === 'Expense' &&
                      newCat.trim().toLowerCase() === 'petty cash'
                    ) {
                      setPaymentMethod('Petty Cash')
                    }
                  }
                }}
                className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="__ADD_NEW__" className="font-semibold text-primary">
                  + Add Category...
                </option>
              </select>
            </div>
          )}

          {/* 5. Cheque / Reference No */}
          <div className="space-y-1.5 flex flex-col justify-start">
            <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
              <FileSpreadsheet className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span className="truncate">Cheque / Ref No.</span>
              <span className="text-[11px] font-normal text-muted-fg shrink-0">
                (Optional)
              </span>
            </label>
            <input
              type="text"
              placeholder="e.g. CHQ-99201"
              value={chequeNo}
              onChange={(e) => setChequeNo(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus placeholder:text-muted-fg/60 shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus"
            />
          </div>
        </div>
      </Card>

      {/* 3. Excel Spreadsheet Grid Table */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 shadow-xs overflow-hidden">
        {/* Spreadsheet Banner Header */}
        <div className="p-4 sm:p-5 bg-slate-100/90 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center font-mono shadow-xs">
              XLS
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-focus leading-tight">
                Particulars Spreadsheet
              </h2>
              <p className="text-xs text-muted-fg">
                Enter each specific item or purchase. Quantities and unit prices
                calculate the total automatically.
              </p>
            </div>
          </div>

          {/* Quick Toolbar Buttons */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="h-8 px-3 rounded-xl border-slate-200 text-xs font-semibold text-muted-fg hover:text-focus cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              <span>Reset Grid</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleAddRow}
              className="h-8 px-3.5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Row</span>
            </Button>
          </div>
        </div>

        {/* Excel Grid Table */}
        <div className="overflow-x-auto">
          <Table
            className={cn(
              'w-full border-collapse',
              isPettyCash ? 'min-w-[1020px]' : 'min-w-[880px]'
            )}
          >
            <TableHeader className="bg-slate-50/90 border-b border-slate-200/80">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3">
                  #
                </TableHead>
                <TableHead className="text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                  PARTICULARS <span className="text-red-500">*</span>
                  <span className="font-normal text-muted-fg/70 ml-1.5 lowercase">
                    {isPettyCash
                      ? '(specific description)'
                      : '(specific thing bought/sold)'}
                  </span>
                </TableHead>
                {isPettyCash && (
                  <TableHead className="w-56 sm:w-64 text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                    PETTY CASH CATEGORY <span className="text-red-500">*</span>
                  </TableHead>
                )}
                <TableHead className="w-40 text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                  PRICE EACH (₱) <span className="text-red-500">*</span>
                </TableHead>
                <TableHead className="w-24 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                  QUANTITY <span className="text-red-500">*</span>
                </TableHead>
                <TableHead className="w-36 text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                  STATUS
                </TableHead>
                <TableHead className="w-40 text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                  TOTAL PRICE (₱)
                </TableHead>
                <TableHead className="w-14 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg py-3">
                  DEL
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((row, index) => {
                const price =
                  typeof row.unitPrice === 'number' ? row.unitPrice : 0
                const qty = typeof row.quantity === 'number' ? row.quantity : 0
                const rowTotal = price * qty
                const isRowActive =
                  row.particulars.trim().length > 0 ||
                  (row.pettyCashCategory &&
                    row.pettyCashCategory.trim().length > 0) ||
                  price > 0

                return (
                  <TableRow
                    key={row.id}
                    className={cn(
                      'border-b border-slate-200/60 hover:bg-slate-50/60 transition-colors',
                      isRowActive && 'bg-amber-50/20'
                    )}
                  >
                    {/* Row Index / Sheet Row Header */}
                    <TableCell className="w-12 text-center text-xs font-mono font-bold text-muted-fg/70 bg-slate-50/50 border-r border-slate-200/60 select-none py-2 px-1">
                      {index + 1}
                    </TableCell>

                    {/* Particulars Cell */}
                    <TableCell className="border-r border-slate-200/60 p-1.5 px-3">
                      <input
                        ref={(el) => {
                          particularsInputRefs.current[row.id] = el
                        }}
                        type="text"
                        placeholder={
                          isPettyCash
                            ? 'e.g. Taxi fare to supplier, Bond paper A4, Emergency snacks...'
                            : 'e.g. A4 Copy Paper Ream, Commercial Kitchen Gas, Espresso Beans...'
                        }
                        value={row.particulars}
                        onChange={(e) =>
                          handleRowChange(row.id, 'particulars', e.target.value)
                        }
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        className="w-full h-9 px-3 text-xs sm:text-sm text-focus rounded-lg border border-transparent hover:border-slate-300 focus:border-focus focus:bg-white focus:outline-none focus:ring-1 focus:ring-focus transition-all"
                      />
                    </TableCell>

                    {/* Pre-defined Petty Cash Category Column */}
                    {isPettyCash && (
                      <TableCell className="w-56 sm:w-64 border-r border-slate-200/60 p-1.5 px-3 align-middle">
                        <select
                          value={row.pettyCashCategory || ''}
                          onChange={(e) =>
                            handleRowChange(
                              row.id,
                              'pettyCashCategory',
                              e.target.value
                            )
                          }
                          className="w-full h-9 px-2.5 text-xs sm:text-sm text-focus rounded-lg border border-stroke/60 bg-white hover:border-slate-300 focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus transition-all cursor-pointer truncate align-middle"
                        >
                          <option value="">-- Select Category --</option>
                          {PREDEFINED_PETTY_CASH_CATEGORIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                    )}

                    {/* Price Each Cell */}
                    <TableCell className="w-40 border-r border-slate-200/60 p-1.5 px-3">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-fg/70">
                          ₱
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={row.unitPrice}
                          onChange={(e) => {
                            const val =
                              e.target.value === ''
                                ? ''
                                : parseFloat(e.target.value)
                            handleRowChange(
                              row.id,
                              'unitPrice',
                              isNaN(val as number) ? '' : val
                            )
                          }}
                          onKeyDown={(e) => handleKeyDown(e, index)}
                          className="w-full h-9 pl-6 pr-3 text-right text-xs sm:text-sm font-mono text-focus rounded-lg border border-transparent hover:border-slate-300 focus:border-focus focus:bg-white focus:outline-none focus:ring-1 focus:ring-focus transition-all"
                        />
                      </div>
                    </TableCell>

                    {/* Quantity Cell */}
                    <TableCell className="w-24 border-r border-slate-200/60 p-1.5 px-2">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="1"
                        value={row.quantity}
                        onChange={(e) => {
                          const val =
                            e.target.value === ''
                              ? ''
                              : parseInt(e.target.value, 10)
                          handleRowChange(
                            row.id,
                            'quantity',
                            isNaN(val as number) ? '' : val
                          )
                        }}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        className="w-full h-9 px-2 text-center text-xs sm:text-sm font-mono text-focus rounded-lg border border-transparent hover:border-slate-300 focus:border-focus focus:bg-white focus:outline-none focus:ring-1 focus:ring-focus transition-all"
                      />
                    </TableCell>

                    {/* Status Dropdown Cell: Paid, Unpaid, Pending (Yellow) */}
                    <TableCell className="w-36 border-r border-slate-200/60 p-1.5 px-2.5">
                      <select
                        value={normalizeParticularStatus(row.status, 'Paid')}
                        onChange={(e) =>
                          handleRowChange(
                            row.id,
                            'status',
                            e.target.value as 'Paid' | 'Unpaid' | 'Pending'
                          )
                        }
                        className={cn(
                          'w-full h-9 px-2.5 text-xs font-semibold rounded-lg border focus:outline-none focus:ring-1 transition-all cursor-pointer truncate',
                          row.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500'
                            : row.status === 'Unpaid'
                              ? 'bg-rose-50 text-rose-700 border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                              : 'bg-yellow-100 text-yellow-800 border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500'
                        )}
                      >
                        <option value="Paid">Paid</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="Pending">Pending</option>
                      </select>
                    </TableCell>

                    {/* Total Price (Calculated formula) */}
                    <TableCell className="w-40 border-r border-slate-200/60 p-1.5 px-4 text-right">
                      <span
                        className={cn(
                          'font-mono text-xs sm:text-sm font-bold block py-1.5',
                          rowTotal > 0
                            ? isSales
                              ? 'text-emerald-600'
                              : 'text-rose-600'
                            : 'text-muted-fg/50'
                        )}
                      >
                        {formatPHP(rowTotal)}
                      </span>
                    </TableCell>

                    {/* Delete Row Button */}
                    <TableCell className="w-14 text-center p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveRow(row.id)}
                        disabled={rows.length <= 1 && !isRowActive}
                        className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer mx-auto"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Add Row Prompt Bar */}
        <div className="p-3 bg-slate-50/70 border-t border-slate-200/60 flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddRow}
            className="h-9 px-4 rounded-xl border-dashed border-slate-300 hover:border-focus text-xs font-semibold text-focus gap-2 cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>Add Row to Sheet</span>
            <span className="text-[10px] text-muted-fg ml-1">
              (or press Enter on last cell)
            </span>
          </Button>

          <span className="text-xs text-muted-fg hidden sm:inline-block">
            {rows.length} total rows • {validRowsCount} valid items
          </span>
        </div>
      </Card>

      {/* 4. Grand Summary Card & Final Actions */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        {/* Left: Summary Metrics */}
        <div className="flex flex-wrap items-center gap-6 sm:gap-10">
          <div>
            <span className="text-xs font-medium text-muted-fg block">
              Valid Particulars
            </span>
            <span className="text-lg sm:text-xl font-bold text-focus mt-0.5 block">
              {validRowsCount} item{validRowsCount !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="border-l border-slate-200 pl-6 sm:pl-10">
            <span className="text-xs font-medium text-muted-fg block">
              Total Units
            </span>
            <span className="text-lg sm:text-xl font-bold text-focus mt-0.5 block">
              {totalQuantity} unit{totalQuantity !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="border-l border-slate-200 pl-6 sm:pl-10">
            <span className="text-xs font-medium text-muted-fg block">
              Grand Total {isSales ? 'Sales' : 'Expense'}
            </span>
            <span
              className={cn(
                'text-lg sm:text-xl font-bold mt-0.5 block tabular-nums',
                isSales ? 'text-emerald-600' : 'text-rose-600'
              )}
            >
              {formatPHP(grandTotal)}
            </span>
          </div>

          <div className="border-l border-slate-200 pl-6 sm:pl-10">
            <span className="text-xs font-medium text-muted-fg block">
              Paid in Cash
            </span>
            <span className="text-lg sm:text-xl font-bold text-emerald-600 mt-0.5 block tabular-nums">
              {formatPHP(paidCashTotal)}
            </span>
          </div>

          {unpaidPendingTotal > 0 && (
            <div className="border-l border-slate-200 pl-6 sm:pl-10">
              <span className="text-xs font-medium text-muted-fg block">
                Unpaid / Pending
              </span>
              <span className="text-lg sm:text-xl font-bold text-yellow-700 mt-0.5 block tabular-nums">
                {formatPHP(unpaidPendingTotal)}
              </span>
            </div>
          )}
        </div>

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(isSales ? '/sales' : '/expense')}
            disabled={isSubmitting}
            className="h-11 px-5 rounded-xl border-slate-200 text-xs sm:text-sm font-semibold text-focus hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting || validRowsCount === 0 || exceedsPettyCash}
            className={cn(
              'h-11 px-6 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all',
              'bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-40'
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {isEditMode
                    ? 'Updating transaction…'
                    : `Saving ${validRowsCount} items…`}
                </span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>
                  {isEditMode
                    ? 'Update Transaction'
                    : `Save ${validRowsCount > 0 ? `${validRowsCount} ` : ''}${transactionType} ${validRowsCount > 1 ? 'Records' : 'Record'}`}
                </span>
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Add Expense Category Modal Dialog */}
      <Dialog
        open={isAddCategoryModalOpen}
        onOpenChange={(open) => {
          setIsAddCategoryModalOpen(open)
          if (!open) {
            setNewCategoryName('')
            setCategorySaveError('')
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px] rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl [&>button]:top-4 [&>button]:right-4 [&>button]:w-6 [&>button]:h-6 [&>button]:p-0.5 [&>button]:rounded-md [&>button>svg]:w-3.5 [&>button>svg]:w-3.5">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#960C01] text-white flex items-center justify-center shrink-0 shadow-xs">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-focus leading-tight">
                  Add Category
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Type a new category name. It will be automatically saved and
                  selected.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-3">
            {categorySaveError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{categorySaveError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-focus block">
                Category Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Special Logistics, Staff Welfare, Licenses..."
                value={newCategoryName}
                onChange={(e) => {
                  setNewCategoryName(e.target.value)
                  if (categorySaveError) setCategorySaveError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSaveNewCategory()
                  }
                }}
                autoFocus
                className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsAddCategoryModalOpen(false)
                  setNewCategoryName('')
                  setCategorySaveError('')
                }}
                className="h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isSavingCategory || !newCategoryName.trim()}
                onClick={handleSaveNewCategory}
                className="h-9 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isSavingCategory ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Category</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
        </div>
      )}
    </div>
  )
}
