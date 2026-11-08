import { formatUserFriendlyErrorMessage, notifyError, notifyWarning } from '@/utils/errorUtils'
import * as React from 'react'

import {

  Download,

  Search,

  ChevronDown,

  ChevronLeft,

  ChevronRight,

  FileSpreadsheet,

  FileText,

  CreditCard,

  Building2,

  Eye,

  EyeOff,

  Pencil,

  ArrowUpRight,

  ArrowDownLeft,

  Check,

  History,

  Landmark,

  Loader2,

  Plus,
  RefreshCw,

} from 'lucide-react'

import { Card } from '@/components/ui/card'

import { Button } from '@/components/ui/button'

import { Input } from '@/components/ui/input'

import { isCompanyMatch } from '@/utils/companyUtils'

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

import {

  DateRangePicker,

  type DateRange,

} from '@/components/ui/DateRangePicker'

import { useSession } from '@/hooks/useSession'

import { useCompany } from '@/context/CompanyContext'

import { formatPHP } from '@/lib/format'

import { cn } from '@/lib/utils'

import { bankService, type BankAccount, type BankTransaction } from '@/services/bankService'

import { websocketService, type ConnectionStatus } from '@/services/websocketService'

import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'

import { getParticularsSummary } from '@/utils/particularsUtils'

import type { DashboardTransactionItem } from '@/services/dashboardService'

export type { BankAccount, BankTransaction }

export function getAccountCardLabel(acc: BankAccount): string {

  const bank = acc.bankName?.trim() || 'Bank'

  const acct = acc.accountName?.trim() || ''

  const comp = acc.companyName?.trim() || ''

  if (acct && comp) {

    return `${bank} • ${acct} (${comp})`

  }

  if (acct) {

    return `${bank} • ${acct}`

  }

  if (comp) {

    return `${bank} (${comp})`

  }

  return bank || 'Corporate Bank Account'

}

const ITEMS_PER_PAGE = 8

