import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  round2,
  addPeriodClamped,
  countPeriods,
  buildSchedule,
  getLeaseFinancials,
  getDefaultDatesForRepeat,
  validateRepeatSettings,
  type ScheduleLease,
} from '../../services/tenantScheduleService.ts'

describe('Tenant Lease Schedule & Financial Engine Spec', () => {
  describe('round2 precision helper', () => {
    it('rounds standard two decimal floats accurately', () => {
      assert.equal(round2(100.456), 100.46)
      assert.equal(round2(100.454), 100.45)
    })

    it('corrects classic floating point addition inaccuracy', () => {
      assert.equal(round2(0.1 + 0.2), 0.3)
      assert.equal(round2(0.7 + 0.1), 0.8)
    })

    it('handles negative floats and zero correctly', () => {
      assert.equal(round2(0), 0)
      assert.equal(round2(-12.34), -12.34)
    })
  })

  describe('addPeriodClamped date arithmetic', () => {
    it('advances daily periods accurately across month borders', () => {
      assert.equal(addPeriodClamped('2026-01-31', 'Daily', 1), '2026-02-01')
      assert.equal(addPeriodClamped('2026-01-31', 'Daily', 5), '2026-02-05')
    })

    it('clamps month-end dates during leap years (Feb 29)', () => {
      // 2024 is a leap year: Jan 31 + 1 month should clamp to Feb 29
      assert.equal(addPeriodClamped('2024-01-31', 'Monthly', 1), '2024-02-29')
      // Jan 31 + 2 months should revert to Mar 31
      assert.equal(addPeriodClamped('2024-01-31', 'Monthly', 2), '2024-03-31')
    })

    it('clamps month-end dates during non-leap years (Feb 28)', () => {
      // 2025 is not a leap year: Jan 31 + 1 month should clamp to Feb 28
      assert.equal(addPeriodClamped('2025-01-31', 'Monthly', 1), '2025-02-28')
      assert.equal(addPeriodClamped('2025-01-31', 'Monthly', 2), '2025-03-31')
      // April has 30 days: Jan 31 + 3 months should clamp to Apr 30
      assert.equal(addPeriodClamped('2025-01-31', 'Monthly', 3), '2025-04-30')
    })

    it('returns empty string for invalid dates or None repeat', () => {
      assert.equal(addPeriodClamped('invalid-date', 'Monthly', 1), '')
      assert.equal(addPeriodClamped('2026-01-01', 'None', 1), '')
      assert.equal(addPeriodClamped('2026-01-01', 'Monthly', -1), '')
    })
  })

  describe('countPeriods payment count generator', () => {
    it('counts daily intervals inclusive of start and end', () => {
      const days = countPeriods('2026-03-01', '2026-03-10', 'Daily')
      assert.equal(days, 10)
    })

    it('counts monthly intervals accurately', () => {
      const months = countPeriods('2026-01-15', '2026-12-15', 'Monthly')
      assert.equal(months, 12)
    })

    it('returns 0 when end date is earlier than first due date', () => {
      const count = countPeriods('2026-05-01', '2026-04-01', 'Monthly')
      assert.equal(count, 0)
    })

    it('returns 0 when frequency is None or inputs are malformed', () => {
      assert.equal(countPeriods('2026-01-01', '2026-05-01', 'None'), 0)
      assert.equal(countPeriods('', '2026-05-01', 'Monthly'), 0)
    })
  })

  describe('getDefaultDatesForRepeat helper', () => {
    it('computes 30-day default window for Daily leases', () => {
      const dates = getDefaultDatesForRepeat('Daily', '2026-06-01')
      assert.equal(dates.dueDate, '2026-06-02') // tomorrow
      assert.equal(dates.leaseEndDate, '2026-07-01') // 30 periods
    })

    it('computes 12-month default window for Monthly leases', () => {
      const dates = getDefaultDatesForRepeat('Monthly', '2026-01-15')
      assert.equal(dates.dueDate, '2026-02-15')
      assert.equal(dates.leaseEndDate, '2027-01-15') // 12th period is Jan 15 of next year
    })
  })

  describe('validateRepeatSettings rules', () => {
    it('allows valid repeating lease configuration with zero errors', () => {
      const errors = validateRepeatSettings({
        repeat: 'Monthly',
        contractDate: '2026-01-01',
        dueDate: '2026-01-15',
        leaseEndDate: '2026-12-15',
        penaltyRate: '5',
      })
      assert.deepEqual(errors, {})
    })

    it('rejects first due date that is before contract date', () => {
      const errors = validateRepeatSettings({
        repeat: 'Monthly',
        contractDate: '2026-05-01',
        dueDate: '2026-04-15',
        leaseEndDate: '2026-12-15',
        penaltyRate: '',
      })
      assert.ok(errors.dueDate)
    })

    it('rejects invalid penalty rates out of 0-100 bounds', () => {
      const errors = validateRepeatSettings({
        repeat: 'Monthly',
        contractDate: '2026-01-01',
        dueDate: '2026-01-15',
        leaseEndDate: '2026-12-15',
        penaltyRate: '150',
      })
      assert.ok(errors.penaltyRate)
    })
  })

  describe('buildSchedule and getLeaseFinancials', () => {
    const sampleLease: ScheduleLease = {
      repeat: 'Monthly',
      dueDate: '2026-01-01',
      leaseEndDate: '2026-03-01', // 3 periods: Jan 1, Feb 1, Mar 1
      rentAmount: 10000,
      penaltyRate: 5,
      totalAmountPayable: 30000,
      amountPaid: 0,
      remainingBalance: 30000,
      dailyPayments: [],
    }

    it('builds initial unpaid schedule correctly', () => {
      const periods = buildSchedule(sampleLease, '2026-01-01')
      assert.equal(periods.length, 3)
      assert.equal(periods[0].label, 'Month 1')
      assert.equal(periods[0].dueDate, '2026-01-01')
      assert.equal(periods[0].amountDue, 10000)
      assert.equal(periods[0].remaining, 10000)
      assert.equal(periods[0].status, 'Unpaid')
    })

    it('marks periods as Paid when full direct payment is made on time', () => {
      const leaseWithPayment: ScheduleLease = {
        ...sampleLease,
        dailyPayments: [
          {
            id: 'p-1',
            date: '2026-01-01',
            amount: 10000,
            periodIndex: 1,
          },
        ],
      }
      const periods = buildSchedule(leaseWithPayment, '2026-01-01')
      assert.equal(periods[0].status, 'Paid')
      assert.equal(periods[0].remaining, 0)
      assert.equal(periods[0].paid, 10000)
      assert.equal(periods[1].status, 'Unpaid')
    })

    it('allocates excess payment to subsequent period as Advance Paid', () => {
      const leaseWithExcess: ScheduleLease = {
        ...sampleLease,
        dailyPayments: [
          {
            id: 'p-excess',
            date: '2026-01-01',
            amount: 25000, // Covers Period 1 (10,000), Period 2 (10,000), and Period 3 partially (5,000)
            periodIndex: 1,
          },
        ],
      }
      const periods = buildSchedule(leaseWithExcess, '2026-01-01')
      // Period 1: Paid directly
      assert.equal(periods[0].status, 'Paid')
      assert.equal(periods[0].directPaid, 10000)
      assert.equal(periods[0].remaining, 0)

      // Period 2: Fully covered by advance
      assert.equal(periods[1].status, 'Advance Paid')
      assert.equal(periods[1].advancePaid, 10000)
      assert.equal(periods[1].remaining, 0)

      // Period 3: Partially covered by advance
      assert.equal(periods[2].status, 'Partially Paid')
      assert.equal(periods[2].advancePaid, 5000)
      assert.equal(periods[2].remaining, 5000)
    })

    it('calculates aggregates in getLeaseFinancials correctly', () => {
      const leaseWithExcess: ScheduleLease = {
        ...sampleLease,
        dailyPayments: [
          {
            id: 'p-excess',
            date: '2026-01-01',
            amount: 25000,
            periodIndex: 1,
          },
        ],
      }
      const fin = getLeaseFinancials(leaseWithExcess, '2026-01-01')
      assert.equal(fin.periodCount, 3)
      assert.equal(fin.periodsPaid, 2)
      assert.equal(fin.totalDue, 30000)
      assert.equal(fin.amountPaid, 25000)
      assert.equal(fin.remaining, 5000)
      assert.equal(fin.nextPeriod?.index, 3)
    })
  })
})
