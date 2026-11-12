import { websocketService, type SyncEventType } from './websocketService'
import { isCompanyMatch } from '@/utils/companyUtils'

export interface BankTransaction {

  id: string
  bankAccountId?: string
  date: string
  chequeNo?: string
  particulars: string
  withdrawal?: number
  deposit?: number
  category: string
  netAmount: number
  /** Which owner company this entry belongs to (matters only on shared bank accounts) */
  companyName?: string
  /** 'manual' = typed directly in Bank Management */
  entrySource?: string
  timestamp?: string
  createdAt?: string
}

export interface BankAccount {
  id: string
  bankName: string
  accountName: string
  accountNumber: string
  companyName: string
  /** Every owner company of this account, primary first. More than one = shared account. */
  companyNames: string[]
  companyId?: number
  cardLabel?: string
  accountType: 'Checking' | 'Savings' | 'Payroll' | 'Time Deposit'
  branch: string
  currentBalance: number
  startingBalance: number
  colorTheme: 'red' | 'grey'
  transactions: BankTransaction[]
  createdAt?: string
  notes?: string
}

/** A bank is shared when more than one company owns it. */
export function isSharedAccount(acc?: BankAccount | null): boolean {
  return !!acc && (acc.companyNames?.length || 0) > 1
}

/** True when `company` is any one of the account's owner companies (alias-aware). */
export function isAccountOwnedBy(acc: Pick<BankAccount, 'companyName' | 'companyNames'>, company: string): boolean {
  const owners = acc.companyNames?.length ? acc.companyNames : [acc.companyName]
  return owners.some((o) => isCompanyMatch(o || '', company))
}

/** True when `company` is the ONLY owner of the account (not a shared bank). */
export function isSoleOwner(acc: Pick<BankAccount, 'companyName' | 'companyNames'>, company: string): boolean {
  const owners = acc.companyNames?.length ? acc.companyNames : [acc.companyName]
  return owners.length === 1 && isAccountOwnedBy(acc, company)
}

/**
 * The company's banks ordered for picking a default: banks it owns alone first, then banks it shares
 * with other companies. Order within each group is kept, so `[0]` is the right default bank.
 */
export function preferSoleOwnedBanks<T extends Pick<BankAccount, 'companyName' | 'companyNames'>>(accounts: T[], company: string): T[] {
  if (!company || company === 'All Companies') return accounts
  return [...accounts].sort((a, b) => Number(isSoleOwner(b, company)) - Number(isSoleOwner(a, company)))
}

export interface NewBankAccountInput {
  bankName: string
  accountName: string
  accountNumber?: string
  companyName: string
  companyNames?: string[]
  companyId?: number
  cardLabel?: string
  accountType?: 'Checking' | 'Savings' | 'Payroll' | 'Time Deposit'
  branch?: string
  startingBalance?: number
  colorTheme?: 'red' | 'grey'
  notes?: string
}

export interface DepositWithdrawInput {
  amount: number
  date?: string
  particulars?: string
  category?: string
  chequeNo?: string
  referenceNo?: string
  companyName?: string
}

const BANK_CACHE_STORAGE_KEY = 'mct_bank_accounts_cache_v1'
const BANK_CACHE_TTL_MS = 60000 // 60s fresh TTL, with instant stale-while-revalidate

interface CachedBankAccountsEntry {
  data: BankAccount[]
  timestamp: number
}

const memoryBankCache = new Map<string, CachedBankAccountsEntry>()
const inFlightRequests = new Map<string, Promise<BankAccount[]>>()

function normalizeCacheKey(companyName?: string): string {
  const normalized = (companyName || '').trim().toLowerCase()
  if (!normalized || normalized === 'all companies') return '__ALL__'
  return normalized
}

