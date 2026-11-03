import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  Clock,
  Building2,
  Calendar,
  AlertCircle,
  FileCheck2,
  Landmark,
  CheckCircle2,
  Receipt,
  Banknote,
  Store,
  Wallet,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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

type NotificationCategory = 'all' | 'due_dates' | 'bills' | 'lending' | 'other'

interface DisplayNotification {
  id: string
  title: string
  description: string
  time: string
  unread: boolean
  type: string
  category: 'bills' | 'lending' | 'other'
  categoryLabel: string
  isDueReminder: boolean
  urgencyBadge?: {
    label: string
    className: string
  }
  refType?: string | null
  refId?: number | null
  icon: React.ElementType
  iconColor: string
  iconBg: string
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Just now'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return 'Recently'
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHrs = Math.floor(diffMin / 60)
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.floor(diffHrs / 24)
    return `${diffDays}d ago`
  } catch {
    return 'Recently'
  }
}

interface NotificationBellProps {
  className?: string
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ className }) => {
  const navigate = useNavigate()
  const { user, status } = useSession()
  const { activeCompany } = useCompany()

  const userId = user?.id ?? null
  const isAuthenticated = status === 'authenticated' && Boolean(user)

  const [isOpen, setIsOpen] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<NotificationCategory>('all')
  const [notifications, setNotifications] = React.useState<DisplayNotification[]>([])
  const [readIds, setReadIds] = React.useState<Set<string>>(() => getReadNotificationIds(userId))
  const [isLoading, setIsLoading] = React.useState(false)
  const [syncError, setSyncError] = React.useState<string | null>(null)
  const [wsStatus, setWsStatus] = React.useState<ConnectionStatus>('offline')

  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const isFetchingRef = React.useRef(false)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Sync readIds when user account changes
  React.useEffect(() => {
    setReadIds(getReadNotificationIds(userId))
    if (!isAuthenticated) {
      setNotifications([])
    }
  }, [userId, isAuthenticated])

  const userRole = (user?.role || '').toLowerCase()
  if (userRole === 'admin') {
    return null
  }

  const isMultiCompanyRole =
    userRole === 'finance' || userRole === 'audit' || userRole.includes('auditor')
  const scopedCompanyName = isMultiCompanyRole
    ? activeCompany || 'All Companies'
    : user?.assignedCompany || activeCompany || 'All Companies'

  const fetchLiveNotifications = React.useCallback(
    async (forceRefresh = false) => {
      if (!isAuthenticated) {
        return
      }
      if (isFetchingRef.current && !forceRefresh) {
        return
      }

      isFetchingRef.current = true
      setIsLoading((prev) => (notifications.length === 0 ? true : prev))

      try {
        const items: NotificationItemOut[] = await notificationService.getNotifications({
          userId,
          companyName: scopedCompanyName,
          userRole: userRole || undefined,
          limit: 100,
          forceRefresh,
        })

        if (!mountedRef.current) return

        const readSet = getReadNotificationIds(userId)
        setSyncError(null)

        const mapped: DisplayNotification[] = items.map((item) => {
          const nt = (item.notification_type || '').toUpperCase()
          const refType = (item.reference_type || '').toLowerCase()

          let IconComponent: React.ElementType = AlertCircle
          let iconColor = 'text-primary'
          let iconBg = 'bg-primary/10'
          let category: 'bills' | 'lending' | 'other' = 'other'
          let categoryLabel = 'General'
          let isDueReminder = false
          let urgencyBadge: { label: string; className: string } | undefined

          // Determine category
          if (refType === 'bill' || nt.startsWith('BILL_')) {
            category = 'bills'
            categoryLabel = 'Bills'
          } else if (refType === 'lending' || refType === 'borrower' || nt.startsWith('LENDING_')) {
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
          }

          // Determine urgency / due reminder status & styling
          if (nt.includes('OVERDUE')) {
            isDueReminder = true
            IconComponent = AlertCircle
            iconColor = 'text-rose-600'
            iconBg = 'bg-rose-50 border border-rose-200/70'
            urgencyBadge = {
              label: 'Overdue',
              className: 'bg-rose-100 text-rose-700 border-rose-200',
            }
          } else if (nt.includes('DUE_TODAY')) {
            isDueReminder = true
            IconComponent = Clock
            iconColor = 'text-amber-600'
            iconBg = 'bg-amber-50 border border-amber-200/70'
            urgencyBadge = {
              label: 'Due Today',
              className: 'bg-amber-100 text-amber-800 border-amber-200',
            }
          } else if (nt.includes('DUE_TOMORROW')) {
            isDueReminder = true
            IconComponent = Calendar
            iconColor = 'text-amber-600'
            iconBg = 'bg-amber-50 border border-amber-200/70'
            urgencyBadge = {
              label: 'Due Tomorrow',
              className: 'bg-amber-100 text-amber-800 border-amber-200',
            }
          } else if (nt.includes('DUE_SOON')) {
            isDueReminder = true
            IconComponent = Clock
            iconColor = 'text-amber-600'
            iconBg = 'bg-amber-50 border border-amber-200/70'
            urgencyBadge = {
              label: 'Due Soon',
              className: 'bg-amber-50 text-amber-800 border-amber-200',
            }
          } else if (nt === 'BILL_PAID' || nt === 'BILL_PARTIALLY_PAID') {
            IconComponent = Receipt
            iconColor = 'text-emerald-600'
            iconBg = 'bg-emerald-50 border border-emerald-200/70'
          } else if (nt.startsWith('LENDING_PAYMENT') || nt.startsWith('LENDING_FULLY')) {
            IconComponent = Banknote
            iconColor = 'text-emerald-600'
            iconBg = 'bg-emerald-50 border border-emerald-200/70'
          } else if (nt.startsWith('TENANT_')) {
            IconComponent = Store
            iconColor = 'text-blue-600'
            iconBg = 'bg-blue-50 border border-blue-200/70'
          } else if (nt === 'LOAN_REQUEST_FINANCE') {
            IconComponent = Landmark
            iconColor = 'text-amber-600'
            iconBg = 'bg-amber-50 border border-amber-200/70'
          } else if (nt === 'LOAN_ENDORSED_AUDIT' || nt === 'PETTY_CASH_AUDIT') {
            IconComponent = FileCheck2
            iconColor = 'text-blue-600'
            iconBg = 'bg-blue-50 border border-blue-200/70'
          } else if (
            nt === 'LOAN_APPROVED_SUPERVISOR' ||
            nt === 'PETTY_CASH_APPROVED' ||
            nt === 'DEPOSIT_VERIFIED' ||
            nt === 'LOAN_REPAYMENT_RECEIVED' ||
            nt === 'LOAN_FULLY_SETTLED'
          ) {
            IconComponent = CheckCircle2
            iconColor = 'text-emerald-600'
            iconBg = 'bg-emerald-50 border border-emerald-200/70'
          } else if (nt === 'LOAN_REJECTED_SUPERVISOR' || nt === 'PETTY_CASH_REJECTED') {
            IconComponent = AlertCircle
            iconColor = 'text-rose-600'
            iconBg = 'bg-rose-50 border border-rose-200/70'
          } else if (nt === 'PETTY_CASH_REQUEST') {
            IconComponent = Wallet
            iconColor = 'text-amber-600'
            iconBg = 'bg-amber-50 border border-amber-200/70'
          } else if (nt === 'LOAN_REPAYMENT_SENT') {
            IconComponent = Landmark
            iconColor = 'text-slate-600'
            iconBg = 'bg-slate-100 border border-slate-200'
          } else {
            IconComponent = Building2
            iconColor = 'text-primary'
            iconBg = 'bg-primary/10'
          }

          const isUnread = !readSet.has(item.notification_id) && !item.read_at

          return {
            id: item.notification_id,
            title: sanitizeNotificationText(item.title),
            description: sanitizeNotificationText(item.message),
            time: isDueReminder && urgencyBadge ? urgencyBadge.label : formatRelativeTime(item.created_at),
            unread: isUnread,
            type: nt,
            category,
            categoryLabel,
            isDueReminder,
            urgencyBadge,
            refType: item.reference_type,
            refId: item.reference_id,
            icon: IconComponent,
            iconColor,
            iconBg,
          }
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

  // Initial fetch and polling every 30s
  React.useEffect(() => {
    if (!isAuthenticated) return
    void fetchLiveNotifications(false)
    const timer = setInterval(() => {
      void fetchLiveNotifications(false)
    }, 30000)
    return () => clearInterval(timer)
  }, [isAuthenticated, fetchLiveNotifications])

  // Real-time synchronization & WebSocket status listener
  React.useEffect(() => {
    if (!isAuthenticated) return

    setWsStatus(websocketService.getStatus())

    const handleRefresh = () => {
      try {
        void fetchLiveNotifications(true)
      } catch (err) {
        console.warn('Real-time refresh error:', formatUserFriendlyErrorMessage(err))
      }
    }

    const handleStatusChange = (status: ConnectionStatus) => {
      setWsStatus(status)
      if (status === 'connected') {
        // Trigger catch-up synchronization on reconnection
        try {
          void fetchLiveNotifications(true)
        } catch (err) {
          console.warn('Catch-up sync error:', formatUserFriendlyErrorMessage(err))
        }
      }
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
      } catch (err) {
        console.warn('Storage sync error:', formatUserFriendlyErrorMessage(err))
      }
    }

    window.addEventListener(NOTIFICATION_UPDATED_EVENT, handleRefresh)
    window.addEventListener('storage', handleStorageSync)

    const unsubs = [
      websocketService.subscribe('WS_STATUS_CHANGE', handleStatusChange),
      websocketService.subscribe('NOTIFICATION_RECEIVED', handleRefresh),
      websocketService.subscribe('LOANS_UPDATED', handleRefresh),
      websocketService.subscribe('PETTY_CASH_UPDATED', handleRefresh),
      websocketService.subscribe('TENANTS_UPDATED', handleRefresh),
      websocketService.subscribe('AUDIT_UPDATED', handleRefresh),
      websocketService.subscribe('SALES_UPDATED', handleRefresh),
    ]

    return () => {
      window.removeEventListener(NOTIFICATION_UPDATED_EVENT, handleRefresh)
      window.removeEventListener('storage', handleStorageSync)
      unsubs.forEach((off) => off())
    }
  }, [isAuthenticated, userId, fetchLiveNotifications])

  // Refetch when dropdown opened
  React.useEffect(() => {
    if (isOpen && isAuthenticated) {
      void fetchLiveNotifications(false)
    }
  }, [isOpen, isAuthenticated, fetchLiveNotifications])

  const unreadCount = notifications.filter((n) => n.unread).length
  const dueRemindersCount = notifications.filter((n) => n.isDueReminder).length
  const billsCount = notifications.filter((n) => n.category === 'bills').length
  const lendingCount = notifications.filter((n) => n.category === 'lending').length

  const filteredNotifications = React.useMemo(() => {
    switch (activeTab) {
      case 'due_dates':
        return notifications.filter((n) => n.isDueReminder)
      case 'bills':
        return notifications.filter((n) => n.category === 'bills')
      case 'lending':
        return notifications.filter((n) => n.category === 'lending')
      case 'other':
        return notifications.filter((n) => n.category === 'other')
      default:
        return notifications
    }
  }, [notifications, activeTab])

  // Close on outside click
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Optimistic Mark All Read
  const markAllAsRead = async () => {
    try {
      const allIds = notifications.map((n) => n.id)
      saveAllReadNotificationIds(allIds, userId)
      setReadIds(new Set([...readIds, ...allIds]))
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })))

      // Dispatch backend persistence call
      const ok = await notificationService.markAllRead(undefined, userId)
      if (!ok) {
        console.warn('markAllRead warning: backend update did not confirm success')
      }
    } catch (err) {
      const friendly = formatUserFriendlyErrorMessage(err, 'Unable to mark all notifications as read.')
      setSyncError(friendly)
    }
  }

  // Optimistic Mark Single Read
  const handleItemClick = (item: DisplayNotification) => {
    try {
      saveReadNotificationId(item.id, userId)
      setReadIds((prev) => new Set([...prev, item.id]))
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, unread: false } : n))
      )

      // Dispatch backend persistence call
      void notificationService.markAsRead(item.id, userId)
    } catch (err) {
      console.warn('markAsRead warning:', formatUserFriendlyErrorMessage(err))
    }

    setIsOpen(false)

    try {
      // Navigate based on notification category / reference
      if (item.category === 'bills' || item.refType === 'bill' || item.type.startsWith('BILL_')) {
        if (item.refId && item.refId > 0) {
          navigate(`/bills/${item.refId}`)
        } else {
          navigate('/bills')
        }
      } else if (
        item.category === 'lending' ||
        item.refType === 'lending' ||
        item.refType === 'borrower' ||
        item.type.startsWith('LENDING_')
      ) {
        navigate('/lending')
      } else if (item.refType === 'tenant' || item.type.startsWith('TENANT_')) {
        navigate('/tenant')
      } else if (item.refType === 'petty_cash' || item.type.includes('PETTY_CASH')) {
        navigate('/petty-cash')
      } else if (item.refType === 'deposit' || item.type.includes('DEPOSIT') || item.refType === 'sale') {
        navigate('/sales')
      } else if (item.refType === 'loan' || item.refType === 'loan_repayment' || item.type.includes('LOAN')) {
        navigate('/loan')
      }
    } catch (navErr) {
      console.error('Notification navigation error:', formatUserFriendlyErrorMessage(navErr))
    }
  }

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'relative h-10 w-10 rounded-full text-focus hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus cursor-pointer',
          isOpen && 'bg-surface'
        )}
        aria-label="Open notifications"
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5 sm:h-5.5 sm:w-5.5 text-[#0B0F2B]" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {/* Notification Dropdown Popover */}
      {isOpen && (
        <div
          role="region"
          aria-label="Notifications panel"
          className="absolute right-0 mt-2 w-80 sm:w-[420px] rounded-2xl bg-white border border-stroke/30 shadow-2xl overflow-hidden z-50 animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-stroke/20 bg-surface/50">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-focus">Notifications & Reminders</span>
              {/* WebSocket Status Indicator Dot */}
              <span
                title={
                  wsStatus === 'connected'
                    ? 'Real-time sync connected'
                    : wsStatus === 'reconnecting'
                    ? 'Reconnecting real-time sync...'
                    : 'Offline polling mode'
                }
                className={cn(
                  'h-2 w-2 rounded-full inline-block',
                  wsStatus === 'connected'
                    ? 'bg-emerald-500 ring-2 ring-emerald-100'
                    : wsStatus === 'reconnecting'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-slate-300'
                )}
              />
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-primary/10 text-primary rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs text-muted-fg hover:text-primary font-medium transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Sync Error / Offline Banner */}
          {syncError && (
            <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2 flex items-center justify-between text-xs text-amber-800">
              <span className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
                <WifiOff className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span className="truncate">{syncError}</span>
              </span>
              <button
                type="button"
                onClick={() => void fetchLiveNotifications(true)}
                className="font-bold underline hover:text-amber-950 flex items-center gap-1 cursor-pointer shrink-0"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-stroke/15 bg-slate-50/70 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: 'All', count: notifications.length },
                { id: 'due_dates', label: 'Due Dates', count: dueRemindersCount },
                { id: 'bills', label: 'Bills', count: billsCount },
                { id: 'lending', label: 'Lending', count: lendingCount },
                { id: 'other', label: 'Other', count: notifications.filter((n) => n.category === 'other').length },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 shrink-0 cursor-pointer',
                    isActive
                      ? 'bg-[#960C01] text-white shadow-2xs'
                      : 'bg-white text-muted-fg hover:text-focus border border-stroke/20'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span
                      className={cn(
                        'px-1.5 py-0.2 rounded-full text-[10px]',
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Notification List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-stroke/10">
            {isLoading && notifications.length === 0 ? (
              <div className="p-5 space-y-4">
                {[1, 2, 3].map((skeletonId) => (
                  <div key={skeletonId} className="flex items-start gap-3 animate-pulse">
                    <div className="h-9 w-9 rounded-xl bg-slate-200 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-slate-200 rounded w-1/3" />
                      <div className="h-3 bg-slate-200 rounded w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-fg">
                {syncError ? (
                  <div className="space-y-2.5">
                    <AlertCircle className="h-6 w-6 text-amber-500 mx-auto" />
                    <p className="text-xs text-slate-600 max-w-xs mx-auto leading-relaxed">{syncError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchLiveNotifications(true)}
                      className="text-xs h-8 gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try again
                    </Button>
                  </div>
                ) : (
                  'No notifications in this category'
                )}
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={cn(
                      'flex items-start gap-3.5 px-5 py-3.5 text-left hover:bg-surface/60 transition-colors cursor-pointer',
                      item.unread && 'bg-primary/[0.03]'
                    )}
                  >
                    <div
                      className={cn(
                        'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
                        item.iconBg
                      )}
                    >
                      <Icon className={cn('h-4.5 w-4.5', item.iconColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                            {item.categoryLabel}
                          </span>
                          <p
                            className={cn(
                              'text-xs sm:text-sm font-semibold truncate',
                              item.unread ? 'text-focus' : 'text-muted-fg'
                            )}
                          >
                            {item.title}
                          </p>
                        </div>
                        {item.urgencyBadge ? (
                          <span
                            className={cn(
                              'text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0',
                              item.urgencyBadge.className
                            )}
                          >
                            {item.urgencyBadge.label}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-fg/80 shrink-0 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {item.time}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-fg mt-1 line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-3 text-center border-t border-stroke/20 bg-surface/30">
            <span className="text-xs text-muted-fg font-medium">
              MCT Group Notification Center
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
