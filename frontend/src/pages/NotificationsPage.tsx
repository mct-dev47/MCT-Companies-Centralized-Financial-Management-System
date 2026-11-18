import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  Clock,
  AlertCircle,
  Search,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { websocketService, type ConnectionStatus } from '@/services/websocketService'
import {
  notificationService,
  NOTIFICATION_UPDATED_EVENT,
  READ_STORAGE_KEY_PREFIX,
  getReadStorageKey,
  getReadNotificationIds,
  saveReadNotificationId,
  saveAllReadNotificationIds,
  sanitizeNotificationText,
  type NotificationItemOut,
} from '@/services/notificationService'
import {
  type TabId,
  type ParsedNotification,
  type NotificationItemOrGroup,
  getInitials,
  getAvatarColor,
  formatRelativeTime,
  formatCurrencyPHP,
  parseNotificationDetails,
  groupPaymentNotifications,
  filterNotificationsByTab,
  calculateTabUnreadCounts,
  partitionBySection,
  getNotificationRedirectUrl,
} from '@/lib/notificationHelpers'

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'due_dates', label: 'Due Dates' },
  { id: 'bills', label: 'Bills' },
  { id: 'lending', label: 'Lending' },
  { id: 'other', label: 'Other' },
]

export const NotificationsPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, status } = useSession()
  const { activeCompany } = useCompany()

  const userId = user?.id ?? null
  const isAuthenticated = status === 'authenticated' && Boolean(user)

  const [activeTab, setActiveTab] = React.useState<TabId>('all')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [notifications, setNotifications] = React.useState<ParsedNotification[]>([])
  const [readIds, setReadIds] = React.useState<Set<string>>(() => getReadNotificationIds(userId))
  const [isLoading, setIsLoading] = React.useState(false)
  const [syncError, setSyncError] = React.useState<string | null>(null)
  const [wsStatus, setWsStatus] = React.useState<ConnectionStatus>('offline')
  const [expandedGroupIds, setExpandedGroupIds] = React.useState<Set<string>>(new Set())

  const isFetchingRef = React.useRef(false)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    setReadIds(getReadNotificationIds(userId))
    if (!isAuthenticated) {
      setNotifications([])
    }
  }, [userId, isAuthenticated])

  const userRole = (user?.role || '').toLowerCase()
  const isAdmin = userRole === 'admin'
  const scopedCompanyName = isAdmin
    ? 'All Companies'
    : activeCompany || user?.assignedCompany || 'All Companies'

  const fetchLiveNotifications = React.useCallback(
    async (forceRefresh = false) => {
      if (!isAuthenticated) return
      if (isFetchingRef.current && !forceRefresh) return

      isFetchingRef.current = true
      setIsLoading((prev) => (notifications.length === 0 ? true : prev))

      try {
        const items: NotificationItemOut[] = await notificationService.getNotifications({
          userId,
          companyName: scopedCompanyName,
          userRole: userRole || undefined,
          limit: 150,
          forceRefresh,
        })

        if (!mountedRef.current) return

        const readSet = getReadNotificationIds(userId)
        setSyncError(null)

        const mapped: ParsedNotification[] = items.map((item) => {
          const nt = (item.notification_type || '').toUpperCase()
          const refType = (item.reference_type || '').toLowerCase()

          let category: 'bills' | 'lending' | 'other' = 'other'
          let categoryLabel = 'General'
          let isDueReminder = false

          if (refType === 'bill' || nt.startsWith('BILL_')) {
            category = 'bills'
            categoryLabel = 'Bills'
          } else if (
            refType === 'lending' ||
            refType === 'borrower' ||
            nt.startsWith('LENDING_')
          ) {
            category = 'lending'
            categoryLabel = 'Lending'
          } else if (refType === 'loan' || refType === 'loan_repayment' || nt.startsWith('LOAN_')) {
            category = 'other'
            categoryLabel = 'Loan'
          } else if (refType === 'tenant' || nt.startsWith('TENANT_')) {
            category = 'other'
            categoryLabel = 'Tenants'
          } else if (refType === 'petty_cash' || nt.startsWith('PETTY_CASH_')) {
            category = 'other'
            categoryLabel = 'Petty Cash'
          } else if (refType === 'deposit' || refType === 'sale' || nt.startsWith('DEPOSIT_')) {
            category = 'other'
            categoryLabel = 'Sales'
          } else if (refType === 'expense' || nt.startsWith('EXPENSE_')) {
            category = 'other'
            categoryLabel = 'Expenses'
          } else if (refType === 'activity_log' || nt === 'SYSTEM_ACTIVITY_NOTICE') {
            category = 'other'
            categoryLabel = 'System'
          }

          if (
            nt.includes('OVERDUE') ||
            nt.includes('DUE_TODAY') ||
            nt.includes('DUE_TOMORROW') ||
            nt.includes('DUE_SOON')
          ) {
            isDueReminder = true
          }

          const isUnread = !readSet.has(item.notification_id) && !item.read_at

          return parseNotificationDetails({
            id: item.notification_id,
            notification_type: item.notification_type,
            title: sanitizeNotificationText(item.title),
            message: sanitizeNotificationText(item.message),
            created_at: item.created_at,
            unread: isUnread,
            category,
            categoryLabel,
            refType: item.reference_type,
            refId: item.reference_id,
            isDueReminder,
            extra_data: item.extra_data,
          })
        })

        setReadIds(readSet)
        setNotifications(mapped)
      } catch (err) {
        if (!mountedRef.current) return
        const friendly = formatUserFriendlyErrorMessage(
          err,
          'Unable to sync notifications. Please check your connection or try again.'
        )
        setSyncError(friendly)
      } finally {
        isFetchingRef.current = false
        if (mountedRef.current) {
          setIsLoading(false)
        }
      }
    },
    [isAuthenticated, userId, scopedCompanyName, userRole, notifications.length]
  )

  React.useEffect(() => {
    if (!isAuthenticated) return
    void fetchLiveNotifications(false)

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void fetchLiveNotifications(false)
    }, 30000)

    return () => clearInterval(timer)
  }, [isAuthenticated, fetchLiveNotifications])

  React.useEffect(() => {
    if (!isAuthenticated) return
    setWsStatus(websocketService.getStatus())

    const handleRefresh = () => {
      void fetchLiveNotifications(true)
    }

    const handleStatusChange = (newStatus: ConnectionStatus) => {
      setWsStatus(newStatus)
    }

    const handleStorageSync = (event: StorageEvent) => {
      try {
        const targetKey = getReadStorageKey(userId)
        if (event.key === targetKey || event.key === READ_STORAGE_KEY_PREFIX) {
          const latestReadSet = getReadNotificationIds(userId)
          setReadIds(latestReadSet)
          setNotifications((prev) =>
            prev.map((n) => ({ ...n, unread: !latestReadSet.has(n.id) }))
          )
        }
      } catch {}
    }

    window.addEventListener(NOTIFICATION_UPDATED_EVENT, handleRefresh)
    window.addEventListener('storage', handleStorageSync)

    const unsubs = [
      websocketService.subscribe('WS_STATUS_CHANGE', handleStatusChange),
      websocketService.subscribe('NOTIFICATION_RECEIVED', handleRefresh),
      websocketService.subscribe('LOANS_UPDATED', handleRefresh),
      websocketService.subscribe('PETTY_CASH_UPDATED', handleRefresh),
      websocketService.subscribe('TENANTS_UPDATED', handleRefresh),
      websocketService.subscribe('LENDING_UPDATED', handleRefresh),
      websocketService.subscribe('AUDIT_UPDATED', handleRefresh),
      websocketService.subscribe('SALES_UPDATED', handleRefresh),
    ]

    return () => {
      window.removeEventListener(NOTIFICATION_UPDATED_EVENT, handleRefresh)
      window.removeEventListener('storage', handleStorageSync)
      unsubs.forEach((off) => off())
    }
  }, [isAuthenticated, userId, fetchLiveNotifications])

  const tabCounts = React.useMemo(
    () => calculateTabUnreadCounts(notifications),
    [notifications]
  )
  const unreadCount = tabCounts.all

  const searchedNotifications = React.useMemo(() => {
    if (!searchQuery.trim()) return notifications
    const q = searchQuery.toLowerCase().trim()
    return notifications.filter((n) => {
      if (n.title.toLowerCase().includes(q)) return true
      if (n.message.toLowerCase().includes(q)) return true
      if (n.borrowerName && n.borrowerName.toLowerCase().includes(q)) return true
      if (n.loanRef && n.loanRef.toLowerCase().includes(q)) return true
      if (n.txRef && n.txRef.toLowerCase().includes(q)) return true
      return false
    })
  }, [notifications, searchQuery])

  const groupedList = React.useMemo(
    () => groupPaymentNotifications(searchedNotifications),
    [searchedNotifications]
  )

  const filteredList = React.useMemo(
    () => filterNotificationsByTab(groupedList, activeTab),
    [groupedList, activeTab]
  )

  const sections = React.useMemo(
    () => partitionBySection(filteredList),
    [filteredList]
  )

  const markAllAsRead = async () => {
    try {
      const allIds = notifications.map((n) => n.id)
      saveAllReadNotificationIds(allIds, userId)
      setReadIds(new Set([...readIds, ...allIds]))
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })))
      await notificationService.markAllRead(undefined, userId)
    } catch (err) {
      const friendly = formatUserFriendlyErrorMessage(err, 'Unable to mark all notifications as read.')
      setSyncError(friendly)
    }
  }

  const handleItemClick = (item: ParsedNotification) => {
    try {
      if (item.unread) {
        saveReadNotificationId(item.id, userId)
        setReadIds((prev) => new Set([...prev, item.id]))
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, unread: false } : n))
        )
        void notificationService.markAsRead(item.id, userId)
      }
    } catch {}

    const targetUrl = getNotificationRedirectUrl(item)
    navigate(targetUrl)
  }

  const handleGroupClick = (group: NotificationItemOrGroup) => {
    if (!group.isGroup) {
      handleItemClick(group)
      return
    }

    try {
      const unreadChildren = group.children.filter((c) => c.unread)
      if (unreadChildren.length > 0) {
        const ids = unreadChildren.map((c) => c.id)
        for (const cid of ids) {
          saveReadNotificationId(cid, userId)
          void notificationService.markAsRead(cid, userId)
        }
        setReadIds((prev) => new Set([...prev, ...ids]))
        setNotifications((prev) =>
          prev.map((n) => (ids.includes(n.id) ? { ...n, unread: false } : n))
        )
      }
    } catch {}

    const firstChild = group.children[0]
    if (firstChild) {
      navigate(getNotificationRedirectUrl(firstChild))
    } else {
      navigate('/lending')
    }
  }

  return (
    <div className="space-y-6 w-full max-w-[1200px] mx-auto pb-12 animate-in fade-in duration-150">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-[#1B2330]">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-[#8B1A1A] text-white rounded-full">
                {unreadCount > 99 ? '99+' : unreadCount} new
              </span>
            )}
          </div>
          <p className="text-sm text-[#5B6470]">
            Review all alerts, payments, due dates, and reminders across companies.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={markAllAsRead}
              className="text-xs font-semibold text-[#8B1A1A] border-[#8B1A1A]/30 hover:bg-[#FBF3F3] cursor-pointer"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Mark all as read
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void fetchLiveNotifications(true)}
            className="text-xs text-[#5B6470] hover:text-[#1B2330] cursor-pointer gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Sync Error Banner */}
      {syncError && (
        <div className="bg-amber-50 border border-amber-200/80 rounded-xl px-4 py-3 flex items-center justify-between text-xs text-amber-900">
          <span className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 text-amber-700 shrink-0" />
            <span>{syncError}</span>
          </span>
          <button
            type="button"
            onClick={() => void fetchLiveNotifications(true)}
            className="font-bold underline hover:text-amber-950 flex items-center gap-1 cursor-pointer shrink-0 ml-4"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Main Content Container */}
      <Card className="rounded-2xl border border-[#EEF0F3] shadow-xs overflow-hidden bg-white">
        {/* Controls Bar: Tabs & Search */}
        <div className="p-4 sm:p-5 border-b border-[#EEF0F3] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Underline Tabs */}
          <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id
              const count = tabCounts[tab.id]
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'pb-2.5 text-[16px] transition-all flex items-center gap-2 shrink-0 cursor-pointer border-b-2',
                    isActive
                      ? 'border-[#8B1A1A] text-[#8B1A1A] font-bold'
                      : 'border-transparent text-[#5B6470] hover:text-[#1B2330] font-medium'
                  )}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs font-bold',
                        isActive ? 'bg-[#8B1A1A] text-white' : 'bg-[#EEF1F5] text-[#3A4350]'
                      )}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Search Input: Increased width to 480px */}
          <div className="relative w-full md:w-[480px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5B6470]" />
            <Input
              type="text"
              placeholder="Search notifications by title, borrower, loan or TX ref..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 text-sm rounded-xl border-[#EEF0F3] focus-visible:ring-[#8B1A1A]"
            />
          </div>
        </div>

        {/* Notifications List */}
        <div className="divide-y divide-[#EEF0F3]">
          {isLoading && notifications.length === 0 ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4, 5].map((id) => (
                <div key={id} className="flex items-start gap-4 animate-pulse">
                  <div className="w-11 h-11 rounded-full bg-slate-200 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                    <div className="h-3.5 bg-slate-200 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : sections.length === 0 ? (
            <div className="py-20 px-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2 ring-8 ring-emerald-50/50">
                <Check className="w-7 h-7 stroke-[2.5]" />
              </div>
              <h3 className="font-bold text-[#1B2330] text-base">You&apos;re all caught up</h3>
              <p className="text-xs text-[#5B6470] max-w-sm mx-auto">
                {searchQuery
                  ? `No notifications found matching "${searchQuery}".`
                  : 'There are no active notifications in this category.'}
              </p>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.id}>
                {/* Section Header */}
                <div className="bg-[#FAFBFD] px-6 py-2.5 border-b border-[#EEF0F3]">
                  <span className="text-xs font-bold tracking-wider text-[#5B6470] uppercase">
                    {section.title}
                  </span>
                </div>

                {/* Section Rows */}
                <div className="divide-y divide-[#EEF0F3]">
                  {section.items.map((item) => {
                    if (item.isGroup) {
                      const isExpanded = expandedGroupIds.has(item.id)
                      const avatarColors = getAvatarColor(item.borrowerName)
                      const initials = getInitials(item.borrowerName)

                      return (
                        <div
                          key={item.id}
                          onClick={() => handleGroupClick(item)}
                          className={cn(
                            'flex items-start gap-4 px-6 py-4 text-left transition-colors cursor-pointer min-h-[52px]',
                            item.unread
                              ? 'bg-[#FBF3F3] hover:bg-[#F7EBEB]'
                              : 'bg-white hover:bg-slate-50'
                          )}
                        >
                          {/* 44px Avatar */}
                          <div className="relative shrink-0 mt-0.5">
                            <div
                              style={{
                                backgroundColor: avatarColors.bg,
                                color: avatarColors.text,
                              }}
                              className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm select-none"
                            >
                              {initials}
                            </div>
                            <div className="w-5 h-5 rounded-full border-2 border-white absolute -bottom-0.5 -right-0.5 bg-[#0B8A44] flex items-center justify-center text-white">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </div>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] leading-snug text-[#1B2330]">
                              <span className="font-bold">{item.borrowerName}</span> made{' '}
                              {item.paymentCount} payments ·{' '}
                              <span className="font-bold">
                                {formatCurrencyPHP(item.totalAmount)}
                              </span>{' '}
                              total
                            </p>

                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              <span className="bg-[#E3F4EB] text-[#0B5C37] text-xs font-medium px-2 py-0.5 rounded-md">
                                {item.paymentCount} payments
                              </span>
                              {item.totalLateFee > 0 && (
                                <span className="bg-[#FFF1D6] text-[#7A4B00] text-xs font-medium px-2 py-0.5 rounded-md">
                                  +{formatCurrencyPHP(item.totalLateFee)} late fee
                                </span>
                              )}
                              {item.latestBalance !== undefined && (
                                <span className="bg-[#EEF1F5] text-[#3A4350] text-xs font-medium px-2 py-0.5 rounded-md">
                                  Balance {formatCurrencyPHP(item.latestBalance)}
                                </span>
                              )}
                            </div>

                            {item.loanRef && (
                              <p className="text-xs text-[#5B6470] mt-1.5">{item.loanRef}</p>
                            )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedGroupIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(item.id)) {
                                    next.delete(item.id)
                                  } else {
                                    next.add(item.id)
                                  }
                                  return next
                                })
                              }}
                              className="text-xs font-semibold text-[#8B1A1A] hover:underline mt-2 inline-flex items-center gap-1 cursor-pointer"
                            >
                              {isExpanded
                                ? `Hide ${item.paymentCount} payments`
                                : `Show ${item.paymentCount} payments`}
                            </button>

                            {isExpanded && (
                              <div className="mt-3 space-y-2.5 border-l-2 border-slate-200 pl-4 pt-1">
                                {item.children.map((child) => (
                                  <div
                                    key={child.id}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleItemClick(child)
                                    }}
                                    className="text-xs hover:bg-slate-100/70 p-2 rounded-lg transition-colors flex items-center justify-between gap-3"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-[#1B2330] font-medium truncate">
                                        Paid{' '}
                                        <span className="font-bold">
                                          {formatCurrencyPHP(child.amountPaid || 0)}
                                        </span>{' '}
                                        via {child.paymentMethod || 'Cash'}
                                        {child.txRef && (
                                          <span className="text-[#5B6470] ml-1">
                                            ({child.txRef})
                                          </span>
                                        )}
                                      </p>
                                      {child.lateFee && child.lateFee > 0 ? (
                                        <span className="inline-block bg-[#FFF1D6] text-[#7A4B00] text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5">
                                          +{formatCurrencyPHP(child.lateFee)} late fee
                                        </span>
                                      ) : null}
                                    </div>
                                    <span className="text-[11px] text-[#5B6470] shrink-0">
                                      {formatRelativeTime(child.created_at)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Time & Dot */}
                          <div className="flex flex-col items-end justify-between self-stretch shrink-0 min-h-[48px]">
                            <span
                              className={cn(
                                'text-xs whitespace-nowrap',
                                item.unread ? 'text-[#8B1A1A] font-semibold' : 'text-[#5B6470]'
                              )}
                            >
                              {formatRelativeTime(item.created_at)}
                            </span>
                            {item.unread && (
                              <span
                                className="w-2.5 h-2.5 rounded-full bg-[#8B1A1A] shrink-0 mt-1"
                                aria-label="Unread"
                                role="status"
                              />
                            )}
                          </div>
                        </div>
                      )
                    }

                    // Single Item
                    const displayName = item.borrowerName || item.title || 'Notification'
                    const avatarColors = getAvatarColor(displayName)
                    const initials = getInitials(displayName)
                    const isPayment = item.isPayment
                    const isDue = item.isDueReminder

                    return (
                      <div
                        key={item.id}
                        onClick={() => handleItemClick(item)}
                        className={cn(
                          'flex items-start gap-4 px-6 py-4 text-left transition-colors cursor-pointer min-h-[52px]',
                          item.unread
                            ? 'bg-[#FBF3F3] hover:bg-[#F7EBEB]'
                            : 'bg-white hover:bg-slate-50'
                        )}
                      >
                        <div className="relative shrink-0 mt-0.5">
                          <div
                            style={{
                              backgroundColor: avatarColors.bg,
                              color: avatarColors.text,
                            }}
                            className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm select-none"
                          >
                            {initials}
                          </div>
                          <div
                            className={cn(
                              'w-5 h-5 rounded-full border-2 border-white absolute -bottom-0.5 -right-0.5 flex items-center justify-center text-white',
                              isPayment
                                ? 'bg-[#0B8A44]'
                                : isDue
                                ? 'bg-[#D97706]'
                                : 'bg-[#2563EB]'
                            )}
                          >
                            {isPayment ? (
                              <Check className="w-3 h-3 stroke-[3]" />
                            ) : isDue ? (
                              <Clock className="w-3 h-3 stroke-[2.5]" />
                            ) : (
                              <AlertCircle className="w-3 h-3" />
                            )}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          {isPayment && item.borrowerName && item.amountPaid !== undefined ? (
                            <p className="text-[15px] leading-snug text-[#1B2330]">
                              <span className="font-bold">{item.borrowerName}</span> paid{' '}
                              <span className="font-bold">
                                {formatCurrencyPHP(item.amountPaid)}
                              </span>{' '}
                              via {item.paymentMethod || 'Cash'}
                            </p>
                          ) : (
                            <p className="text-[15px] leading-snug text-[#1B2330]">
                              <span className="font-bold">{item.title}</span>: {item.message}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {isPayment ? (
                              <>
                                <span className="bg-[#E3F4EB] text-[#0B5C37] text-xs font-medium px-2 py-0.5 rounded-md">
                                  Payment received
                                </span>
                                {item.remainingBalance !== undefined && (
                                  <span className="bg-[#EEF1F5] text-[#3A4350] text-xs font-medium px-2 py-0.5 rounded-md">
                                    Balance {formatCurrencyPHP(item.remainingBalance)}
                                  </span>
                                )}
                                {item.lateFee !== undefined && item.lateFee > 0 && (
                                  <span className="bg-[#FFF1D6] text-[#7A4B00] text-xs font-medium px-2 py-0.5 rounded-md">
                                    +{formatCurrencyPHP(item.lateFee)} late fee
                                  </span>
                                )}
                              </>
                            ) : isDue ? (
                              <span className="bg-[#FFF1D6] text-[#7A4B00] text-xs font-medium px-2 py-0.5 rounded-md">
                                Due Reminder
                              </span>
                            ) : (
                              <span className="bg-[#EEF1F5] text-[#3A4350] text-xs font-medium px-2 py-0.5 rounded-md">
                                {item.categoryLabel}
                              </span>
                            )}
                          </div>

                          {(item.loanRef || item.txRef) && (
                            <p className="text-xs text-[#5B6470] mt-1.5">
                              {[item.loanRef, item.txRef].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col items-end justify-between self-stretch shrink-0 min-h-[48px]">
                          <span
                            className={cn(
                              'text-xs whitespace-nowrap',
                              item.unread ? 'text-[#8B1A1A] font-semibold' : 'text-[#5B6470]'
                            )}
                          >
                            {formatRelativeTime(item.created_at)}
                          </span>
                          {item.unread && (
                            <span
                              className="w-2.5 h-2.5 rounded-full bg-[#8B1A1A] shrink-0 mt-1"
                              aria-label="Unread"
                              role="status"
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
