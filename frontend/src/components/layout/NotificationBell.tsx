import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  Clock,
  AlertCircle,
  RefreshCw,
  WifiOff,
  ChevronDown,
  ChevronUp,
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

const TAB_STORAGE_KEY = 'mct_notification_active_tab'

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'due_dates', label: 'Due Dates' },
  { id: 'bills', label: 'Bills' },
  { id: 'lending', label: 'Lending' },
  { id: 'other', label: 'Other' },
]

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
  const [activeTab, setActiveTab] = React.useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(TAB_STORAGE_KEY)
        if (saved && ['all', 'due_dates', 'bills', 'lending', 'other'].includes(saved)) {
          return saved as TabId
        }
      } catch {}
    }
    return 'all'
  })

  const [notifications, setNotifications] = React.useState<ParsedNotification[]>([])
  const [readIds, setReadIds] = React.useState<Set<string>>(() => getReadNotificationIds(userId))
  const [isLoading, setIsLoading] = React.useState(false)
  const [syncError, setSyncError] = React.useState<string | null>(null)
  const [expandedGroupIds, setExpandedGroupIds] = React.useState<Set<string>>(new Set())
  const [showPrevious, setShowPrevious] = React.useState(false)

  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const isFetchingRef = React.useRef(false)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Sync readIds when user changes
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
    async (forceRefresh = false, limit = 100) => {
      if (!isAuthenticated) return
      if (isFetchingRef.current && !forceRefresh) return

      isFetchingRef.current = true
      setIsLoading((prev) => (notifications.length === 0 ? true : prev))

      try {
        const items: NotificationItemOut[] = await notificationService.getNotifications({
          userId,
          companyName: scopedCompanyName,
          userRole: userRole || undefined,
          limit,
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

  // Initial fetch and 30s background sync
  React.useEffect(() => {
    if (!isAuthenticated) return
    void fetchLiveNotifications(false, 100)

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void fetchLiveNotifications(false, 100)
    }, 30000)

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void fetchLiveNotifications(false, 100)
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      clearInterval(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [isAuthenticated, fetchLiveNotifications])

  // Real-time synchronization & WebSocket status listener
  React.useEffect(() => {
    if (!isAuthenticated) return

    let refreshTimer: number | null = null

    const handleRefresh = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        try {
          void fetchLiveNotifications(true, 100)
        } catch (err) {
          console.warn('Real-time refresh error:', formatUserFriendlyErrorMessage(err))
        }
      }, 80)
    }

    const handleStatusChange = (status: ConnectionStatus) => {
      if (status === 'connected') {
        try {
          void fetchLiveNotifications(true, 100)
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
      websocketService.subscribe('LENDING_UPDATED', handleRefresh),
      websocketService.subscribe('AUDIT_UPDATED', handleRefresh),
      websocketService.subscribe('SALES_UPDATED', handleRefresh),
    ]

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
        refreshTimer = null
      }
      window.removeEventListener(NOTIFICATION_UPDATED_EVENT, handleRefresh)
      window.removeEventListener('storage', handleStorageSync)
      unsubs.forEach((off) => off())
    }
  }, [isAuthenticated, userId, fetchLiveNotifications])

  // Refetch when dropdown opened
  React.useEffect(() => {
    if (isOpen && isAuthenticated) {
      void fetchLiveNotifications(false, 100)
    }
  }, [isOpen, isAuthenticated, fetchLiveNotifications])

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

  // Close on Escape key
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Isolate scroll so scrolling inside dropdown does NOT scroll the parent window/page
  React.useEffect(() => {
    const listEl = listRef.current
    if (!isOpen || !listEl) return

    const onWheel = (e: WheelEvent) => {
      const scrollTop = listEl.scrollTop
      const scrollHeight = listEl.scrollHeight
      const clientHeight = listEl.clientHeight

      const isScrollingDown = e.deltaY > 0
      const isScrollingUp = e.deltaY < 0

      if (
        (isScrollingDown && scrollTop + clientHeight >= scrollHeight) ||
        (isScrollingUp && scrollTop <= 0)
      ) {
        e.preventDefault()
      }
      e.stopPropagation()
    }

    listEl.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      listEl.removeEventListener('wheel', onWheel)
    }
  }, [isOpen])

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab)
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab)
    } catch {}
  }

  // Derived unread counts per tab and overall unread count
  const tabCounts = React.useMemo(
    () => calculateTabUnreadCounts(notifications),
    [notifications]
  )
  const unreadCount = tabCounts.all

  // Grouped payments
  const groupedList = React.useMemo(
    () => groupPaymentNotifications(notifications),
    [notifications]
  )

  // Filtered by tab
  const filteredList = React.useMemo(
    () => filterNotificationsByTab(groupedList, activeTab),
    [groupedList, activeTab]
  )

  // Full Sections (New, Today, Yesterday, Earlier)
  const allSections = React.useMemo(
    () => partitionBySection(filteredList),
    [filteredList]
  )

  // When showPrevious is false, show 'new' and 'today' (or top section);
  // When showPrevious is true, show ALL sections and increase height!
  const displayedSections = React.useMemo(() => {
    if (showPrevious) {
      return allSections
    }
    const currentOnly = allSections.filter((s) => s.id === 'new' || s.id === 'today')
    if (currentOnly.length > 0) {
      return currentOnly
    }
    return allSections.slice(0, 1)
  }, [allSections, showPrevious])

  // Toggle see previous notifications
  const handleTogglePrevious = () => {
    const next = !showPrevious
    setShowPrevious(next)
    if (next) {
      // If expanding to see previous, fetch with larger limit to get complete history
      void fetchLiveNotifications(true, 200)
    }
  }

  // Optimistic Mark All Read
  const markAllAsRead = async () => {
    try {
      const allIds = notifications.map((n) => n.id)
      saveAllReadNotificationIds(allIds, userId)
      setReadIds(new Set([...readIds, ...allIds]))
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })))

      const ok = await notificationService.markAllRead(undefined, userId)
      if (!ok) {
        console.warn('markAllRead warning: backend update did not confirm success')
      }
    } catch (err) {
      const friendly = formatUserFriendlyErrorMessage(err, 'Unable to mark all notifications as read.')
      setSyncError(friendly)
    }
  }

  // Row navigation handler redirecting to specific target or transaction receipt
  const navigateTarget = (item: ParsedNotification) => {
    try {
      const url = getNotificationRedirectUrl(item)
      navigate(url)
    } catch (navErr) {
      console.error('Notification navigation error:', formatUserFriendlyErrorMessage(navErr))
    }
  }

  // Optimistic Mark Single Item Read and Navigate
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
    } catch (err) {
      console.warn('markAsRead warning:', formatUserFriendlyErrorMessage(err))
    }

    setIsOpen(false)
    navigateTarget(item)
  }

  // Group Row Click: mark all child notifications as read and navigate
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
    } catch (err) {
      console.warn('Group markAsRead warning:', formatUserFriendlyErrorMessage(err))
    }

    setIsOpen(false)
    const firstChild = group.children[0]
    if (firstChild) {
      navigateTarget(firstChild)
    } else {
      navigate('/lending')
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
          'relative h-10 w-10 rounded-full text-focus hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B1A1A] cursor-pointer',
          isOpen && 'bg-surface'
        )}
        aria-label="Open notifications"
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5 sm:h-5.5 sm:w-5.5 text-[#0B0F2B]" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#8B1A1A] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {/* Notification Dropdown Popover */}
      {isOpen && (
        <>
          {/* Mobile Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40 sm:hidden animate-in fade-in duration-150"
            onClick={() => setIsOpen(false)}
          />

          <div
            role="region"
            aria-label="Notifications panel"
            style={{ overscrollBehavior: 'contain' }}
            className={cn(
              'bg-white border border-[#EEF0F3] shadow-2xl z-50 overflow-hidden flex flex-col transition-all duration-200',
              'sm:absolute sm:right-0 sm:mt-2 sm:w-[440px] sm:rounded-2xl animate-in fade-in-0 zoom-in-95 duration-150',
              showPrevious
                ? 'sm:h-[680px] sm:max-h-[760px] max-sm:max-h-[92vh]'
                : 'sm:max-h-[580px] max-sm:max-h-[85vh]',
              'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-2xl max-sm:rounded-b-none'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#EEF0F3]">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base sm:text-lg font-bold text-[#1B2330]">Notifications</h2>
                {unreadCount > 0 && (
                  <span className="px-2.5 py-0.5 text-xs font-bold bg-[#8B1A1A] text-white rounded-full">
                    {unreadCount > 99 ? '99+' : unreadCount} new
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    className="text-xs font-semibold text-[#8B1A1A] hover:underline transition-colors cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
                {/* View all notifications button in corner */}
                <button
                  type="button"
                  aria-label="View all notifications"
                  onClick={() => {
                    setIsOpen(false)
                    navigate('/notifications')
                  }}
                  className="text-xs font-semibold text-[#5B6470] hover:text-[#8B1A1A] hover:underline transition-colors cursor-pointer"
                >
                  View all
                </button>
              </div>
            </div>

            {/* Sync Error Banner */}
            {syncError && (
              <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2.5 flex items-center justify-between text-xs text-amber-900">
                <span className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
                  <WifiOff className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                  <span className="truncate">{syncError}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void fetchLiveNotifications(true, 100)}
                  className="font-bold underline hover:text-amber-950 flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}

            {/* Underline-style Tabs: Font size increased to 15px (+2) */}
            <div className="flex items-center gap-5 px-5 border-b border-[#EEF0F3] overflow-x-auto no-scrollbar pt-1.5">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id
                const count = tabCounts[tab.id]
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleTabChange(tab.id)}
                    className={cn(
                      'pb-2.5 text-[15px] transition-all flex items-center gap-1.5 shrink-0 cursor-pointer border-b-2',
                      isActive
                        ? 'border-[#8B1A1A] text-[#8B1A1A] font-bold'
                        : 'border-transparent text-[#5B6470] hover:text-[#1B2330] font-medium'
                    )}
                  >
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span
                        className={cn(
                          'px-1.5 py-0.2 rounded-full text-[11px] font-bold',
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

            {/* Notification Items List with isolated scroll and min-h-0 */}
            <div
              ref={listRef}
              style={{ overscrollBehavior: 'contain' }}
              className={cn(
                'min-h-0 flex-1 overflow-y-auto overscroll-contain transition-all duration-200',
                showPrevious ? 'max-h-[580px] h-[520px]' : 'max-h-[420px]'
              )}
            >
              {isLoading && notifications.length === 0 ? (
                /* Skeleton Loading: 3 rows */
                <div className="p-4 sm:p-5 space-y-4">
                  {[1, 2, 3].map((skeletonId) => (
                    <div key={skeletonId} className="flex items-start gap-3.5 animate-pulse min-h-[44px]">
                      <div className="w-11 h-11 rounded-full bg-slate-200 shrink-0" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                        <div className="flex gap-2">
                          <div className="h-3.5 bg-slate-200 rounded w-20" />
                          <div className="h-3.5 bg-slate-200 rounded w-24" />
                        </div>
                        <div className="h-3 bg-slate-200 rounded w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : displayedSections.length === 0 ? (
                /* Empty State */
                <div className="py-14 px-6 text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 ring-4 ring-emerald-50/50">
                    <Check className="w-6 h-6 stroke-[2.5]" />
                  </div>
                  <p className="font-bold text-[#1B2330] text-sm">You&apos;re all caught up</p>
                  <p className="text-xs text-[#5B6470]">No notifications to show in this view.</p>
                </div>
              ) : (
                displayedSections.map((section) => (
                  <div key={section.id}>
                    {/* Section Header */}
                    <div className="bg-[#FAFBFD] px-5 py-2 border-b border-[#EEF0F3]">
                      <span className="text-[11px] font-bold tracking-wider text-[#5B6470] uppercase">
                        {section.title}
                      </span>
                    </div>

                    {/* Section Items */}
                    <div className="divide-y divide-[#EEF0F3]">
                      {section.items.map((item) => {
                        if (item.isGroup) {
                          // Grouped Payment Notification Row
                          const isExpanded = expandedGroupIds.has(item.id)
                          const avatarColors = getAvatarColor(item.borrowerName)
                          const initials = getInitials(item.borrowerName)

                          return (
                            <div
                              key={item.id}
                              onClick={() => handleGroupClick(item)}
                              className={cn(
                                'flex items-start gap-3.5 px-4 sm:px-5 py-3.5 text-left transition-colors cursor-pointer min-h-[44px]',
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

                              {/* Main Info */}
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] leading-snug text-[#1B2330]">
                                  <span className="font-bold">{item.borrowerName}</span> made{' '}
                                  {item.paymentCount} payments ·{' '}
                                  <span className="font-bold">
                                    {formatCurrencyPHP(item.totalAmount)}
                                  </span>{' '}
                                  total
                                </p>

                                {/* Chips */}
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                  <span className="bg-[#E3F4EB] text-[#0B5C37] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                    {item.paymentCount} payments
                                  </span>
                                  {item.totalLateFee > 0 && (
                                    <span className="bg-[#FFF1D6] text-[#7A4B00] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                      +{formatCurrencyPHP(item.totalLateFee)} late fee
                                    </span>
                                  )}
                                  {item.latestBalance !== undefined && (
                                    <span className="bg-[#EEF1F5] text-[#3A4350] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                      Balance {formatCurrencyPHP(item.latestBalance)}
                                    </span>
                                  )}
                                </div>

                                {/* Meta line */}
                                {item.loanRef && (
                                  <p className="text-xs text-[#5B6470] mt-1.5">{item.loanRef}</p>
                                )}

                                {/* Inline Expand / Collapse toggle */}
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

                                {/* Inline Expanded Children */}
                                {isExpanded && (
                                  <div className="mt-2.5 space-y-2 border-l-2 border-slate-200 pl-3 pt-1">
                                    {item.children.map((child) => (
                                      <div
                                        key={child.id}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleItemClick(child)
                                        }}
                                        className="text-xs hover:bg-slate-100/70 p-1.5 rounded transition-colors flex items-center justify-between gap-2"
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

                              {/* Right Column: Time and Dot */}
                              <div className="flex flex-col items-end justify-between self-stretch shrink-0 min-h-[44px]">
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

                        // Single Notification Row
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
                              'flex items-start gap-3.5 px-4 sm:px-5 py-3.5 text-left transition-colors cursor-pointer min-h-[44px]',
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

                            {/* Main Info */}
                            <div className="flex-1 min-w-0">
                              {isPayment && item.borrowerName && item.amountPaid !== undefined ? (
                                <p className="text-[14.5px] leading-snug text-[#1B2330]">
                                  <span className="font-bold">{item.borrowerName}</span> paid{' '}
                                  <span className="font-bold">
                                    {formatCurrencyPHP(item.amountPaid)}
                                  </span>{' '}
                                  via {item.paymentMethod || 'Cash'}
                                </p>
                              ) : (
                                <p className="text-[14.5px] leading-snug text-[#1B2330] line-clamp-2">
                                  <span className="font-bold">{item.title}</span>: {item.message}
                                </p>
                              )}

                              {/* Chips */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                {isPayment ? (
                                  <>
                                    <span className="bg-[#E3F4EB] text-[#0B5C37] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                      Payment received
                                    </span>
                                    {item.remainingBalance !== undefined && (
                                      <span className="bg-[#EEF1F5] text-[#3A4350] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                        Balance {formatCurrencyPHP(item.remainingBalance)}
                                      </span>
                                    )}
                                    {item.lateFee !== undefined && item.lateFee > 0 && (
                                      <span className="bg-[#FFF1D6] text-[#7A4B00] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                        +{formatCurrencyPHP(item.lateFee)} late fee
                                      </span>
                                    )}
                                  </>
                                ) : isDue ? (
                                  <span className="bg-[#FFF1D6] text-[#7A4B00] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                    Due Reminder
                                  </span>
                                ) : (
                                  <span className="bg-[#EEF1F5] text-[#3A4350] text-[12px] font-medium px-2 py-0.5 rounded-md">
                                    {item.categoryLabel}
                                  </span>
                                )}
                              </div>

                              {/* Meta line */}
                              {(item.loanRef || item.txRef) && (
                                <p className="text-xs text-[#5B6470] mt-1.5">
                                  {[item.loanRef, item.txRef].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </div>

                            {/* Right Column: Time and Dot */}
                            <div className="flex flex-col items-end justify-between self-stretch shrink-0 min-h-[44px]">
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

            {/* Footer: "See previous notification" that visibly expands panel height and shows older notifications */}
            <div className="p-3 text-center border-t border-[#EEF0F3] bg-white shrink-0">
              <button
                type="button"
                onClick={handleTogglePrevious}
                className="text-xs sm:text-sm font-semibold text-[#8B1A1A] hover:underline cursor-pointer inline-flex items-center gap-1.5"
              >
                <span>
                  {showPrevious ? 'Collapse previous notifications' : 'See previous notification'}
                </span>
                {showPrevious ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