export const BankManagementPage: React.FC = () => {

  const { user } = useSession()

  const { activeCompany, setActiveCompany, allCompanies, isCompanyScoped: isStrictlyCompanyScoped } = useCompany()

  const userRole = (user?.role || '').toLowerCase()

  const isAdmin = userRole === 'admin'

  const isFinance = userRole === 'finance'

  const isAudit = userRole === 'audit' || userRole.includes('auditor')

  const isCompanyScoped = isStrictlyCompanyScoped

  const canManageBank = isAdmin || isFinance

  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  // Custom bank name state for "Others" option

  const [customBankName, setCustomBankName] = React.useState('')

  // Document title

  React.useEffect(() => {

    document.title = 'Bank Management - MCT Group'

  }, [])

  // Bank accounts strictly loaded from database

  const [accounts, setAccounts] = React.useState<BankAccount[]>([])

  const [isLoading, setIsLoading] = React.useState(true)

  const saveAccounts = React.useCallback((newAccounts: BankAccount[]) => {

    setAccounts(newAccounts)

  }, [])

  // Company filtering state

  const [selectedCompany, setSelectedCompany] = React.useState<string>(() => {

    if (isCompanyScoped && assignedCompany) return assignedCompany

    if (activeCompany && activeCompany !== 'All Companies') return activeCompany

    return activeCompany || 'All Companies'

  })

  React.useEffect(() => {

    if (isCompanyScoped && user?.assignedCompany) {

      setSelectedCompany(user.assignedCompany)

    }

  }, [isCompanyScoped, user?.assignedCompany])

  React.useEffect(() => {

    if (activeCompany) {

      setSelectedCompany(activeCompany)

    }

  }, [activeCompany])

  // Dynamic companies fetched directly from database

  const [dbCompanies, setDbCompanies] = React.useState<string[]>([])

  React.useEffect(() => {

    let active = true

    if (!isAdmin && !isFinance && allCompanies && allCompanies.length > 0) {
      setDbCompanies(allCompanies.filter((c) => c !== 'All Companies'))
      return
    }

    const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null

    fetch('/api/v1/companies/lookup', {

      headers: {

        'Content-Type': 'application/json',

        ...(token ? { Authorization: `Bearer ${token}` } : {}),

      },

    })

      .then((res) => (res.ok ? res.json() : []))

      .then((data) => {

        if (active && Array.isArray(data)) {

          const names = data.map((c: any) => c.name || c.company_name).filter(Boolean)

          setDbCompanies(names)

        }

      })

      .catch((err) => {

        console.warn('Failed to load database companies:', err)

      })

    return () => {

      active = false

    }

  }, [allCompanies, isAdmin, isFinance])

  // Real-time WebSocket connection status state
  const [wsStatus, setWsStatus] = React.useState<ConnectionStatus>(websocketService.getStatus())

  // Synchronize bank accounts with database
  const fetchAccounts = React.useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        bankService.invalidateCache()
      }
      // For company-scoped users, request their company accounts.
      // Company filtering in memory is instantaneous and never fails on aliases.
      const targetComp = isCompanyScoped
        ? assignedCompany
        : selectedCompany !== 'All Companies'
        ? selectedCompany
        : undefined
      const data = await bankService.getAccounts(targetComp, { forceRefresh })
      setAccounts(data || [])
    } catch (err) {
      console.warn('Bank accounts database fetch warning:', err)
    } finally {
      setIsLoading(false)
    }
  }, [isCompanyScoped, assignedCompany, selectedCompany])

  React.useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  // Realtime multi-tab WebSocket synchronization and status listener
  React.useEffect(() => {
    // Ensure active WebSocket connection
    websocketService.connect()

    const handleSync = () => {
      bankService.invalidateCache()
      void fetchAccounts(true)
    }

    const unsubs = [
      websocketService.subscribe('BANK_UPDATED', handleSync),
      websocketService.subscribe('TRANSACTION_UPDATED', handleSync),
      websocketService.subscribe('EXPENSE_CREATED', handleSync),
      websocketService.subscribe('EXPENSE_UPDATED', handleSync),
      websocketService.subscribe('EXPENSE_DELETED', handleSync),
      websocketService.subscribe('SALES_UPDATED', handleSync),
      websocketService.subscribe('LOANS_UPDATED', handleSync),
      websocketService.subscribe('PETTY_CASH_UPDATED', handleSync),
      websocketService.subscribe('AUDIT_UPDATED', handleSync),
      websocketService.subscribe('WS_STATUS_CHANGE', (newStatus) => {
        setWsStatus(newStatus as ConnectionStatus)
      }),
    ]

    return () => {
      unsubs.forEach((unsub) => unsub())
    }
  }, [fetchAccounts])

  // Active selected bank account

  const [selectedAccountId, setSelectedAccountId] = React.useState<string>('')

  // Selected bank transaction for details modal inspection

  const [viewingBankTx, setViewingBankTx] = React.useState<DashboardTransactionItem | null>(null)

  const [isViewTxModalOpen, setIsViewTxModalOpen] = React.useState(false)

  // Toggle privacy of balance on the big card

  const [showBalance, setShowBalance] = React.useState(true)

  // Filters state

  const [tableSearchQuery, setTableSearchQuery] = React.useState('')

  const [txTypeFilter, setTxTypeFilter] = React.useState<'All' | 'Deposit' | 'Withdrawal'>('All')

  const [dateRange, setDateRange] = React.useState<DateRange>((() => {

    const now = new Date()

    const currYear = now.getFullYear()

    const currMonth = String(now.getMonth() + 1).padStart(2, '0')

    const lastDay = new Date(currYear, now.getMonth() + 1, 0).getDate()

    return {

      startDate: `${currYear}-${currMonth}-01`,

      endDate: `${currYear}-${currMonth}-${String(lastDay).padStart(2, '0')}`,

      label: 'This Month',

      preset: 'This Month',

    }

  })())

  // Pagination for transaction table

  const [currentPage, setCurrentPage] = React.useState(1)

  // Dropdown states

  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)

  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false)

  const [isTxTypeDropdownOpen, setIsTxTypeDropdownOpen] = React.useState(false)

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)

  const companyDropdownRef = React.useRef<HTMLDivElement>(null)

  const txTypeDropdownRef = React.useRef<HTMLDivElement>(null)

  // Modals state

  const [isAddBankModalOpen, setIsAddBankModalOpen] = React.useState(false)

  const [isDepositModalOpen, setIsDepositModalOpen] = React.useState(false)

  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = React.useState(false)

  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false)

  const [isCardDetailsModalOpen, setIsCardDetailsModalOpen] = React.useState(false)

  const [isActivityLogOpen, setIsActivityLogOpen] = React.useState(false)

  const lastTapRef = React.useRef<number>(0)

  // In-flight submission guards to prevent duplicate records

  const [isSubmittingBank, setIsSubmittingBank] = React.useState(false)

  const [isSubmittingDeposit, setIsSubmittingDeposit] = React.useState(false)

  const [isSubmittingWithdraw, setIsSubmittingWithdraw] = React.useState(false)

  const [isSubmittingEdit, setIsSubmittingEdit] = React.useState(false)

  // Modal form states

  const [addBankSuccessMessage, setAddBankSuccessMessage] = React.useState<string | null>(null)

  const [addBankForm, setAddBankForm] = React.useState({

    bankName: 'CHINABANK',

    accountName: '',

    accountNumber: '',

    cardLabel: '',

    companyName: isCompanyScoped ? assignedCompany : (selectedCompany !== 'All Companies' ? selectedCompany : (activeCompany !== 'All Companies' ? activeCompany : '')),

    accountType: 'Checking' as BankAccount['accountType'],

    branch: '',

    startingBalance: '',

    colorTheme: 'red' as 'red' | 'grey',

    notes: '',

  })

  const [depositForm, setDepositForm] = React.useState({

    amount: '',

    date: '10/01/26',

    particulars: '',

    category: 'Bank Transfer',

    referenceNo: '',

  })

  const [withdrawForm, setWithdrawForm] = React.useState({

    amount: '',

    date: '10/01/26',

    chequeNo: '',

    particulars: '',

    category: 'Cheque',

  })

  // Click outside listener for dropdowns

  React.useEffect(() => {

    const handleClickOutside = (e: MouseEvent) => {

      const target = e.target as HTMLElement

      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {

        setIsExportDropdownOpen(false)

      }

      if (companyDropdownRef.current && !companyDropdownRef.current.contains(target)) {

        setIsCompanyDropdownOpen(false)

      }

      if (txTypeDropdownRef.current && !txTypeDropdownRef.current.contains(target)) {

        setIsTxTypeDropdownOpen(false)

      }

    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => document.removeEventListener('mousedown', handleClickOutside)

  }, [])

  // Filter accounts accessible by role with robust alias matching

  const roleScopedAccounts = React.useMemo(() => {

    if (isCompanyScoped) {

      return accounts.filter((a) =>

        isCompanyMatch(a.companyName, assignedCompany)

      )

    }

    if (selectedCompany !== 'All Companies') {

      return accounts.filter((a) =>

        isCompanyMatch(a.companyName, selectedCompany)

      )

    }

    return accounts

  }, [accounts, isCompanyScoped, assignedCompany, selectedCompany])

  const isAggregatedView = selectedCompany === 'All Companies' && (selectedAccountId === 'all' || !selectedAccountId)

  // Total group balance across all accessible accounts

  const totalGroupBalance = React.useMemo(() => {

    return roleScopedAccounts.reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0)

  }, [roleScopedAccounts])

  // Currently selected active bank account

  const activeAccount = React.useMemo(() => {

    if (isAggregatedView) return undefined

    const found = roleScopedAccounts.find((a) => a.id === selectedAccountId)

    if (found) return found

    if (selectedCompany === 'All Companies') return undefined

    return roleScopedAccounts[0] || (isCompanyScoped ? undefined : accounts[0])

  }, [roleScopedAccounts, selectedAccountId, accounts, isCompanyScoped, isAggregatedView, selectedCompany])

  // Edit form state with accountName, branch, startingBalance (view-only), currentBalance, and notes

  const [editAccountForm, setEditAccountForm] = React.useState({

    accountName: '',

    branch: '',

    startingBalance: 0,

    currentBalance: '',

    notes: '',

  })

  React.useEffect(() => {

    if (activeAccount) {

      setEditAccountForm({

        accountName: activeAccount.accountName,

        branch: activeAccount.branch,

        startingBalance: activeAccount.startingBalance,

        currentBalance: activeAccount.currentBalance.toString(),

        notes: activeAccount.notes || '',

      })

    }

  }, [activeAccount])

  const handleSaveEditAccount = async (e: React.FormEvent) => {

    e.preventDefault()

    if (!canManageBank || !activeAccount || isSubmittingEdit) return

    setIsSubmittingEdit(true)

    try {

      const updatedAccount = await bankService.updateAccount(activeAccount.id, {

        accountName: editAccountForm.accountName.trim(),

        branch: editAccountForm.branch.trim(),

        notes: editAccountForm.notes.trim(),

      }, user?.role)

      const updated = accounts.map((a) => (a.id === updatedAccount.id ? updatedAccount : a))

      saveAccounts(updated)

      websocketService.emitLocal('BANK_UPDATED', { accountId: updatedAccount.id })

      setIsEditModalOpen(false)

    } catch (err: any) {

      notifyError(err, 'Failed to update bank account.')

    } finally {

      setIsSubmittingEdit(false)

    }

  }

  // Keep selectedAccountId valid when filter changes

  React.useEffect(() => {

    if (selectedCompany === 'All Companies') {

      if (!selectedAccountId || selectedAccountId === '') {

        setSelectedAccountId('all')

      }

      return

    }

    if (roleScopedAccounts.length > 0) {

      const exists = roleScopedAccounts.some((a) => a.id === selectedAccountId)

      if (!exists || selectedAccountId === 'all') {

        setSelectedAccountId(roleScopedAccounts[0].id)

      }

    }

  }, [selectedCompany, roleScopedAccounts, selectedAccountId])

  // Canonical Red Deck Stack Accounts (Crimson Commercial Accounts)

  const redStackAccounts = React.useMemo(() => {

    return roleScopedAccounts.filter(

      (a) => a.colorTheme === 'red' || (!a.colorTheme && a.colorTheme !== 'grey')

    )

  }, [roleScopedAccounts])

  // Canonical Grey Deck Stack Accounts (Slate Metallic Holdings & Tech Accounts)

  const greyStackAccounts = React.useMemo(() => {

    return roleScopedAccounts.filter((a) => a.colorTheme === 'grey')

  }, [roleScopedAccounts])

  // Single-account mode: only when exactly 1 account exists for the current scope

  const isSingleAccount = roleScopedAccounts.length === 1

  // Accounts belonging to the active company (supports multi-bank up to 3 banks per company)

  const activeCompanyAccounts = React.useMemo(() => {

    if (!activeAccount) return []

    const targetComp = activeAccount.companyName.toLowerCase().trim()

    return accounts.filter((a) => a.companyName.toLowerCase().trim() === targetComp)

  }, [accounts, activeAccount])

  // Double-click and tap listeners for ATM Card

  const clickCountRef = React.useRef(0)

  const clickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCardClick = (e: React.MouseEvent) => {

    const target = e.target as HTMLElement

    if (target.closest('button')) return

    clickCountRef.current += 1

    if (clickCountRef.current === 1) {

      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)

      clickTimerRef.current = setTimeout(() => {

        clickCountRef.current = 0

      }, 450)

    } else if (clickCountRef.current >= 2) {

      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)

      clickCountRef.current = 0

      setIsCardDetailsModalOpen(true)

    }

  }

  const handleCardTouch = (e: React.TouchEvent) => {

    const target = e.target as HTMLElement

    if (target.closest('button')) return

    const now = Date.now()

    if (now - lastTapRef.current < 450) {

      setIsCardDetailsModalOpen(true)

    }

    lastTapRef.current = now

  }

  // Compute running historical balance for each transaction (newest to oldest)

  const transactionsWithRunningBalance = React.useMemo(() => {

    if (isAggregatedView) {

      const allTx: (BankTransaction & { runningBalance: number; companyName: string; bankName: string })[] = []

      for (const acc of roleScopedAccounts) {

        let current = acc.currentBalance

        for (let i = 0; i < (acc.transactions || []).length; i++) {

          const tx = acc.transactions[i]

          allTx.push({

            ...tx,

            runningBalance: current,

            companyName: acc.companyName || 'Corporate',

            bankName: acc.bankName || 'Corporate Bank',

          })

          const dep = tx.deposit || 0

          const wth = tx.withdrawal || 0

          current = current - dep + wth

        }

      }

      return allTx.sort((a, b) => {

        const timeA = new Date(a.date).getTime() || 0

        const timeB = new Date(b.date).getTime() || 0

        if (timeA !== timeB) return timeB - timeA

        return (b.id || '').localeCompare(a.id || '')

      })

    }

    if (!activeAccount || !activeAccount.transactions) return []

    let current = activeAccount.currentBalance

    const result: (BankTransaction & { runningBalance: number; companyName: string; bankName: string })[] = []

    for (let i = 0; i < activeAccount.transactions.length; i++) {

      const tx = activeAccount.transactions[i]

      result.push({

        ...tx,

        runningBalance: current,

        companyName: activeAccount.companyName || 'Corporate',

        bankName: activeAccount.bankName || 'Corporate Bank',

      })

      // Adjust balance backwards to calculate previous row's balance

      const dep = tx.deposit || 0

      const wth = tx.withdrawal || 0

      current = current - dep + wth

    }

    return result

  }, [isAggregatedView, roleScopedAccounts, activeAccount])

  // Filtered transactions of the currently selected bank account

  const filteredTransactions = React.useMemo(() => {

    let list = [...transactionsWithRunningBalance]

    if (txTypeFilter === 'Deposit') {

      list = list.filter((t) => typeof t.deposit === 'number' && t.deposit > 0)

    } else if (txTypeFilter === 'Withdrawal') {

      list = list.filter((t) => typeof t.withdrawal === 'number' && t.withdrawal > 0)

    }

    const q = tableSearchQuery.toLowerCase().trim()

    if (q) {

      list = list.filter((t) => {

        const matchParticulars = t.particulars.toLowerCase().includes(q)

        const matchCheque = (t.chequeNo || '').toLowerCase().includes(q)

        const matchCategory = t.category.toLowerCase().includes(q)

        const matchDate = t.date.toLowerCase().includes(q)

        const matchBal = t.runningBalance.toString().includes(q)

        const matchComp = ((t as any).companyName || '').toLowerCase().includes(q)

        return matchParticulars || matchCheque || matchCategory || matchDate || matchBal || matchComp

      })

    }

    return list

  }, [transactionsWithRunningBalance, tableSearchQuery, txTypeFilter])

  // Pagination

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE))

  const paginatedTransactions = React.useMemo(() => {

    const start = (currentPage - 1) * ITEMS_PER_PAGE

    return filteredTransactions.slice(start, start + ITEMS_PER_PAGE)

  }, [filteredTransactions, currentPage])

  // Reset page when search, account, or tx type filter changes

  React.useEffect(() => {

    setCurrentPage(1)

  }, [selectedAccountId, tableSearchQuery, txTypeFilter])

  // Distinct company list from database and bank accounts for filter dropdown

  const companyOptions = React.useMemo(() => {

    const set = new Set<string>()

    if (allCompanies && Array.isArray(allCompanies)) {

      allCompanies.forEach((c) => {

        if (c && c !== 'All Companies') {

          set.add(c)

        }

      })

    }

    dbCompanies.forEach((c) => set.add(c))

    accounts.forEach((a) => {

      if (a.companyName && !a.companyName.toLowerCase().includes('general treasury')) {

        set.add(a.companyName)

      }

    })

    return ['All Companies', ...Array.from(set).sort()]

  }, [allCompanies, dbCompanies, accounts])

  // Handlers for Finance / Admin

  const openAddBankModal = React.useCallback(() => {

    setAddBankForm((prev) => ({

      ...prev,

      companyName: isCompanyScoped

        ? assignedCompany

        : selectedCompany !== 'All Companies'

          ? selectedCompany

          : prev.companyName || '',

    }))

    setIsAddBankModalOpen(true)

  }, [isCompanyScoped, assignedCompany, selectedCompany])

  const handleCreateBank = async (e: React.FormEvent, keepOpen: boolean = false) => {

    e.preventDefault()

    if (!canManageBank || isSubmittingBank) return

    const startingNum = parseFloat(addBankForm.startingBalance) || 0

    const companyAssigned = addBankForm.companyName.trim() || 'General Treasury / Unassigned'

    const chosenBankName = addBankForm.bankName === 'Others' ? customBankName.trim() : addBankForm.bankName.trim()

    if (!chosenBankName) {

      notifyWarning('Please enter a bank name.')

      return

    }

    const computedCardLabel =

      addBankForm.cardLabel.trim() ||

      (addBankForm.accountName.trim()

        ? `${chosenBankName.toUpperCase()} · ${addBankForm.accountName.trim()}`

        : `${chosenBankName.toUpperCase()} · ${companyAssigned}`)

    setIsSubmittingBank(true)

    try {

      const newAccount = await bankService.createAccount({

        bankName: chosenBankName.toUpperCase(),

        accountName: addBankForm.accountName.trim(),

        accountNumber: addBankForm.accountNumber.trim() || undefined,

        companyName: companyAssigned,

        cardLabel: computedCardLabel,

        accountType: addBankForm.accountType,

        branch: addBankForm.branch.trim() || 'Central Corporate Branch',

        startingBalance: startingNum,

        colorTheme: addBankForm.colorTheme,

        notes: addBankForm.notes.trim(),

      }, user?.role)

      const updated = [newAccount, ...accounts.filter((a) => a.id !== newAccount.id)]

      saveAccounts(updated)

      setSelectedAccountId(newAccount.id)

      websocketService.emitLocal('BANK_UPDATED', { accountId: newAccount.id })

      if (

        selectedCompany !== 'All Companies' &&

        !isCompanyMatch(newAccount.companyName, selectedCompany)

      ) {

        setSelectedCompany(newAccount.companyName)

      }

      if (keepOpen) {

        setAddBankSuccessMessage(

          `✓ ${newAccount.bankName} (${newAccount.accountType}) created for ${companyAssigned}! You can now register another bank facility.`

        )

        setAddBankForm((prev) => ({

          ...prev,

          bankName:

            prev.bankName === 'CHINABANK'

              ? 'BDO UNIBANK'

              : prev.bankName === 'BDO UNIBANK'

                ? 'BPI'

                : 'METROBANK',

          accountName: '',

          accountNumber: '',

          cardLabel: '',

          startingBalance: '',

          branch: prev.branch,

          notes: '',

        }))

      } else {

        setIsAddBankModalOpen(false)

        setAddBankSuccessMessage(null)

        setCustomBankName('')

        setAddBankForm({

          bankName: 'CHINABANK',

          accountName: '',

          accountNumber: '',

          cardLabel: '',

          companyName: isCompanyScoped ? assignedCompany : (selectedCompany !== 'All Companies' ? selectedCompany : ''),

          accountType: 'Checking',

          branch: '',

          startingBalance: '',

          colorTheme: 'red',

          notes: '',

        })

      }

    } catch (err: any) {

      notifyError(err, 'Failed to create bank account.')

    } finally {

      setIsSubmittingBank(false)

    }

  }

  const handleCreateBankAndAddAnother = (e: React.MouseEvent) => {

    e.preventDefault()

    handleCreateBank(e, true)

  }

  const handleDeposit = async (e: React.FormEvent) => {

    e.preventDefault()

    if (!canManageBank || !activeAccount || isSubmittingDeposit) return

    const amountNum = parseFloat(depositForm.amount)

    if (isNaN(amountNum) || amountNum <= 0) {

      notifyWarning('Please enter a valid deposit amount.')

      return

    }

    setIsSubmittingDeposit(true)

    try {

      const updatedAccount = await bankService.deposit(activeAccount.id, {

        amount: amountNum,

        date: depositForm.date || '10/01/26',

        particulars: depositForm.particulars.trim() || 'Deposit Remittance',

        category: depositForm.category,

        referenceNo: depositForm.referenceNo.trim(),

      }, user?.role)

      const updated = accounts.map((a) => (a.id === updatedAccount.id ? updatedAccount : a))

      saveAccounts(updated)

      websocketService.emitLocal('BANK_UPDATED', { accountId: updatedAccount.id })

      setIsDepositModalOpen(false)

      setDepositForm({

        amount: '',

        date: '10/01/26',

        particulars: '',

        category: 'Bank Transfer',

        referenceNo: '',

      })

    } catch (err: any) {

      notifyError(err, 'Failed to process deposit.')

    } finally {

      setIsSubmittingDeposit(false)

    }

  }

  const handleWithdraw = async (e: React.FormEvent) => {

    e.preventDefault()

    if (!canManageBank || !activeAccount || isSubmittingWithdraw) return

    const amountNum = parseFloat(withdrawForm.amount)

    if (isNaN(amountNum) || amountNum <= 0) {

      notifyWarning('Please enter a valid withdrawal amount.')

      return

    }

    if (amountNum > activeAccount.currentBalance) {

      notifyWarning(`Withdrawal amount (${formatPHP(amountNum)}) cannot exceed the available bank balance of ${formatPHP(activeAccount.currentBalance)}.`)

      return

    }

    setIsSubmittingWithdraw(true)

    try {

      const updatedAccount = await bankService.withdraw(activeAccount.id, {

        amount: amountNum,

        date: withdrawForm.date || '10/01/26',

        particulars: withdrawForm.particulars.trim() || 'Withdrawal Settlement',

        category: withdrawForm.category,

        chequeNo: withdrawForm.chequeNo.trim(),

      }, user?.role)

      const updated = accounts.map((a) => (a.id === updatedAccount.id ? updatedAccount : a))

      saveAccounts(updated)

      websocketService.emitLocal('BANK_UPDATED', { accountId: updatedAccount.id })

      setIsWithdrawModalOpen(false)

      setWithdrawForm({

        amount: '',

        date: '10/01/26',

        chequeNo: '',

        particulars: '',

        category: 'Cheque',

      })

    } catch (err: any) {

      notifyError(err, 'Failed to process withdrawal.')

    } finally {

      setIsSubmittingWithdraw(false)

    }

  }

  // Export handlers

  const handleExportCsv = () => {

    setIsExportDropdownOpen(false)

    if (!activeAccount && !isAggregatedView) return

    const headers = ['Date', ...(isAggregatedView ? ['Company'] : []), 'Cheque No.', 'Particulars', 'Withdrawal', 'Deposit', 'Category', 'Current Balance']

    const rows = filteredTransactions.map((t) => [

      t.date,

      ...(isAggregatedView ? [`"${((t as any).companyName || '').replace(/"/g, '""')}"`] : []),

      t.chequeNo || '—',

      `"${t.particulars.replace(/"/g, '""')}"`,

      t.withdrawal ? t.withdrawal : '',

      t.deposit ? t.deposit : '',

      t.category,

      t.runningBalance,

    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)

    const link = document.createElement('a')

    link.setAttribute('href', encodedUri)

    const downloadName = isAggregatedView

      ? `bank_transactions_all_companies_${Date.now()}.csv`

      : `bank_transactions_${activeAccount?.bankName}_${activeAccount?.companyName.replace(/\s+/g, '_')}_${Date.now()}.csv`

    link.setAttribute('download', downloadName)

    document.body.appendChild(link)

    link.click()

    document.body.removeChild(link)

  }

  const handleExportPdf = () => {

    setIsExportDropdownOpen(false)

    if (!activeAccount) return

    const printWindow = window.open('', '_blank')

    if (!printWindow) return

    const rowsHtml =

      filteredTransactions.length === 0

        ? `<tr><td colspan="7" style="padding: 20px; text-align: center; color: #64748B;">No transactions recorded.</td></tr>`

        : filteredTransactions

          .map(

            (t) => `

          <tr>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${t.date}</td>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px; font-weight: 600;">${t.chequeNo || '—'}</td>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${t.particulars}</td>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #e11d48; font-weight: 600;">${t.withdrawal ? `₱${t.withdrawal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}</td>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 600;">${t.deposit ? `₱${t.deposit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}</td>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${t.category}</td>

            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">₱${t.runningBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>

          </tr>

        `

          )

          .join('')

    printWindow.document.write(`

      <!DOCTYPE html>

      <html>

        <head>

          <title>${activeAccount.companyName} - ${activeAccount.bankName} Statement</title>

          <style>

            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding: 24px; }

            h1 { font-size: 18px; margin: 0 0 4px; color: #960C01; }

            p { font-size: 12px; color: #64748B; margin: 0 0 16px; }

            table { width: 100%; border-collapse: collapse; margin-top: 10px; }

            th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748B; border-bottom: 2px solid #CBD5E1; }

            .summary { margin-top: 20px; padding: 12px 16px; background-color: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 12px; }

          </style>

        </head>

        <body>

          <h1>MCT Financial Management - Bank Management</h1>

          <p>Bank Statement for <strong>${activeAccount.companyName}</strong> · Bank: <strong>${activeAccount.bankName} (${activeAccount.accountNumber})</strong> · Current Balance: <strong>₱${activeAccount.currentBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></p>

          <table>

            <thead>

              <tr>

                <th>Date</th>

                <th>Cheque No.</th>

                <th>Particulars</th>

                <th style="text-align: right;">Withdrawal</th>

                <th style="text-align: right;">Deposit</th>

                <th>Category</th>

                <th style="text-align: right;">Current Balance</th>

              </tr>

            </thead>

            <tbody>

              ${rowsHtml}

            </tbody>

          </table>

          <script>window.onload = function() { window.print(); };</script>

        </body>

      </html>

    `)

    printWindow.document.close()

  }

  return (

    <div className="space-y-6 pb-12 max-w-[1600px] mx-auto animate-in fade-in duration-300 select-none">

      {/* 1. Header & Controls (Matching Reference Screenshot) */}

      <div className="space-y-4">

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">

          <div>



              <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">

                Bank Management

              </h1>

            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">

              Manage corporate bank accounts, monitor active balance.

            </p>

          </div>

          {/* Action Controls: Export and Add New Bank */}

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start shrink-0">

            {/* Manual Sync/Refresh Button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                bankService.invalidateCache()
                void fetchAccounts(true)
              }}
              title="Refresh bank accounts"
              className="h-10 sm:h-11 px-3 sm:px-3.5 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface shadow-xs transition-all cursor-pointer box-border"
            >
              <RefreshCw className={cn('h-4 w-4 text-focus/70', isLoading && 'animate-spin text-primary')} />
            </Button>
            {/* Export Dropdown Button (White for Finance since Add New Bank is red; Red for Supervisor/Audit) */}

            <div ref={exportDropdownRef} className="relative inline-block">

              <Button

                type="button"

                variant={canManageBank ? 'outline' : 'default'}

                onClick={() => setIsExportDropdownOpen((prev) => !prev)}

                className={cn(

                  'h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border',

                  canManageBank

                    ? 'border border-stroke/50 bg-white text-focus hover:bg-surface'

                    : 'bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white'

                )}

                aria-haspopup="true"

                aria-expanded={isExportDropdownOpen}

              >

                <Download className={cn('h-4 w-4 shrink-0', canManageBank ? 'text-focus/70' : 'text-white')} />

                <span>Export</span>

                <ChevronDown className={cn('h-3.5 w-3.5 ml-0.5', canManageBank ? 'text-muted-fg' : 'text-white/90')} />

              </Button>

              {isExportDropdownOpen && (

                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">

                  <button

                    type="button"

                    onClick={handleExportCsv}

                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"

                  >

                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />

                    <span>Download as CSV</span>

                  </button>

                  <button

                    type="button"

                    onClick={handleExportPdf}

                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"

                  >

                    <FileText className="w-4 h-4 text-rose-600 shrink-0" />

                    <span>Download as PDF</span>

                  </button>

                </div>

              )}

            </div>

            {/* Add New Bank Button (Finance & Admin only) */}

            {canManageBank && (

              <Button

                type="button"

                onClick={openAddBankModal}

                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"

              >

                <Plus className="h-4 w-4 shrink-0" />

                <span>Add New Bank</span>

              </Button>

            )}

          </div>

        </div>

        {/* Row 2: Search Bar & Filter Toolbar */}

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">

          {/* Extended Width Search Bar */}

          <div className="relative flex-1 w-full">

              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />

              <Input

                type="search"

                placeholder="Search by particulars, cheque no., or category..."

                value={tableSearchQuery}

                onChange={(e) => {

                  setTableSearchQuery(e.target.value)

                  setCurrentPage(1)

                }}

                className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"

              />

            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">

              {/* 1. Date Range Button / Display */}

              <DateRangePicker

                value={dateRange}

                onChange={(newRange) => setDateRange(newRange)}

                hidePresets

              />

              {/* 2. Deposit / Withdraw Dropdown Filter (Comes before Company) */}

              <div ref={txTypeDropdownRef} className="relative inline-block">

                <button

                  type="button"

                  onClick={() => {

                    setIsTxTypeDropdownOpen((prev) => !prev)

                    setIsCompanyDropdownOpen(false)

                    setIsExportDropdownOpen(false)

                  }}

                  className={cn(

                    'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',

                    isTxTypeDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'

                  )}

                >

                  <span className="font-semibold text-focus/90 truncate max-w-[150px]">

                    {txTypeFilter === 'All' ? 'Deposit / Withdraw' : txTypeFilter}

                  </span>

                  <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />

                </button>

                {isTxTypeDropdownOpen && (

                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">

                    <div className="space-y-1">

                      {[

                        { label: 'All Transactions', value: 'All' as const },

                        { label: 'Deposit', value: 'Deposit' as const },

                        { label: 'Withdrawal', value: 'Withdrawal' as const },

                      ].map((opt) => (

                        <button

                          key={opt.value}

                          type="button"

                          onClick={() => {

                            setTxTypeFilter(opt.value)

                            setIsTxTypeDropdownOpen(false)

                          }}

                          className={cn(

                            'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',

                            txTypeFilter === opt.value

                              ? 'bg-primary/10 text-primary font-semibold'

                              : 'text-focus/80 hover:bg-slate-50'

                          )}

                        >

                          <span>{opt.label}</span>

                          {txTypeFilter === opt.value && (

                            <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />

                          )}

                        </button>

                      ))}

                    </div>

                  </div>

                )}

              </div>

              {/* 3. Company Dropdown (Finance/Admin only) */}

              {!isCompanyScoped && (

                <div ref={companyDropdownRef} className="relative inline-block">

                  <button

                    type="button"

                    onClick={() => setIsCompanyDropdownOpen((prev) => !prev)}

                    className={cn(

                      'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',

                      isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'

                    )}

                  >

                    <Building2 className="h-4 w-4 text-muted-fg shrink-0" />

                    <span className="font-semibold text-focus/90 truncate max-w-[140px]">

                      {selectedCompany === 'All Companies' ? 'Company' : selectedCompany}

                    </span>

                    <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />

                  </button>

                  {isCompanyDropdownOpen && (

                    <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150 max-h-72 overflow-y-auto">

                      <div className="space-y-1">

                        {companyOptions.map((c) => (

                          <button

                            key={c}

                            type="button"

                            onClick={() => {

                              setSelectedCompany(c)

                              setIsCompanyDropdownOpen(false)

                              if (c !== 'All Companies') {

                                const matched = accounts.filter((a) => isCompanyMatch(a.companyName, c))

                                if (matched.length > 0) {

                                  setSelectedAccountId(matched[0].id)

                                }

                              }

                            }}

                            className={cn(

                              'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',

                              selectedCompany === c

                                ? 'bg-primary/10 text-primary font-semibold'

                                : 'text-focus/80 hover:bg-slate-50'

                            )}

                          >

                            <span className="truncate">{c}</span>

                            {selectedCompany === c && (

                              <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />

                            )}

                          </button>

                        ))}

                      </div>

                    </div>

                  )}

                </div>

              )}

            </div>

          </div>

        </div>

      {/* 2. Bank Cards Hero Section: Skeleton when loading, Empty State if 0 accounts, Full-Width for Single Account, Grid for Multi Accounts */}

      {isLoading ? (

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start animate-pulse">

          <div className="md:col-span-5 h-[295px] sm:h-[315px] lg:h-[320px] rounded-[28px] bg-slate-200/80 p-6 flex flex-col justify-between" />

          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div className="h-[295px] sm:h-[315px] lg:h-[320px] rounded-[28px] bg-slate-200/70" />

            <div className="h-[295px] sm:h-[315px] lg:h-[320px] rounded-[28px] bg-slate-200/70" />

          </div>

        </div>

      ) : roleScopedAccounts.length === 0 ? (

        <Card className="rounded-[28px] sm:rounded-[36px] p-8 sm:p-12 text-center border border-dashed border-stroke/40 bg-white shadow-xs flex flex-col items-center justify-center min-h-[220px]">

          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-4">

            <Landmark className="h-7 w-7" />

          </div>

          <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">

            No Corporate Bank Accounts Registered

          </h3>

          <p className="text-xs sm:text-sm text-muted-fg max-w-md mt-1 mb-5">

            {canManageBank

              ? 'No bank facilities have been registered yet. Click "Add Bank Account" to create your first corporate bank account.'

              : 'There are no active corporate bank accounts available for the selected company scope.'}

          </p>

          {canManageBank && (

            <Button

              type="button"

              onClick={openAddBankModal}

              className="rounded-full bg-[#960C01] hover:bg-[#800a01] text-white px-5 py-2 text-xs font-semibold cursor-pointer shadow-sm"

            >

              + Add Bank Account

            </Button>

          )}

        </Card>

      ) : isSingleAccount ? (

        /* SINGLE ACCOUNT FULL-WIDTH HERO CARD (Matching User's Reference Screenshot) */

        <div className="w-full space-y-3">

          <div

            onClick={handleCardClick}

            onDoubleClick={() => setIsCardDetailsModalOpen(true)}

            onTouchEnd={handleCardTouch}

            title="Double-click or click 'View Details' to inspect complete bank facility details"

            className={cn(

              'w-full rounded-[28px] sm:rounded-[36px] p-6 sm:p-8 md:p-10 text-white shadow-xl relative overflow-hidden flex flex-col justify-between h-[215px] sm:h-[245px] md:h-[260px] transition-all duration-300 border select-none cursor-pointer group',

              activeAccount?.colorTheme === 'grey'

                ? 'border-stone-700/60 hover:border-amber-400/50'

                : 'border-red-900/40 hover:border-amber-400/50'

            )}

            style={{

              background:

                activeAccount?.colorTheme === 'grey'

                  ? 'radial-gradient(ellipse at 42% 50%, rgba(254, 240, 138, 0.35) 0%, rgba(245, 158, 11, 0.2) 30%, transparent 60%), linear-gradient(115deg, #1c1917 0%, #292524 35%, #44403c 70%, #57534e 100%)'

                  : 'radial-gradient(ellipse at 42% 50%, rgba(254, 240, 138, 0.45) 0%, rgba(245, 158, 11, 0.28) 28%, transparent 58%), linear-gradient(115deg, #450300 0%, #680800 25%, #960C01 45%, #b91c1c 50%, #960C01 55%, #680800 80%, #450300 100%)',

            }}

          >

            {/* Luminous Diagonal Sunbeam / Gold Ray matching reference screenshot */}

            <div

              className="absolute -inset-y-16 left-[28%] sm:left-[32%] md:left-[35%] w-28 sm:w-36 md:w-48 -rotate-12 pointer-events-none opacity-60 mix-blend-screen blur-md"

              style={{

                background: 'linear-gradient(to right, transparent, rgba(254, 240, 138, 0.9), rgba(245, 158, 11, 0.65), transparent)',

              }}

            />

            <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-white/10 pointer-events-none" />

            {/* Top row: Bank Name, Account Name & Company Name */}

            <div className="flex items-start justify-between relative z-10">

              <div className="flex flex-col">

                <span className="font-black text-base sm:text-lg md:text-xl tracking-widest uppercase text-white/95 drop-shadow-sm">

                  {isAggregatedView ? 'Central Group Treasury' : (activeAccount?.bankName || 'MCT Corporate')}

                </span>

                <div className="flex items-center gap-2 mt-1">

                  <span className="text-xs sm:text-sm font-semibold text-white/90 drop-shadow-xs">

                    {isAggregatedView ? 'All Corporate Accounts' : (activeAccount?.accountName || 'Primary Account')}

                  </span>

                  {(isAggregatedView || activeAccount?.companyName) && (

                    <span className="text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-xs">

                      {isAggregatedView ? 'All Companies' : activeAccount?.companyName}

                    </span>

                  )}

                </div>

              </div>

              <span className="text-xs font-mono text-white/70">

                {isAggregatedView ? `${roleScopedAccounts.length} Registered Accounts` : `•••• ${activeAccount?.accountNumber?.slice(-4)}`}

              </span>

            </div>

            {/* Middle: Current Balance & Visibility Toggle */}

            <div className="my-auto relative z-10">

              <span className="text-xs sm:text-[13px] md:text-sm font-medium tracking-wide text-white/85 block">

                {isAggregatedView ? 'Total Group Liquidity' : 'Current Balance'}

              </span>

              <div className="flex items-center gap-3 mt-1.5">

                <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight tabular-nums text-white drop-shadow-md">

                  {showBalance

                    ? formatPHP(isAggregatedView ? totalGroupBalance : (activeAccount?.currentBalance || 0))

                    : '₱ ••••••••'}

                </h2>

                <button

                  type="button"

                  onClick={(e) => {

                    e.stopPropagation()

                    setShowBalance((prev) => !prev)

                  }}

                  className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"

                  title={showBalance ? 'Hide Balance' : 'Show Balance'}

                  aria-label="Toggle balance visibility"

                >

                  {showBalance ? (

                    <Eye className="h-5 w-5 sm:h-6 sm:w-6" />

                  ) : (

                    <EyeOff className="h-5 w-5 sm:h-6 sm:w-6" />

                  )}

                </button>

              </div>

            </div>

            {/* Bottom Row: White Circular Pen/Edit Action Button (Bottom Right) */}

            {canManageBank && (

              <div className="flex items-center justify-end relative z-10">

                <button

                  type="button"

                  onClick={(e) => {

                    e.stopPropagation()

                    setIsEditModalOpen(true)

                  }}

                  className="h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-white text-[#960C01] hover:bg-slate-100 flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer ml-auto"

                  title="Edit Bank Details"

                  aria-label="Edit Bank Details"

                >

                  <Pencil className="h-4 w-4" />

                </button>

              </div>

            )}

          </div>

        </div>

      ) : (isCompanyScoped || selectedCompany !== 'All Companies' || roleScopedAccounts.length <= 3) ? (

        /* COMPANY MULTI-BANK VIEW: Show 2 (or up to 3) Interactive ATM Cards Side-by-Side */

        <div

          className={cn(

            'grid grid-cols-1 gap-5 items-stretch',

            roleScopedAccounts.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'

          )}

        >

          {roleScopedAccounts.map((acc) => {

            const isSelected = acc.id === activeAccount?.id

            return (

              <div

                key={acc.id}

                onClick={(e) => {

                  setSelectedAccountId(acc.id)

                  handleCardClick(e)

                }}

                onDoubleClick={() => {

                  setSelectedAccountId(acc.id)

                  setIsCardDetailsModalOpen(true)

                }}

                onTouchEnd={(e) => {

                  setSelectedAccountId(acc.id)

                  handleCardTouch(e)

                }}

                title="Click to view this bank's transactions below; double-click for full bank details"

                className={cn(

                  'w-full rounded-[28px] sm:rounded-[32px] p-6 sm:p-8 text-white shadow-xl relative overflow-hidden flex flex-col justify-between h-[230px] sm:h-[255px] transition-all duration-300 border select-none cursor-pointer group',

                  acc.colorTheme === 'grey'

                    ? 'border-stone-700/60 hover:border-amber-400/70'

                    : 'border-red-900/40 hover:border-amber-400/70',

                  isSelected

                    ? 'ring-4 ring-[#960C01]/30 border-amber-400 shadow-2xl scale-[1.01]'

                    : 'opacity-85 hover:opacity-100'

                )}

                style={{

                  background:

                    acc.colorTheme === 'grey'

                      ? 'radial-gradient(ellipse at 42% 50%, rgba(254, 240, 138, 0.35) 0%, rgba(245, 158, 11, 0.2) 30%, transparent 60%), linear-gradient(115deg, #1c1917 0%, #292524 35%, #44403c 70%, #57534e 100%)'

                      : 'radial-gradient(ellipse at 42% 50%, rgba(254, 240, 138, 0.45) 0%, rgba(245, 158, 11, 0.28) 28%, transparent 58%), linear-gradient(115deg, #450300 0%, #680800 25%, #960C01 45%, #b91c1c 50%, #960C01 55%, #680800 80%, #450300 100%)',

                }}

              >

                {/* Luminous Diagonal Sunbeam / Gold Ray */}

                <div

                  className="absolute -inset-y-16 left-[28%] sm:left-[32%] w-28 sm:w-36 -rotate-12 pointer-events-none opacity-60 mix-blend-screen blur-md"

                  style={{

                    background:

                      'linear-gradient(to right, transparent, rgba(254, 240, 138, 0.9), rgba(245, 158, 11, 0.65), transparent)',

                  }}

                />

                <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-white/10 pointer-events-none" />

                {/* Top row: Bank Name & Viewing Status Badge */}

                <div className="flex items-start justify-between gap-2 relative z-10">

                  <div>

                    <span className="font-black text-base sm:text-lg md:text-xl tracking-widest uppercase text-white/95 drop-shadow-sm block">

                      {acc.bankName}

                    </span>

                    {acc.accountName && (

                      <span className="text-[11px] font-medium text-white/75 tracking-wide block mt-0.5">

                        {acc.accountName}

                      </span>

                    )}

                  </div>

                  {isSelected ? (

                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-amber-400 text-stone-950 shadow-xs shrink-0">

                      <Check className="h-3 w-3 stroke-[2.5]" />

                      <span>Viewing</span>

                    </span>

                  ) : (

                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10.5px] font-semibold bg-white/15 text-white/90 group-hover:bg-white/25 transition-colors shrink-0">

                      Click to view

                    </span>

                  )}

                </div>

                {/* Middle: Current Balance & Visibility Toggle */}

                <div className="my-auto relative z-10">

                  <span className="text-xs sm:text-[13px] font-medium tracking-wide text-white/85 block">

                    Current Balance

                  </span>

                  <div className="flex items-center gap-3 mt-1">

                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight tabular-nums text-white drop-shadow-md">

                      {showBalance ? formatPHP(acc.currentBalance || 0) : '₱ ••••••••'}

                    </h2>

                    <button

                      type="button"

                      onClick={(e) => {

                        e.stopPropagation()

                        setShowBalance((prev) => !prev)

                      }}

                      className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"

                      title={showBalance ? 'Hide Balance' : 'Show Balance'}

                      aria-label="Toggle balance visibility"

                    >

                      {showBalance ? (

                        <Eye className="h-5 w-5" />

                      ) : (

                        <EyeOff className="h-5 w-5" />

                      )}

                    </button>

                  </div>

                </div>

                {/* Bottom Row: Edit Action Button */}

                {canManageBank && (

                  <div className="flex items-center justify-end relative z-10">

                    <button

                      type="button"

                      onClick={(e) => {

                        e.stopPropagation()

                        setSelectedAccountId(acc.id)

                        setIsEditModalOpen(true)

                      }}

                      className="h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-white text-[#960C01] hover:bg-slate-100 flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer ml-auto"

                      title="Edit Bank Details"

                      aria-label="Edit Bank Details"

                    >

                      <Pencil className="h-4 w-4" />

                    </button>

                  </div>

                )}

              </div>

            )

          })}

        </div>

      ) : (

        /* MULTI-ACCOUNT TWO-COLUMN VIEW (Active Company ATM Card(s) on Left, Two Stacked Decks on Right) */

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">

          {/* LEFT COLUMN: Selected Company's Bank Card(s) (Shows 2 ATM cards when the selected company has 2 banks) */}

          <div className="md:col-span-5 flex flex-col gap-3">

            {(activeCompanyAccounts.length >= 2 ? activeCompanyAccounts : activeAccount ? [activeAccount] : []).map((acc) => {

              const isSelected = acc.id === activeAccount?.id

              const isCompactMulti = activeCompanyAccounts.length >= 2

              return (

                <div

                  key={acc.id}

                  onClick={(e) => {

                    setSelectedAccountId(acc.id)

                    handleCardClick(e)

                  }}

                  onDoubleClick={() => {

                    setSelectedAccountId(acc.id)

                    setIsCardDetailsModalOpen(true)

                  }}

                  onTouchEnd={(e) => {

                    setSelectedAccountId(acc.id)

                    handleCardTouch(e)

                  }}

                  title="Click to select this ATM card; double-click to view complete bank specifications"

                  className={cn(

                    'w-full rounded-[28px] p-5 sm:p-6 text-white shadow-xl relative overflow-hidden flex flex-col justify-between transition-all duration-300 border select-none cursor-pointer group',

                    isCompactMulti

                      ? 'h-[175px] sm:h-[185px]'

                      : 'h-[295px] sm:h-[315px] lg:h-[320px]',

                    acc.colorTheme === 'grey'

                      ? 'border-stone-700/60 hover:border-amber-400/50'

                      : 'border-red-900/40 hover:border-amber-400/50',

                    isCompactMulti && isSelected && 'ring-3 ring-[#960C01]/35 border-amber-400',

                    isCompactMulti && !isSelected && 'opacity-80 hover:opacity-100'

                  )}

                  style={{

                    background:

                      acc.colorTheme === 'grey'

                        ? 'radial-gradient(circle at 25% 85%, rgba(245, 158, 11, 0.38) 0%, rgba(217, 119, 6, 0.22) 30%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(254, 240, 138, 0.18) 0%, transparent 40%), linear-gradient(135deg, #1c1917 0%, #292524 35%, #44403c 70%, #57534e 100%)'

                        : 'radial-gradient(circle at 85% 15%, rgba(255, 215, 0, 0.28) 0%, transparent 45%), linear-gradient(135deg, #4a0500 0%, #780b02 30%, #960C01 65%, #c52d14 100%)',

                  }}

                >

                  {/* Luminous Satin Sheen & Sunset Gold Overlay */}

                  <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-white/10 pointer-events-none" />

                  <div className="absolute -right-8 -bottom-8 w-56 h-56 bg-amber-400/15 rounded-full blur-2xl pointer-events-none" />

                  <div className="absolute -left-12 -top-12 w-48 h-48 bg-stone-300/10 rounded-full blur-xl pointer-events-none" />

                  {acc.colorTheme === 'grey' && (

                    <div className="absolute left-6 bottom-4 w-44 h-44 bg-amber-500/20 rounded-full blur-2xl pointer-events-none" />

                  )}

                  {/* Top row: Bank Name & Active Badge when company has 2 banks */}

                  <div className="flex items-start justify-between gap-2 relative z-10">

                    <span className="font-black text-base sm:text-lg tracking-widest uppercase text-white/95 drop-shadow-sm">

                      {acc.bankName}

                    </span>

                    {isCompactMulti && (

                      isSelected ? (

                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-stone-950 shadow-xs shrink-0">

                          <Check className="h-2.5 w-2.5 stroke-[2.5]" />

                          <span>Viewing</span>

                        </span>

                      ) : (

                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/15 text-white/85 group-hover:bg-white/25 shrink-0">

                          Click to view

                        </span>

                      )

                    )}

                  </div>

                  {/* Middle: Current Balance & Visibility Toggle */}

                  <div className="my-auto relative z-10">

                    <span className="text-xs sm:text-[13px] font-medium tracking-wide text-white/85 block">

                      Current Balance

                    </span>

                    <div className="flex items-center gap-3 mt-1">

                      <h2

                        className={cn(

                          'font-extrabold tracking-tight tabular-nums text-white drop-shadow-md',

                          isCompactMulti ? 'text-xl sm:text-2xl lg:text-3xl' : 'text-2xl sm:text-3xl lg:text-4xl'

                        )}

                      >

                        {showBalance

                          ? formatPHP(acc.currentBalance || 0)

                          : '₱ ••••••••'}

                      </h2>

                      <button

                        type="button"

                        onClick={(e) => {

                          e.stopPropagation()

                          setShowBalance((prev) => !prev)

                        }}

                        className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"

                        title={showBalance ? 'Hide Balance' : 'Show Balance'}

                        aria-label="Toggle balance visibility"

                      >

                        {showBalance ? (

                          <Eye className="h-5 w-5" />

                        ) : (

                          <EyeOff className="h-5 w-5" />

                        )}

                      </button>

                    </div>

                  </div>

                  {/* Bottom Row: Edit Action Button */}

                  {canManageBank && (

                    <div className="flex items-center justify-end relative z-10">

                      <button

                        type="button"

                        onClick={(e) => {

                          e.stopPropagation()

                          setSelectedAccountId(acc.id)

                          setIsEditModalOpen(true)

                        }}

                        className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-white text-[#960C01] hover:bg-slate-100 flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer ml-auto"

                        title="Edit Bank Details"

                        aria-label="Edit Bank Details"

                      >

                        <Pencil className="h-4 w-4" />

                      </button>

                    </div>

                  )}

                </div>

              )

            })}

          </div>

          {/* RIGHT COLUMN: Two Stacked Decks of Overlapping Bank Cards (Red Stack & Warm Graphite Stack) */}

          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Deck 1: Red Overlapping Cards */}

            <div className="relative w-full h-[295px] sm:h-[315px] lg:h-[320px] rounded-[28px] overflow-hidden shadow-xl bg-gradient-to-b from-[#4a0500] to-[#780b02] border border-red-900/40 select-none">

              {redStackAccounts.length === 0 ? (

                <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 text-white/60">

                  <CreditCard className="h-8 w-8 mb-2 opacity-40" />

                  <span className="text-xs font-semibold">No Crimson Accounts</span>

                  <span className="text-[11px] text-white/40 mt-1">Commercial bank accounts with crimson theme will stack here</span>

                </div>

              ) : (

                redStackAccounts.map((acc, index) => {

                  const isSelected = acc.id === activeAccount?.id

                  const total = redStackAccounts.length

                  const step =

                    total <= 2 ? 52 : total <= 3 ? 46 : total <= 4 ? 40 : Math.max(28, Math.floor(180 / Math.max(1, total - 1)))

                  const topOffset = index * step

                  const isLast = index === total - 1

                  return (

                    <div

                      key={acc.id}

                      onClick={() => setSelectedAccountId(acc.id)}

                      className={cn(

                        'absolute left-0 right-0 cursor-pointer transition-all duration-200 group',

                        isLast ? 'bottom-0 rounded-b-[28px]' : 'rounded-t-[20px]'

                      )}

                      style={{

                        top: `${topOffset}px`,

                        bottom: 0,

                        zIndex: 10 + index,

                      }}

                    >

                      <div

                        className={cn(

                          'w-full h-full relative overflow-hidden transition-all duration-200',

                          isLast ? 'rounded-b-[28px]' : 'rounded-t-[20px]',

                          'border-t shadow-[0_-3px_10px_rgba(0,0,0,0.35)]',

                          'group-hover:-translate-y-1',

                          isSelected

                            ? 'border-t-2 border-amber-400 ring-1 ring-amber-400/30'

                            : 'border-white/25 hover:border-white/40'

                        )}

                        style={{

                          background:

                            'radial-gradient(circle at 85% 20%, rgba(255, 215, 0, 0.22) 0%, transparent 45%), linear-gradient(135deg, #580600 0%, #7e0b02 30%, #960C01 65%, #c22d14 100%)',

                        }}

                      >

                        {/* Satin Sheen overlay */}

                        <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-white/10 pointer-events-none" />

                        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full blur-xl pointer-events-none" />

                        {/* Card Tab Header with Company Name & Active indicator */}

                        <div className="px-4 sm:px-5 py-3 flex items-center justify-between relative z-10">

                          <span className="font-semibold text-xs sm:text-[13px] text-white/95 tracking-wide truncate max-w-[70%] drop-shadow-xs group-hover:text-white">

                            {getAccountCardLabel(acc)}

                          </span>

                          {isSelected ? (

                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-stone-950 shadow-xs shrink-0">

                              Viewing

                            </span>

                          ) : (

                            <span className="text-[10px] text-white/50 opacity-0 group-hover:opacity-100 transition-opacity font-medium shrink-0">

                              Click to view

                            </span>

                          )}

                        </div>

                      </div>

                    </div>

                  )

                })

              )}

            </div>

            {/* Deck 2: Warm Graphite & Gold Overlapping Cards */}

            <div className="relative w-full h-[295px] sm:h-[315px] lg:h-[320px] rounded-[28px] overflow-hidden shadow-xl bg-gradient-to-b from-[#1c1917] to-[#292524] border border-stone-700/60 select-none">

              {greyStackAccounts.length === 0 ? (

                <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 text-white/60">

                  <CreditCard className="h-8 w-8 mb-2 opacity-40" />

                  <span className="text-xs font-semibold">No Slate Accounts</span>

                  <span className="text-[11px] text-white/40 mt-1">Holdings & tech bank accounts with slate theme will stack here</span>

                </div>

              ) : (

                greyStackAccounts.map((acc, index) => {

                  const isSelected = acc.id === activeAccount?.id

                  const total = greyStackAccounts.length

                  const step =

                    total <= 2 ? 52 : total <= 3 ? 46 : total <= 4 ? 40 : Math.max(28, Math.floor(180 / Math.max(1, total - 1)))

                  const topOffset = index * step

                  const isLast = index === total - 1

                  return (

                    <div

                      key={acc.id}

                      onClick={() => setSelectedAccountId(acc.id)}

                      className={cn(

                        'absolute left-0 right-0 cursor-pointer transition-all duration-200 group',

                        isLast ? 'bottom-0 rounded-b-[28px]' : 'rounded-t-[20px]'

                      )}

                      style={{

                        top: `${topOffset}px`,

                        bottom: 0,

                        zIndex: 10 + index,

                      }}

                    >

                      <div

                        className={cn(

                          'w-full h-full relative overflow-hidden transition-all duration-200',

                          isLast ? 'rounded-b-[28px]' : 'rounded-t-[20px]',

                          'border-t shadow-[0_-3px_10px_rgba(0,0,0,0.45)]',

                          'group-hover:-translate-y-1',

                          isSelected

                            ? 'border-t-2 border-amber-400 ring-1 ring-amber-400/30'

                            : 'border-white/20 hover:border-white/40'

                        )}

                        style={{

                          background:

                            'radial-gradient(circle at 25% 85%, rgba(245, 158, 11, 0.35) 0%, rgba(217, 119, 6, 0.18) 30%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(254, 240, 138, 0.15) 0%, transparent 40%), linear-gradient(135deg, #1c1917 0%, #292524 35%, #44403c 70%, #57534e 100%)',

                        }}

                      >

                        {/* Warm Graphite & Amber Sheen overlay */}

                        <div className="absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-white/10 pointer-events-none" />

                        <div className="absolute left-6 bottom-4 w-32 h-32 bg-amber-400/20 rounded-full blur-xl pointer-events-none" />

                        <div className="absolute top-0 right-0 w-32 h-32 bg-stone-400/10 rounded-full blur-xl pointer-events-none" />

                        {/* Card Tab Header with Company Name & Active indicator */}

                        <div className="px-4 sm:px-5 py-3 flex items-center justify-between relative z-10">

                          <span className="font-semibold text-xs sm:text-[13px] text-white/95 tracking-wide truncate max-w-[70%] drop-shadow-xs group-hover:text-white">

                            {getAccountCardLabel(acc)}

                          </span>

                          {isSelected ? (

                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-stone-950 shadow-xs shrink-0">

                              Viewing

                            </span>

                          ) : (

                            <span className="text-[10px] text-white/50 opacity-0 group-hover:opacity-100 transition-opacity font-medium shrink-0">

                              Click to view

                            </span>

                          )}

                        </div>

                      </div>

                    </div>

                  )

                })

              )}

            </div>

          </div>

        </div>

      )}

      {/* 3. Bottom Section: Bank Banner Bar & Transactions Table */}

      <Card className="rounded-[24px] border border-stroke/20 bg-white shadow-xs overflow-hidden">

        {/* Grey Header Banner */}

        <div className="bg-[#E2E8F0] px-5 sm:px-6 py-3 border-b border-slate-300 flex items-center justify-between">

          <div className="flex items-center gap-2.5">

            <h3 className="font-bold text-base sm:text-lg text-slate-900 tracking-tight">

              {isAggregatedView

                ? 'All Companies • Unified Cash Ledger'

                : activeAccount

                ? `${activeAccount.bankName} • ${activeAccount.accountName} (${activeAccount.companyName})`

                : 'Bank Account'}

            </h3>

            <span className="text-xs font-semibold text-slate-700 bg-white/70 px-3 py-1 rounded-full border border-slate-300">

              {isAggregatedView ? 'All Accounts Aggregated' : 'Transactions'}

            </span>

            {selectedCompany === 'All Companies' && !isAggregatedView && (

              <button

                type="button"

                onClick={() => setSelectedAccountId('all')}

                className="text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2.5 py-0.5 rounded-full border border-blue-200 transition-colors cursor-pointer"

              >

                ← View All Accounts

              </button>

            )}

          </div>

          {/* Action buttons (Deposit & Withdraw) aligned right on the banner */}

          {canManageBank && (

            <div className="flex items-center gap-2 shrink-0">

              <Button

                type="button"

                disabled={!activeAccount}

                onClick={() => setIsDepositModalOpen(true)}

                className="h-8 sm:h-8.5 px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"

              >

                <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />

                <span>Deposit</span>

              </Button>

              <Button

                type="button"

                disabled={!activeAccount}

                onClick={() => setIsWithdrawModalOpen(true)}

                className="h-8 sm:h-8.5 px-3.5 rounded-full bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] disabled:opacity-50 text-white font-semibold text-xs shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"

              >

                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />

                <span>Withdraw</span>

              </Button>

            </div>

          )}

        </div>

        {/* Unified Table matching screenshot columns: DATE, CHEQUE NO., PARTICULARS, WITHDRAWAL, DEPOSIT, CATEGORY, CURRENT BALANCE */}

        <div className="overflow-x-auto rounded-xl border border-slate-100 mx-5 sm:mx-6 my-4">

          <Table className="w-full text-xs">

            <TableHeader>

              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-left w-[12%]">

                  DATE

                </TableHead>

                {isAggregatedView && (

                  <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-left w-[14%]">

                    COMPANY

                  </TableHead>

                )}

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-left w-[15%]">

                  CHEQUE NO.

                </TableHead>

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-left w-[28%]">

                  PARTICULARS

                </TableHead>

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-right w-[13%]">

                  WITHDRAWAL

                </TableHead>

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-right w-[13%]">

                  DEPOSIT

                </TableHead>

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-left w-[14%]">

                  CATEGORY

                </TableHead>

                <TableHead className="px-4 py-3.5 font-bold text-muted-fg uppercase tracking-wider text-xs text-right w-[15%]">

                  CURRENT BALANCE

                </TableHead>

              </TableRow>

            </TableHeader>

            <TableBody>

              {isLoading ? (

                Array.from({ length: 5 }).map((_, i) => (

                  <TableRow key={i} className="animate-pulse">

                    <TableCell className="px-4 py-3.5"><div className="h-4 w-20 bg-slate-200 rounded" /></TableCell>

                    {isAggregatedView && (

                      <TableCell className="px-4 py-3.5"><div className="h-4 w-24 bg-slate-200 rounded" /></TableCell>

                    )}

                    <TableCell className="px-4 py-3.5"><div className="h-4 w-24 bg-slate-200 rounded" /></TableCell>

                    <TableCell className="px-4 py-3.5"><div className="h-4 w-48 bg-slate-200 rounded" /></TableCell>

                    <TableCell className="px-4 py-3.5 text-right"><div className="h-4 w-20 bg-slate-200 rounded ml-auto" /></TableCell>

                    <TableCell className="px-4 py-3.5 text-right"><div className="h-4 w-20 bg-slate-200 rounded ml-auto" /></TableCell>

                    <TableCell className="px-4 py-3.5"><div className="h-4 w-24 bg-slate-200 rounded" /></TableCell>

                    <TableCell className="px-4 py-3.5 text-right"><div className="h-4 w-24 bg-slate-200 rounded ml-auto" /></TableCell>

                  </TableRow>

                ))

              ) : paginatedTransactions.length === 0 ? (

                <TableRow>

                  <TableCell colSpan={isAggregatedView ? 8 : 7} className="h-44 text-center py-8">

                    <div className="flex flex-col items-center justify-center text-muted-fg">

                      <CreditCard className="h-8 w-8 text-muted-fg/40 mb-2" />

                      <p className="text-sm font-semibold">No bank transactions found</p>

                      <p className="text-xs text-muted-fg/70 mt-0.5">

                        {tableSearchQuery ? 'Try clearing your search query' : 'Deposit or withdraw funds to record transactions'}

                      </p>

                    </div>

                  </TableCell>

                </TableRow>

              ) : (

                paginatedTransactions.map((tx) => (

                  <TableRow

                    key={tx.id}

                    onClick={() => {

                      setViewingBankTx({

                        id: tx.id,

                        refNo: tx.chequeNo || tx.id,

                        chequeNo: tx.chequeNo || '',

                        date: tx.date,

                        type: tx.withdrawal && tx.withdrawal > 0 ? 'Expense' : 'Sales',

                        company: (tx as any).companyName || activeAccount?.companyName || selectedCompany || 'MCT Group of Companies',

                        description: tx.particulars,

                        particulars: tx.particulars,

                        amount: tx.deposit || tx.withdrawal || 0,

                        withdrawal: tx.withdrawal || 0,

                        deposit: tx.deposit || 0,

                        category: tx.category as any,

                        paymentMethod: tx.chequeNo ? 'Cheque' : 'Bank Transfer',

                        status: 'Paid',

                        auditStatus: (tx as any).auditStatus || 'Pending Audit',

                        createdAt: tx.date,

                        attachments: [],

                      })

                      setIsViewTxModalOpen(true)

                    }}

                    title="Click to view complete particulars and transaction breakdown"

                    className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer text-xs"

                  >

                    {/* Date */}

                    <TableCell className="px-4 py-3.5 font-mono text-xs text-muted-fg whitespace-nowrap">

                      {tx.date}

                    </TableCell>

                    {/* Company Name (Aggregated View) */}

                    {isAggregatedView && (

                      <TableCell className="px-4 py-3.5 font-medium text-xs text-focus whitespace-nowrap">

                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200" title={(tx as any).companyName}>

                          {(tx as any).companyName || 'Corporate'}

                        </span>

                      </TableCell>

                    )}

                    {/* Cheque No */}

                    <TableCell className="px-4 py-3.5 font-mono text-xs font-semibold text-focus whitespace-nowrap">

                      {tx.chequeNo || '—'}

                    </TableCell>

                    {/* Particulars */}

                    <TableCell className="px-4 py-3.5 font-medium text-xs text-focus max-w-xs" title={tx.particulars}>

                      {(() => {

                        const summary = getParticularsSummary(tx.particulars)

                        if (summary.count > 1) {

                          return (

                            <div className="flex items-center gap-1.5 min-w-0">

                              <span className="truncate block font-medium">{summary.firstItemName}</span>

                              <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">

                                +{summary.count - 1} more

                              </span>

                            </div>

                          )

                        }

                        return <span className="truncate block font-medium">{summary.firstItemName}</span>

                      })()}

                    </TableCell>

                    {/* Withdrawal */}

                    <TableCell className="px-4 py-3.5 font-semibold text-xs text-rose-600 text-right whitespace-nowrap">

                      {tx.withdrawal ? `₱ ${tx.withdrawal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : ''}

                    </TableCell>

                    {/* Deposit */}

                    <TableCell className="px-4 py-3.5 font-semibold text-xs text-emerald-600 text-right whitespace-nowrap">

                      {tx.deposit ? `₱ ${tx.deposit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : ''}

                    </TableCell>

                    {/* Category */}

                    <TableCell className="px-4 py-3.5 text-xs text-muted-fg whitespace-nowrap">

                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-focus/80">

                        {tx.category}

                      </span>

                    </TableCell>

                    {/* Current Balance */}

                    <TableCell className="px-4 py-3.5 font-bold text-xs text-focus text-right whitespace-nowrap tabular-nums">

                      ₱ {tx.runningBalance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}

                    </TableCell>

                  </TableRow>

                ))

              )}

            </TableBody>

          </Table>

        </div>

        {/* Pagination Footer */}

        <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg border-t border-slate-100">

          <span>

            {filteredTransactions.length === 0

              ? 'Showing 0 of 0 records'

              : `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1}-${Math.min(currentPage * ITEMS_PER_PAGE, filteredTransactions.length)} of ${filteredTransactions.length} records`}

          </span>

          <div className="flex items-center gap-2 self-end sm:self-auto">

            <span className="italic">

              Page {currentPage} out of {totalPages}

            </span>

            <Button

              type="button"

              variant="outline"

              size="sm"

              disabled={currentPage <= 1}

              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}

              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 cursor-pointer"
              aria-label="Previous page"

            >

              <ChevronLeft className="w-4 h-4" />

            </Button>

            <Button

              type="button"

              variant="outline"

              size="sm"

              disabled={currentPage >= totalPages}

              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}

              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 cursor-pointer"
              aria-label="Next page"

            >

              <ChevronRight className="w-4 h-4" />

            </Button>

          </div>

        </div>

      </Card>

      {/* 4. MODALS (Standardized UI matching System Modals) */}

      {/* Modal A: Add New Bank Account */}

      <Dialog open={isAddBankModalOpen} onOpenChange={setIsAddBankModalOpen}>

        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">

          <DialogHeader className="space-y-1.5 pb-2">

            <div className="flex items-center gap-3">

              <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center">

                <Landmark className="h-5 w-5" />

              </div>

              <div>

                <DialogTitle className="text-lg font-bold text-focus">

                  Add Corporate Bank Account

                </DialogTitle>

                <DialogDescription className="text-xs text-muted-fg">

                  Register a corporate bank facility for Treasury and Central Accounting.

                </DialogDescription>

              </div>

            </div>

          </DialogHeader>

          {addBankSuccessMessage && (

            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-in fade-in">

              <Check className="h-4 w-4 text-emerald-600 shrink-0" />

              <span>{addBankSuccessMessage}</span>

            </div>

          )}

          <form onSubmit={handleCreateBank} className="space-y-3.5 mt-2">

            <div className="grid grid-cols-2 gap-3">

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Bank Name <span className="text-red-500">*</span>

                </label>

                <select

                  value={addBankForm.bankName}

                  onChange={(e) => setAddBankForm({ ...addBankForm, bankName: e.target.value })}

                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"

                >

                  <option value="CHINABANK">CHINABANK</option>

                  <option value="BDO UNIBANK">BDO UNIBANK</option>

                  <option value="BPI">BPI</option>

                  <option value="METROBANK">METROBANK</option>

                  <option value="UNIONBANK">UNIONBANK</option>

                  <option value="SECURITY BANK">SECURITY BANK</option>

                  <option value="RCBC">RCBC</option>

                  <option value="LANDBANK">LANDBANK</option>

                  <option value="PNB">PNB</option>

                  <option value="EASTWEST">EASTWEST</option>

                  <option value="Others">Others (Specify)</option>

                </select>

                {addBankForm.bankName === 'Others' && (

                  <div className="mt-2">

                    <label className="text-2xs font-semibold text-focus block mb-1">

                      Specify Bank Name <span className="text-red-500">*</span>

                    </label>

                    <Input

                      required

                      value={customBankName}

                      onChange={(e) => setCustomBankName(e.target.value)}

                      placeholder="e.g. Maya Bank, Seabank, GoTyme"

                      className="h-9 text-xs rounded-xl"

                    />

                  </div>

                )}

              </div>

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Account Type <span className="text-red-500">*</span>

                </label>

                <select

                  value={addBankForm.accountType}

                  onChange={(e) =>

                    setAddBankForm({

                      ...addBankForm,

                      accountType: e.target.value as BankAccount['accountType'],

                    })

                  }

                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"

                >

                  <option value="Checking">Checking Account</option>

                  <option value="Savings">Savings Account</option>

                  <option value="Payroll">Payroll Account</option>

                  <option value="Time Deposit">Time Deposit</option>

                </select>

              </div>

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Account Name <span className="text-red-500">*</span>

              </label>

              <Input

                required

                value={addBankForm.accountName}

                onChange={(e) => setAddBankForm({ ...addBankForm, accountName: e.target.value })}

                placeholder="e.g. Bagong Bansa May Pagasa Movement"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Card Display Label <span className="text-xs text-muted-fg font-normal">(Optional tab title)</span>

              </label>

              <Input

                value={addBankForm.cardLabel}

                onChange={(e) => setAddBankForm({ ...addBankForm, cardLabel: e.target.value })}

                placeholder="e.g. BDO · Operations Checking"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Company Owner <span className="text-xs text-muted-fg font-normal">(Optional)</span>

              </label>

              <select

                disabled={isCompanyScoped}

                value={addBankForm.companyName}

                onChange={(e) => setAddBankForm({ ...addBankForm, companyName: e.target.value })}

                className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"

              >

                <option value="">None / Unassigned (General Treasury)</option>

                {companyOptions

                  .filter((c) => c !== 'All Companies')

                  .map((c) => (

                    <option key={c} value={c}>

                      {c}

                    </option>

                  ))}

              </select>

            </div>

            <div className="grid grid-cols-2 gap-3">

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Initial / Starting Balance (₱) <span className="text-red-500">*</span>

                </label>

                <Input

                  required

                  type="number"

                  min="0"

                  step="any"

                  value={addBankForm.startingBalance}

                  onChange={(e) => setAddBankForm({ ...addBankForm, startingBalance: e.target.value })}

                  placeholder="1000000"

                  className="h-10 text-xs sm:text-sm rounded-xl"

                />

              </div>

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Card Theme

                </label>

                <select

                  value={addBankForm.colorTheme}

                  onChange={(e) => setAddBankForm({ ...addBankForm, colorTheme: e.target.value as 'red' | 'grey' })}

                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"

                >

                  <option value="red">Crimson Red (Commercial)</option>

                  <option value="grey">Slate Metallic (Holdings/Tech)</option>

                </select>

              </div>

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Branch Location

              </label>

              <Input

                value={addBankForm.branch}

                onChange={(e) => setAddBankForm({ ...addBankForm, branch: e.target.value })}

                placeholder="e.g. Quezon Avenue Branch, QC"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-100">

              <Button

                type="button"

                variant="outline"

                disabled={isSubmittingBank}

                onClick={() => {

                  setIsAddBankModalOpen(false)

                  setAddBankSuccessMessage(null)

                }}

                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"

              >

                Cancel

              </Button>

              <Button

                type="button"

                variant="outline"

                disabled={isSubmittingBank}

                onClick={handleCreateBankAndAddAnother}

                className="h-10 px-4 rounded-xl text-xs font-semibold border-primary/60 text-primary hover:bg-primary/10 disabled:opacity-60 cursor-pointer"

              >

                + Save & Add Another Bank

              </Button>

              <Button

                type="submit"

                disabled={isSubmittingBank}

                className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] disabled:opacity-60 text-white cursor-pointer flex items-center gap-2"

              >

                {isSubmittingBank && <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}

                <span>{isSubmittingBank ? 'Saving...' : 'Save Bank Account'}</span>

              </Button>

            </div>

          </form>

        </DialogContent>

      </Dialog>

      {/* Modal B: Deposit Funds */}

      <Dialog open={isDepositModalOpen} onOpenChange={setIsDepositModalOpen}>

        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">

          <DialogHeader className="space-y-1.5 pb-2">

            <div className="flex items-center gap-3">

              <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">

                <ArrowDownLeft className="h-5 w-5" />

              </div>

              <div>

                <DialogTitle className="text-lg font-bold text-focus">

                  Deposit to {activeAccount?.bankName}

                </DialogTitle>

                <DialogDescription className="text-xs text-muted-fg">

                  Crediting funds to {activeAccount?.companyName} ({activeAccount?.accountNumber}).

                </DialogDescription>

              </div>

            </div>

          </DialogHeader>

          <form onSubmit={handleDeposit} className="space-y-3.5 mt-2">

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Deposit Amount (₱) <span className="text-red-500">*</span>

              </label>

              <Input

                required

                type="number"

                min="0.01"

                step="any"

                value={depositForm.amount}

                onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}

                placeholder="e.g. 180000"

                className="h-10 text-xs sm:text-sm rounded-xl font-semibold"

              />

            </div>

            <div className="grid grid-cols-2 gap-3">

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Transaction Date <span className="text-red-500">*</span>

                </label>

                <Input

                  required

                  value={depositForm.date}

                  onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}

                  placeholder="10/01/26"

                  className="h-10 text-xs sm:text-sm rounded-xl"

                />

              </div>

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Category

                </label>

                <select

                  value={depositForm.category}

                  onChange={(e) => setDepositForm({ ...depositForm, category: e.target.value })}

                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus"

                >

                  <option value="Bank Transfer">Bank Transfer</option>

                  <option value="Cheque">Cheque Deposit</option>

                  <option value="Cash">Cash Deposit</option>

                  <option value="Online Payment">Online Payment</option>

                </select>

              </div>

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Particulars / Description <span className="text-red-500">*</span>

              </label>

              <Input

                required

                value={depositForm.particulars}

                onChange={(e) => setDepositForm({ ...depositForm, particulars: e.target.value })}

                placeholder="e.g. Point-of-Sale Daily Remittance"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Reference / Trace No.

              </label>

              <Input

                value={depositForm.referenceNo}

                onChange={(e) => setDepositForm({ ...depositForm, referenceNo: e.target.value })}

                placeholder="e.g. TR-99014"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">

              <Button

                type="button"

                variant="outline"

                disabled={isSubmittingDeposit}

                onClick={() => setIsDepositModalOpen(false)}

                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"

              >

                Cancel

              </Button>

              <Button

                type="submit"

                disabled={isSubmittingDeposit}

                className="h-10 px-5 rounded-xl text-xs font-semibold bg-primary hover:bg-primary-hover disabled:opacity-60 text-white cursor-pointer flex items-center gap-2"

              >

                {isSubmittingDeposit && <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}

                <span>{isSubmittingDeposit ? 'Processing...' : 'Confirm Deposit'}</span>

              </Button>

            </div>

          </form>

        </DialogContent>

      </Dialog>

      {/* Modal C: Withdraw Funds */}

      <Dialog open={isWithdrawModalOpen} onOpenChange={setIsWithdrawModalOpen}>

        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">

          <DialogHeader className="space-y-1.5 pb-2">

            <div className="flex items-center gap-3">

              <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">

                <ArrowUpRight className="h-5 w-5" />

              </div>

              <div>

                <DialogTitle className="text-lg font-bold text-focus">

                  Withdraw from {activeAccount?.bankName}

                </DialogTitle>

                <DialogDescription className="text-xs text-muted-fg">

                  Available Balance: <strong className="text-focus">{formatPHP(activeAccount?.currentBalance || 0)}</strong>

                </DialogDescription>

              </div>

            </div>

          </DialogHeader>

          <form onSubmit={handleWithdraw} className="space-y-3.5 mt-2">

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Withdrawal Amount (₱) <span className="text-red-500">*</span>

              </label>

              <Input

                required

                type="number"

                min="0.01"

                step="any"

                value={withdrawForm.amount}

                onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}

                placeholder="e.g. 45000"

                className="h-10 text-xs sm:text-sm rounded-xl font-semibold"

              />

            </div>

            <div className="grid grid-cols-2 gap-3">

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Transaction Date <span className="text-red-500">*</span>

                </label>

                <Input

                  required

                  value={withdrawForm.date}

                  onChange={(e) => setWithdrawForm({ ...withdrawForm, date: e.target.value })}

                  placeholder="10/01/26"

                  className="h-10 text-xs sm:text-sm rounded-xl"

                />

              </div>

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Category

                </label>

                <select

                  value={withdrawForm.category}

                  onChange={(e) => setWithdrawForm({ ...withdrawForm, category: e.target.value })}

                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus"

                >

                  <option value="Cheque">Cheque</option>

                  <option value="Bank Transfer">Bank Transfer</option>

                  <option value="Cash">Cash</option>

                  <option value="Online Payment">Online Payment</option>

                </select>

              </div>

            </div>

            <div className="grid grid-cols-2 gap-3">

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Cheque No. (or Ref No.)

                </label>

                <Input

                  value={withdrawForm.chequeNo}

                  onChange={(e) => setWithdrawForm({ ...withdrawForm, chequeNo: e.target.value })}

                  placeholder="e.g. CHQ-8895"

                  className="h-10 text-xs sm:text-sm rounded-xl font-mono"

                />

              </div>

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Particulars <span className="text-red-500">*</span>

                </label>

                <Input

                  required

                  value={withdrawForm.particulars}

                  onChange={(e) => setWithdrawForm({ ...withdrawForm, particulars: e.target.value })}

                  placeholder="e.g. Warehouse Lease"

                  className="h-10 text-xs sm:text-sm rounded-xl"

                />

              </div>

            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">

              <Button

                type="button"

                variant="outline"

                disabled={isSubmittingWithdraw}

                onClick={() => setIsWithdrawModalOpen(false)}

                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"

              >

                Cancel

              </Button>

              <Button

                type="submit"

                disabled={isSubmittingWithdraw}

                className="h-10 px-5 rounded-xl text-xs font-semibold bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white cursor-pointer flex items-center gap-2"

              >

                {isSubmittingWithdraw && <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}

                <span>{isSubmittingWithdraw ? 'Processing...' : 'Confirm Withdrawal'}</span>

              </Button>

            </div>

          </form>

        </DialogContent>

      </Dialog>

      {/* Modal D: Activity Log */}

      <Dialog open={isActivityLogOpen} onOpenChange={setIsActivityLogOpen}>

        <DialogContent className="sm:max-w-[800px] bg-white rounded-[24px] p-6 shadow-2xl max-h-[85vh] overflow-y-auto">

          <DialogHeader className="space-y-1 pb-2 border-b border-slate-100">

            <div className="flex items-center gap-3">

              <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center">

                <History className="h-5 w-5" />

              </div>

              <div>

                <DialogTitle className="text-lg font-bold text-focus">

                  Bank Treasury Activity Log

                </DialogTitle>

                <DialogDescription className="text-xs text-muted-fg">

                  Chronological records of deposits, withdrawals, and balance movements across corporate accounts.

                </DialogDescription>

              </div>

            </div>

          </DialogHeader>

          <div className="space-y-2.5 mt-3">

            {accounts.flatMap((acc) =>

              acc.transactions.map((tx) => ({

                ...tx,

                bankName: acc.bankName,

                companyName: acc.companyName,

              }))

            ).length === 0 ? (

              <p className="text-center text-xs text-muted-fg py-8">No recent activity logged.</p>

            ) : (

              accounts

                .flatMap((acc) =>

                  acc.transactions.map((tx) => ({

                    ...tx,

                    bankName: acc.bankName,

                    companyName: acc.companyName,

                  }))

                )

                .slice(0, 15)

                .map((log) => (

                  <div

                    key={log.id}

                    className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs"

                  >

                    <div>

                      <div className="flex items-center gap-2">

                        <span className="font-bold text-focus">{log.companyName}</span>

                        <span className="text-[10.5px] px-2 py-0.2 bg-white border rounded font-mono text-muted-fg">

                          {log.bankName}

                        </span>

                      </div>

                      <p className="text-muted-fg text-[11.5px] mt-0.5">

                        {log.particulars} {log.chequeNo && log.chequeNo !== '—' && `(${log.chequeNo})`} · {log.category}

                      </p>

                    </div>

                    <div className="text-right">

                      {log.withdrawal ? (

                        <span className="font-bold text-rose-600 block">

                          -₱{log.withdrawal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}

                        </span>

                      ) : (

                        <span className="font-bold text-emerald-600 block">

                          +₱{(log.deposit || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}

                        </span>

                      )}

                      <span className="text-[10px] text-muted-fg font-mono">{log.date}</span>

                    </div>

                  </div>

                ))

            )}

          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">

            <Button

              type="button"

              variant="outline"

              onClick={() => setIsActivityLogOpen(false)}

              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"

            >

              Close

            </Button>

          </div>

        </DialogContent>

      </Dialog>

      {/* Modal E: Edit Bank Account Details */}

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>

        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">

          <DialogHeader className="space-y-1.5 pb-2">

            <div className="flex items-center gap-3">

              <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center">

                <Pencil className="h-5 w-5" />

              </div>

              <div>

                <DialogTitle className="text-lg font-bold text-focus">

                  Edit Bank Details

                </DialogTitle>

                <DialogDescription className="text-xs text-muted-fg">

                  Update account information for {activeAccount?.bankName}.

                </DialogDescription>

              </div>

            </div>

          </DialogHeader>

          <form onSubmit={handleSaveEditAccount} className="space-y-3.5 mt-2">

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Account Name <span className="text-red-500">*</span>

              </label>

              <Input

                required

                value={editAccountForm.accountName}

                onChange={(e) => setEditAccountForm({ ...editAccountForm, accountName: e.target.value })}

                className="h-10 text-xs sm:text-sm rounded-xl font-medium"

              />

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Branch Location

              </label>

              <Input

                value={editAccountForm.branch}

                onChange={(e) => setEditAccountForm({ ...editAccountForm, branch: e.target.value })}

                placeholder="e.g. Quezon Avenue Main Branch, Quezon City"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div className="grid grid-cols-2 gap-3">

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Starting Balance <span className="text-xs text-muted-fg font-normal">(View Only)</span>

                </label>

                <Input

                  disabled

                  value={formatPHP(editAccountForm.startingBalance)}

                  className="h-10 text-xs sm:text-sm rounded-xl bg-slate-50 text-slate-600 font-semibold cursor-not-allowed select-none"

                />

              </div>

              <div>

                <label className="text-xs font-semibold text-focus block mb-1">

                  Current Balance (₱) <span className="text-red-500">*</span>

                </label>

                <Input

                  required

                  type="number"

                  step="any"

                  value={editAccountForm.currentBalance}

                  onChange={(e) => setEditAccountForm({ ...editAccountForm, currentBalance: e.target.value })}

                  className="h-10 text-xs sm:text-sm rounded-xl font-semibold text-focus"

                />

              </div>

            </div>

            <div>

              <label className="text-xs font-semibold text-focus block mb-1">

                Notes & Instructions

              </label>

              <Input

                value={editAccountForm.notes}

                onChange={(e) => setEditAccountForm({ ...editAccountForm, notes: e.target.value })}

                placeholder="Operating settlement instructions or remarks"

                className="h-10 text-xs sm:text-sm rounded-xl"

              />

            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">

              <Button

                type="button"

                variant="outline"

                disabled={isSubmittingEdit}

                onClick={() => setIsEditModalOpen(false)}

                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"

              >

                Cancel

              </Button>

              <Button

                type="submit"

                disabled={isSubmittingEdit}

                className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] disabled:opacity-60 text-white cursor-pointer flex items-center gap-2"

              >

                {isSubmittingEdit && <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />}

                <span>{isSubmittingEdit ? 'Saving...' : 'Save Changes'}</span>

              </Button>

            </div>

          </form>

        </DialogContent>

      </Dialog>

      {/* Modal F: Full Pop-up ATM Card Details (Triggered on Double Click / Double Tap) */}

      <Dialog open={isCardDetailsModalOpen} onOpenChange={setIsCardDetailsModalOpen}>

        <DialogContent hideCloseButton className="sm:max-w-[720px] bg-white rounded-[24px] p-6 shadow-modal overflow-hidden max-h-[85vh] overflow-y-auto">

          <DialogHeader className="space-y-1.5 pb-2 border-b border-slate-100">

            <div className="flex items-center gap-3">

              <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center">

                <Landmark className="h-5 w-5" />

              </div>

              <div>

                <DialogTitle className="text-lg font-bold text-focus">

                  Bank Facility Specifications

                </DialogTitle>

                <DialogDescription className="text-xs text-muted-fg">

                  Complete account profile and institutional parameters

                </DialogDescription>

              </div>

            </div>

          </DialogHeader>

          {/* Visual ATM Card Replica */}

          <div

            className={cn(

              'w-full rounded-[24px] p-6 text-white shadow-xl relative overflow-hidden flex flex-col justify-between h-[180px] my-3 border select-none',

              activeAccount?.colorTheme === 'grey'

                ? 'border-stone-700/60'

                : 'border-red-900/40'

            )}

            style={{

              background:

                activeAccount?.colorTheme === 'grey'

                  ? 'radial-gradient(circle at 25% 85%, rgba(245, 158, 11, 0.38) 0%, rgba(217, 119, 6, 0.22) 30%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(254, 240, 138, 0.18) 0%, transparent 40%), linear-gradient(135deg, #1c1917 0%, #292524 35%, #44403c 70%, #57534e 100%)'

                  : 'radial-gradient(circle at 85% 15%, rgba(255, 215, 0, 0.28) 0%, transparent 45%), linear-gradient(135deg, #4a0500 0%, #780b02 30%, #960C01 65%, #c52d14 100%)',

            }}

          >

            <div className="absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-white/10 pointer-events-none" />

            {activeAccount?.colorTheme === 'grey' && (

              <div className="absolute left-6 bottom-4 w-40 h-40 bg-amber-500/20 rounded-full blur-2xl pointer-events-none" />

            )}

            <div className="flex items-start justify-between relative z-10">

              <span className="text-xs font-semibold uppercase tracking-wider text-white/80">

                {activeAccount?.companyName || 'General Treasury / Unassigned'}

              </span>

              <span className="font-black text-base tracking-widest uppercase text-white drop-shadow-sm">

                {activeAccount?.bankName}

              </span>

            </div>

            <div className="relative z-10 my-auto">

              <span className="text-[11px] text-white/70 block uppercase tracking-wider">Current Balance</span>

              <span className="text-3xl font-extrabold tracking-tight text-white tabular-nums drop-shadow-md">

                {formatPHP(activeAccount?.currentBalance || 0)}

              </span>

            </div>

            <div className="flex items-center justify-between text-xs text-white/80 relative z-10 border-t border-white/15 pt-2">

              <span className="font-medium">{activeAccount?.accountType} Facility</span>

              <span className="truncate max-w-[220px]">{activeAccount?.branch}</span>

            </div>

          </div>

          {/* Full Details Grid */}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mt-1">

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">

              <span className="text-[11px] text-muted-fg font-medium block">Bank Institution</span>

              <span className="font-bold text-focus text-sm mt-0.5 block">{activeAccount?.bankName}</span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">

              <span className="text-[11px] text-muted-fg font-medium block">Account Facility Type</span>

              <span className="font-bold text-focus text-sm mt-0.5 block">{activeAccount?.accountType} Account</span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 sm:col-span-2">

              <span className="text-[11px] text-muted-fg font-medium block">Account Name</span>

              <span className="font-bold text-focus text-sm mt-0.5 block">{activeAccount?.accountName}</span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">

              <span className="text-[11px] text-muted-fg font-medium block">Company Ownership</span>

              <span className="font-semibold text-focus mt-0.5 block truncate">

                {activeAccount?.companyName || 'None / Unassigned (General Treasury)'}

              </span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">

              <span className="text-[11px] text-muted-fg font-medium block">Branch Location</span>

              <span className="font-semibold text-focus mt-0.5 block truncate">

                {activeAccount?.branch || 'Central Corporate Branch'}

              </span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">

              <span className="text-[11px] text-muted-fg font-medium block">Starting / Initial Balance</span>

              <span className="font-semibold text-slate-700 text-sm mt-0.5 block">

                {formatPHP(activeAccount?.startingBalance || 0)}

              </span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">

              <span className="text-[11px] text-muted-fg font-medium block">Current Balance</span>

              <span className="font-extrabold text-emerald-700 text-sm mt-0.5 block">

                {formatPHP(activeAccount?.currentBalance || 0)}

              </span>

            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 sm:col-span-2">

              <span className="text-[11px] text-muted-fg font-medium block">Registered Notes & Purpose</span>

              <span className="text-focus/90 text-xs mt-1 block">

                {activeAccount?.notes || 'Operating settlement account for general corporate treasury management.'}

              </span>

            </div>

          </div>

          {canManageBank && (

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 mt-3">

              <Button

                type="button"

                onClick={() => {

                  setIsCardDetailsModalOpen(false)

                  setIsEditModalOpen(true)

                }}

                className="h-10 px-4 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer"

              >

                <Pencil className="h-3.5 w-3.5 mr-1.5" />

                Edit Bank Details

              </Button>

            </div>

          )}

        </DialogContent>

      </Dialog>

      {/* Modal: View Bank Transaction Breakdown & Particulars */}

      <AuditTransactionModal

        open={isViewTxModalOpen}

        onOpenChange={setIsViewTxModalOpen}

        transaction={viewingBankTx}

      />

    </div>

  )

}

export default BankManagementPage

