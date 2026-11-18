import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getInitials,
  getAvatarColor,
  formatRelativeTime,
  parseNotificationDetails,
  groupPaymentNotifications,
  filterNotificationsByTab,
  calculateTabUnreadCounts,
  partitionBySection,
  getNotificationRedirectUrl,
} from '../notificationHelpers.ts'
import type { ParsedNotification } from '../notificationHelpers.ts'

describe('Notification Helpers & Grouping Spec', () => {
  it('extracts uppercase initials deterministically', () => {
    assert.equal(getInitials('Jasmine'), 'JA')
    assert.equal(getInitials('Reymie Gonzaga'), 'RG')
    assert.equal(getInitials('Liv'), 'LI')
    assert.equal(getInitials('Corporate Treasury Special Fund'), 'CF')
    assert.equal(getInitials(''), '??')
    assert.equal(getInitials(null), '??')
  })

  it('provides deterministic avatar colors from palette', () => {
    const color1 = getAvatarColor('Jasmine')
    const color2 = getAvatarColor('Jasmine')
    const color3 = getAvatarColor('Reymie Gonzaga')

    assert.deepEqual(color1, color2)
    assert.ok(color1.bg && color1.text)
    assert.ok(color3.bg && color3.text)
  })

  it('formats relative timestamps correctly', () => {
    const now = new Date()
    const threeMinAgo = new Date(now.getTime() - 3 * 60 * 1000).toISOString()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

    assert.equal(formatRelativeTime(threeMinAgo), '3m')
    assert.equal(formatRelativeTime(twoHoursAgo), '2h')
    assert.equal(formatRelativeTime(null), 'Recently')
  })

  it('parses payment details from standard backend notifications', () => {
    const raw = {
      id: 'notif-1',
      notification_type: 'LENDING_PAYMENT_RECEIVED',
      title: 'Lending Payment Received: Jasmine',
      message:
        'Jasmine (LN-20261118-0178) paid ₱240.00 via Cash (TX-20261118-0231). Remaining balance: ₱960.00.',
      created_at: '2026-11-18T08:00:00Z',
      unread: true,
      category: 'lending' as const,
      categoryLabel: 'Lending',
      refType: 'lending',
      refId: 101,
      isDueReminder: false,
    }

    const parsed = parseNotificationDetails(raw)
    assert.equal(parsed.borrowerName, 'Jasmine')
    assert.equal(parsed.loanRef, 'LN-20261118-0178')
    assert.equal(parsed.txRef, 'TX-20261118-0231')
    assert.equal(parsed.amountPaid, 240)
    assert.equal(parsed.paymentMethod, 'Cash')
    assert.equal(parsed.remainingBalance, 960)
    assert.equal(parsed.lateFee, undefined)
    assert.equal(parsed.isPayment, true)
  })

  it('groups 2 or more payments from the same borrower on the same loan and same day', () => {
    const p1: ParsedNotification = {
      id: 'tx-1',
      notification_type: 'LENDING_PAYMENT_RECEIVED',
      title: 'Lending Payment Received: Reymie Gonzaga',
      message:
        'Reymie Gonzaga (LN-20261116-6088) paid ₱162.00 (+₱10.00 late fee) via Cash (TX-20261118-0232). Remaining balance: ₱3,348.00.',
      created_at: '2026-11-18T08:00:00Z',
      unread: false,
      category: 'lending',
      categoryLabel: 'Lending',
      isDueReminder: false,
      isPayment: true,
      borrowerName: 'Reymie Gonzaga',
      loanRef: 'LN-20261116-6088',
      txRef: 'TX-20261118-0232',
      amountPaid: 162,
      lateFee: 10,
      paymentMethod: 'Cash',
      remainingBalance: 3348,
      dateKey: '2026-11-18',
    }

    const p2: ParsedNotification = {
      id: 'tx-2',
      notification_type: 'LENDING_PAYMENT_RECEIVED',
      title: 'Lending Payment Received: Reymie Gonzaga',
      message:
        'Reymie Gonzaga (LN-20261116-6088) paid ₱162.00 via GCash (TX-20261118-0233). Remaining balance: ₱3,186.00.',
      created_at: '2026-11-18T08:30:00Z',
      unread: true,
      category: 'lending',
      categoryLabel: 'Lending',
      isDueReminder: false,
      isPayment: true,
      borrowerName: 'Reymie Gonzaga',
      loanRef: 'LN-20261116-6088',
      txRef: 'TX-20261118-0233',
      amountPaid: 162,
      lateFee: 0,
      paymentMethod: 'GCash',
      remainingBalance: 3186,
      dateKey: '2026-11-18',
    }

    const singleLoan: ParsedNotification = {
      id: 'tx-3',
      notification_type: 'LENDING_PAYMENT_RECEIVED',
      title: 'Lending Payment Received: Liv',
      message: 'Liv (LN-20261118-8631) paid ₱2,750.00 via Cash (TX-20261118-8876). Remaining balance: ₱2,750.00.',
      created_at: '2026-11-18T08:34:00Z',
      unread: true,
      category: 'lending',
      categoryLabel: 'Lending',
      isDueReminder: false,
      isPayment: true,
      borrowerName: 'Liv',
      loanRef: 'LN-20261118-8631',
      txRef: 'TX-20261118-8876',
      amountPaid: 2750,
      paymentMethod: 'Cash',
      remainingBalance: 2750,
      dateKey: '2026-11-18',
    }

    const grouped = groupPaymentNotifications([p1, p2, singleLoan])

    // Should result in 2 top-level rows: 1 grouped (Reymie) and 1 single (Liv)
    assert.equal(grouped.length, 2)

    const reymieGroup = grouped[0]
    assert.equal(reymieGroup.isGroup, true)
    if (reymieGroup.isGroup) {
      assert.equal(reymieGroup.borrowerName, 'Reymie Gonzaga')
      assert.equal(reymieGroup.paymentCount, 2)
      assert.equal(reymieGroup.totalAmount, 324)
      assert.equal(reymieGroup.totalLateFee, 10)
      assert.equal(reymieGroup.latestBalance, 3186)
      // Since p2 is unread, the grouped row must count as unread
      assert.equal(reymieGroup.unread, true)
      // Timestamp should be newest child (p2: 08:30)
      assert.equal(reymieGroup.created_at, '2026-11-18T08:30:00Z')
      assert.equal(reymieGroup.children.length, 2)
    }

    const livRow = grouped[1]
    assert.equal(livRow.isGroup, false)
    if (!livRow.isGroup) {
      assert.equal(livRow.borrowerName, 'Liv')
      assert.equal(livRow.amountPaid, 2750)
    }
  })

  it('calculates unread counts per tab based on individual notifications', () => {
    const items: ParsedNotification[] = [
      {
        id: '1',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Jasmine',
        message: 'Jasmine paid',
        created_at: '2026-11-18T08:00:00Z',
        unread: true,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: '2026-11-18',
      },
      {
        id: '2',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Reymie 1',
        message: 'Reymie paid',
        created_at: '2026-11-18T08:10:00Z',
        unread: true,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: '2026-11-18',
      },
      {
        id: '3',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Reymie 2',
        message: 'Reymie paid',
        created_at: '2026-11-18T08:20:00Z',
        unread: true,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: '2026-11-18',
      },
      {
        id: '4',
        notification_type: 'BILL_DUE_SOON',
        title: 'Electric Bill',
        message: 'Bill due soon',
        created_at: '2026-11-18T07:00:00Z',
        unread: false, // Read
        category: 'bills',
        categoryLabel: 'Bills',
        isDueReminder: true,
        isPayment: false,
        dateKey: '2026-11-18',
      },
      {
        id: '5',
        notification_type: 'LOAN_OVERDUE',
        title: 'Overdue Loan',
        message: 'Loan is overdue',
        created_at: '2026-11-18T06:00:00Z',
        unread: true,
        category: 'other',
        categoryLabel: 'Loan',
        isDueReminder: true,
        isPayment: false,
        dateKey: '2026-11-18',
      },
    ]

    const counts = calculateTabUnreadCounts(items)
    // Total unread: items 1, 2, 3, 5 = 4
    assert.equal(counts.all, 4)
    // Lending unread: items 1, 2, 3 = 3
    assert.equal(counts.lending, 3)
    // Due dates unread: item 5 (item 4 is read) = 1
    assert.equal(counts.due_dates, 1)
    // Bills unread: 0
    assert.equal(counts.bills, 0)
    // Other unread (excluding due reminder item 5): 0
    assert.equal(counts.other, 0)
  })

  it('filters notifications by tab correctly', () => {
    const parsedList: ParsedNotification[] = [
      {
        id: 'b1',
        notification_type: 'BILL_RECEIVED',
        title: 'Internet Bill',
        message: 'Internet bill received',
        created_at: '2026-11-18T08:00:00Z',
        unread: false,
        category: 'bills',
        categoryLabel: 'Bills',
        isDueReminder: false,
        isPayment: false,
        dateKey: '2026-11-18',
      },
      {
        id: 'l1',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Lending Payment',
        message: 'Jasmine paid ₱240.00',
        created_at: '2026-11-18T08:05:00Z',
        unread: true,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: '2026-11-18',
      },
      {
        id: 'd1',
        notification_type: 'LOAN_OVERDUE',
        title: 'Loan Overdue',
        message: 'Loan is overdue',
        created_at: '2026-11-18T08:10:00Z',
        unread: true,
        category: 'other',
        categoryLabel: 'Loan',
        isDueReminder: true,
        isPayment: false,
        dateKey: '2026-11-18',
      },
    ]

    const grouped = groupPaymentNotifications(parsedList)

    const allTab = filterNotificationsByTab(grouped, 'all')
    assert.equal(allTab.length, 3)

    const billsTab = filterNotificationsByTab(grouped, 'bills')
    assert.equal(billsTab.length, 1)
    assert.equal(billsTab[0].id, 'b1')

    const lendingTab = filterNotificationsByTab(grouped, 'lending')
    assert.equal(lendingTab.length, 1)
    assert.equal(lendingTab[0].id, 'l1')

    const dueTab = filterNotificationsByTab(grouped, 'due_dates')
    assert.equal(dueTab.length, 1)
    assert.equal(dueTab[0].id, 'd1')
  })

  it('partitions into sections and hides empty sections', () => {
    const today = new Date().toISOString()
    const yesterdayDate = new Date()
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterday = yesterdayDate.toISOString()

    const list: ParsedNotification[] = [
      {
        id: 'u1',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Unread 1',
        message: 'Msg',
        created_at: today,
        unread: true,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: today.slice(0, 10),
      },
      {
        id: 'r1',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Read Today',
        message: 'Msg',
        created_at: today,
        unread: false,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: today.slice(0, 10),
      },
      {
        id: 'r2',
        notification_type: 'LENDING_PAYMENT_RECEIVED',
        title: 'Read Yesterday',
        message: 'Msg',
        created_at: yesterday,
        unread: false,
        category: 'lending',
        categoryLabel: 'Lending',
        isDueReminder: false,
        isPayment: true,
        dateKey: yesterday.slice(0, 10),
      },
    ]

    const sections = partitionBySection(groupPaymentNotifications(list))

    // Expect sections: NEW, TODAY, YESTERDAY. EARLIER is empty so hidden.
    const sectionIds = sections.map((s) => s.id)
    assert.deepEqual(sectionIds, ['new', 'today', 'yesterday'])
    assert.equal(sections.find((s) => s.id === 'earlier'), undefined)
  })

  it('determines the correct redirect URL and transaction receipt modal target', () => {
    // 1. Transaction Receipt URL when txRef exists
    const paymentWithTx: ParsedNotification = {
      id: 'tx-1',
      notification_type: 'LENDING_PAYMENT_RECEIVED',
      title: 'Payment Received',
      message: 'Jasmine paid ₱240.00 via Cash (TX-20261118-0231)',
      created_at: null,
      unread: false,
      category: 'lending',
      categoryLabel: 'Lending',
      isDueReminder: false,
      isPayment: true,
      borrowerName: 'Jasmine',
      txRef: 'TX-20261118-0231',
      dateKey: '2026-11-18',
    }
    assert.equal(
      getNotificationRedirectUrl(paymentWithTx),
      '/transaction?tab=all&ref=TX-20261118-0231'
    )

    // 2. Lender Loan redirection when payment received from lender or lender notice without txRef
    const lenderLoan: ParsedNotification = {
      id: 'loan-1',
      notification_type: 'LOAN_REPAYMENT_RECEIVED',
      title: 'Overdue Loan — Payment Not Received',
      message: "Reymie's loan (Ref: LN-101) is overdue. Please check with lender.",
      created_at: null,
      unread: true,
      category: 'other',
      categoryLabel: 'Loan',
      isDueReminder: true,
      isPayment: false,
      loanRef: 'LN-101',
      dateKey: '2026-11-18',
      refType: 'loan',
    }
    assert.equal(
      getNotificationRedirectUrl(lenderLoan),
      '/loan/lender?search=LN-101'
    )

    // 3. Borrower Loan redirection
    const borrowerLoan: ParsedNotification = {
      id: 'loan-2',
      notification_type: 'LOAN_REQUEST_FINANCE',
      title: 'New Loan Request (Borrower)',
      message: 'New request for borrower (Ref: LN-202)',
      created_at: null,
      unread: true,
      category: 'other',
      categoryLabel: 'Loan',
      isDueReminder: false,
      isPayment: false,
      loanRef: 'LN-202',
      dateKey: '2026-11-18',
      refType: 'loan',
    }
    assert.equal(
      getNotificationRedirectUrl(borrowerLoan),
      '/loan/borrower?search=LN-202'
    )

    // 4. Filcap Lending redirection without txRef
    const lendingBorrower: ParsedNotification = {
      id: 'lend-1',
      notification_type: 'LENDING_OVERDUE',
      title: 'Lending Overdue',
      message: 'Reymie Gonzaga has an overdue balance',
      created_at: null,
      unread: true,
      category: 'lending',
      categoryLabel: 'Lending',
      isDueReminder: true,
      isPayment: false,
      borrowerName: 'Reymie Gonzaga',
      dateKey: '2026-11-18',
      refType: 'lending',
    }
    assert.equal(
      getNotificationRedirectUrl(lendingBorrower),
      '/lending?search=Reymie%20Gonzaga'
    )

    // 5. Bill redirection
    const billNotif: ParsedNotification = {
      id: 'bill-1',
      notification_type: 'BILL_DUE_SOON',
      title: 'Meralco Bill Due',
      message: 'Meralco bill is due soon',
      created_at: null,
      unread: true,
      category: 'bills',
      categoryLabel: 'Bills',
      isDueReminder: true,
      isPayment: false,
      refId: 42,
      refType: 'bill',
      dateKey: '2026-11-18',
    }
    assert.equal(getNotificationRedirectUrl(billNotif), '/bills/42')
  })
})