// Purge legacy session storage to eliminate clear-text storage of bank accounts
if (typeof window !== 'undefined') {
  try {
    sessionStorage.removeItem(BANK_CACHE_STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}

// Automatically invalidate bank cache when real-time updates arrive
if (typeof window !== 'undefined') {
  const bankEvents: SyncEventType[] = [
    'BANK_UPDATED',
    'TRANSACTION_UPDATED',
    'EXPENSE_CREATED',
    'EXPENSE_UPDATED',
    'EXPENSE_DELETED',
    'SALES_UPDATED',
    'LOANS_UPDATED',
    'PETTY_CASH_UPDATED',
    'AUDIT_UPDATED',
  ]
  bankEvents.forEach((ev) => {
    websocketService.subscribe(ev, () => {
      clearBankCache()
    })
  })
}

function clearBankCache(): void {
  memoryBankCache.clear()
  inFlightRequests.clear()
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(BANK_CACHE_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}

function backendHeaders(userRole?: string): Record<string, string> {
  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('mct_access_token') ||
        sessionStorage.getItem('auth_token') ||
        localStorage.getItem('auth_token')
      : null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (userRole) {
    headers['X-User-Role'] = userRole
  }
  return headers
}

function mapAccountFromBackend(raw: any): BankAccount {
  const txs = Array.isArray(raw.transactions)
    ? raw.transactions.map((t: any) => ({
        id: t.id,
        bankAccountId: t.bank_account_id,
        date: t.transaction_date,
        chequeNo: t.cheque_no || undefined,
        particulars: t.particulars,
        withdrawal: Number(t.withdrawal || 0),
        deposit: Number(t.deposit || 0),
        category: t.category,
        netAmount: Number(t.net_amount || 0),
        companyName: t.company_name || undefined,
        entrySource: t.entry_source || undefined,
        createdAt: t.created_at,
      }))
    : []

  return {
    id: raw.id,
    bankName: raw.bank_name,
    accountName: raw.account_name,
    accountNumber: raw.account_number,
    companyName: raw.company_name,
    companyNames:
      Array.isArray(raw.company_names) && raw.company_names.length > 0
        ? raw.company_names
        : [raw.company_name].filter(Boolean),
    companyId: raw.company_id,
    cardLabel: raw.card_label || raw.account_name || raw.company_name,
    accountType: (raw.account_type as any) || 'Checking',
    branch: raw.branch || 'Central Corporate Branch',
    currentBalance: Number(raw.current_balance || 0),
    startingBalance: Number(raw.starting_balance || 0),
    colorTheme: (raw.color_theme as any) || 'red',
    transactions: txs,
    createdAt: raw.created_at ? String(raw.created_at).split('T')[0] : undefined,
    notes: raw.notes || undefined,
  }
}

async function handleResponseError(res: Response): Promise<Error> {
  try {
    const data = await res.json()
    if (data && data.detail) {
      return new Error(
        typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
      )
    }
  } catch {
    // fallback
  }
  return new Error(`Request failed with status ${res.status}`)
}

async function fetchAccountsFromNetwork(companyName?: string): Promise<BankAccount[]> {
  const key = normalizeCacheKey(companyName)
  const existingFlight = inFlightRequests.get(key)
  if (existingFlight) return existingFlight

  const promise = (async () => {
    try {
      const url =
        companyName && companyName.trim().toLowerCase() !== 'all companies'
          ? `/api/v1/bank-accounts?company_name=${encodeURIComponent(companyName.trim())}`
          : '/api/v1/bank-accounts'
      const res = await fetch(url, {
        headers: backendHeaders(),
      })
      if (!res.ok) throw await handleResponseError(res)
      const data = await res.json()
      const accounts = Array.isArray(data) ? data.map(mapAccountFromBackend) : []
      const entry: CachedBankAccountsEntry = {
        data: accounts,
        timestamp: Date.now(),
      }
      memoryBankCache.set(key, entry)
      return accounts
    } finally {
      inFlightRequests.delete(key)
    }
  })()

  inFlightRequests.set(key, promise)
  return promise
}

export const bankService = {
  invalidateCache(): void {
    clearBankCache()
  },

  /**
   * Synchronously returns cached bank accounts for instant UI initialization (0ms delay).
   * Falls back to filtering the all-companies cache if a specific company cache isn't warm yet.
   */
  getCachedAccounts(companyName?: string): BankAccount[] {
    const key = normalizeCacheKey(companyName)
    const mem = memoryBankCache.get(key)
    if (mem && mem.data.length > 0) return mem.data

    // Fallback: check __ALL__ cache and filter by company name (alias + shared-owner aware)
    if (key !== '__ALL__' && companyName) {
      const allMem = memoryBankCache.get('__ALL__')
      if (allMem && Array.isArray(allMem.data) && allMem.data.length > 0) {
        const filtered = allMem.data.filter((b) => isAccountOwnedBy(b, companyName))
        if (filtered.length > 0) return filtered
      }
    }

    return []
  },

  /**
   * Warms the cache in the background without blocking callers.
   */
  prefetchAccounts(companyName?: string): void {
    fetchAccountsFromNetwork(companyName).catch(() => {
      // ignore background prefetch errors
    })
  },

  async getAccounts(
    companyName?: string,
    options?: { forceRefresh?: boolean }
  ): Promise<BankAccount[]> {
    const key = normalizeCacheKey(companyName)
    if (!options?.forceRefresh) {
      const mem = memoryBankCache.get(key)
      if (mem && Array.isArray(mem.data) && mem.data.length > 0) {
        // If still fresh, return immediately; if stale, revalidate in background and return cached immediately
        if (Date.now() - mem.timestamp >= BANK_CACHE_TTL_MS) {
          fetchAccountsFromNetwork(companyName).catch(() => {})
        }
        return mem.data
      }
    }

    return fetchAccountsFromNetwork(companyName)
  },

  async getAccount(id: string): Promise<BankAccount> {
    const res = await fetch(`/api/v1/bank-accounts/${encodeURIComponent(id)}`, {
      headers: backendHeaders(),
    })
    if (!res.ok) throw await handleResponseError(res)
    const data = await res.json()
    return mapAccountFromBackend(data)
  },

  async createAccount(
    input: NewBankAccountInput,
    userRole?: string
  ): Promise<BankAccount> {
    const payload = {
      bank_name: input.bankName,
      account_name: input.accountName,
      account_number: input.accountNumber || undefined,
      company_name: input.companyName,
      company_names: input.companyNames && input.companyNames.length > 0 ? input.companyNames : undefined,
      company_id: input.companyId,
      card_label: input.cardLabel || input.accountName,
      account_type: input.accountType || 'Checking',
      branch: input.branch || 'Central Corporate Branch',
      starting_balance: input.startingBalance || 0,
      color_theme: input.colorTheme || 'red',
      notes: input.notes || undefined,
    }

    const res = await fetch('/api/v1/bank-accounts', {
      method: 'POST',
      headers: backendHeaders(userRole),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw await handleResponseError(res)
    const data = await res.json()
    clearBankCache()
    return mapAccountFromBackend(data)
  },

  async updateAccount(
    id: string,
    input: Partial<NewBankAccountInput>,
    userRole?: string
  ): Promise<BankAccount> {
    const payload: Record<string, any> = {}
    if (input.bankName) payload.bank_name = input.bankName
    if (input.accountName) payload.account_name = input.accountName
    if (input.accountNumber) payload.account_number = input.accountNumber
    if (input.companyName) payload.company_name = input.companyName
    if (input.companyNames) payload.company_names = input.companyNames
    if (input.companyId !== undefined) payload.company_id = input.companyId
    if (input.cardLabel) payload.card_label = input.cardLabel
    if (input.accountType) payload.account_type = input.accountType
    if (input.branch) payload.branch = input.branch
    if (input.colorTheme) payload.color_theme = input.colorTheme
    if (input.notes !== undefined) payload.notes = input.notes

    const res = await fetch(`/api/v1/bank-accounts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: backendHeaders(userRole),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw await handleResponseError(res)
    const data = await res.json()
    clearBankCache()
    return mapAccountFromBackend(data)
  },

  async deleteAccount(id: string, userRole?: string): Promise<void> {
    const res = await fetch(`/api/v1/bank-accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: backendHeaders(userRole),
    })
    if (!res.ok) throw await handleResponseError(res)
    clearBankCache()
  },

  async deposit(
    id: string,
    input: DepositWithdrawInput,
    userRole?: string
  ): Promise<BankAccount> {
    const payload = {
      amount: input.amount,
      date: input.date,
      particulars: input.particulars,
      category: input.category || 'Bank Transfer',
      reference_no: input.referenceNo,
      company_name: input.companyName,
    }

    const res = await fetch(
      `/api/v1/bank-accounts/${encodeURIComponent(id)}/deposit`,
      {
        method: 'POST',
        headers: backendHeaders(userRole),
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) throw await handleResponseError(res)
    const data = await res.json()
    clearBankCache()
    return mapAccountFromBackend(data)
  },

  async withdraw(
    id: string,
    input: DepositWithdrawInput,
    userRole?: string
  ): Promise<BankAccount> {
    const payload = {
      amount: input.amount,
      date: input.date,
      particulars: input.particulars,
      category: input.category || 'Cheque',
      cheque_no: input.chequeNo,
      company_name: input.companyName,
    }

    const res = await fetch(
      `/api/v1/bank-accounts/${encodeURIComponent(id)}/withdraw`,
      {
        method: 'POST',
        headers: backendHeaders(userRole),
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) throw await handleResponseError(res)
    const data = await res.json()
    clearBankCache()
    return mapAccountFromBackend(data)
  },

  /** Re-sync every bank with the Transactions ledger (posts only the differences). Finance / Admin. */
  async reconcileAll(userRole?: string): Promise<{
    sales_checked: number
    expenses_checked: number
    entries_posted: number
    balances_fixed: number
    accounts_still_off: Record<string, string>
  }> {
    const res = await fetch('/api/v1/bank-accounts/reconcile', {
      method: 'POST',
      headers: backendHeaders(userRole),
    })
    if (!res.ok) throw await handleResponseError(res)
    clearBankCache()
    return res.json()
  },
}
