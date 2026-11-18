import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapStatementRepayment,
  mergeLoanRepayments,
  type LoanRepaymentLike,
} from '../loanRepaymentHelpers.ts'

describe('Loan repayment deduplication and statement mapping', () => {
  it('does not duplicate a single repayment with no reference number across statement and loan.repayments', () => {
    const statementRepayments = [
      mapStatementRepayment(
        {
          loan_repayment_id: 101,
          payment_date: '2026-11-18',
          amount: 5000,
          remaining_balance: 10150,
          reference_no: null,
          payment_method: 'Cash',
          notes: null,
        },
        0,
        '2026-11-19'
      ),
    ]

    const localRepayments: LoanRepaymentLike[] = [
      {
        id: '101',
        paymentDate: '2026-11-18',
        amount: 5000,
        remainingBalance: 10150,
        referenceNo: '',
        paymentMethod: 'Cash',
        notes: '',
      },
    ]

    const merged = mergeLoanRepayments(statementRepayments, localRepayments)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].id, '101')
    assert.equal(merged[0].amount, 5000)
  })

  it('deduplicates synthetic fallback records even if one uses em-dash as referenceNo', () => {
    const statementRepayments: LoanRepaymentLike[] = [
      {
        id: 'stmt-0',
        paymentDate: '2026-11-18',
        amount: 5000,
        remainingBalance: 10150,
        referenceNo: '—',
        paymentMethod: 'Cash',
        notes: 'Loan repayment remittance',
      },
    ]
    const localRepayments: LoanRepaymentLike[] = [
      {
        id: 'rep_1795018356556',
        paymentDate: '2026-11-18',
        amount: 5000,
        remainingBalance: 10150,
        referenceNo: '',
        paymentMethod: 'Cash',
        notes: '',
      },
    ]

    const merged = mergeLoanRepayments(statementRepayments, localRepayments)
    assert.equal(merged.length, 1)
  })

  it('preserves two distinct same-day equal-amount repayments with different backend IDs', () => {
    const statementRepayments = [
      mapStatementRepayment(
        {
          loan_repayment_id: 101,
          payment_date: '2026-11-18',
          amount: 5000,
          remaining_balance: 10150,
          reference_no: null,
          payment_method: 'Cash',
          notes: null,
        },
        0,
        '2026-11-19'
      ),
      mapStatementRepayment(
        {
          loan_repayment_id: 102,
          payment_date: '2026-11-18',
          amount: 5000,
          remaining_balance: 5150,
          reference_no: null,
          payment_method: 'Cash',
          notes: null,
        },
        1,
        '2026-11-19'
      ),
    ]

    const localRepayments: LoanRepaymentLike[] = [
      {
        id: '101',
        paymentDate: '2026-11-18',
        amount: 5000,
        remainingBalance: 10150,
        referenceNo: '',
        paymentMethod: 'Cash',
        notes: '',
      },
      {
        id: '102',
        paymentDate: '2026-11-18',
        amount: 5000,
        remainingBalance: 5150,
        referenceNo: '',
        paymentMethod: 'Cash',
        notes: '',
      },
    ]

    const merged = mergeLoanRepayments(statementRepayments, localRepayments)
    assert.equal(merged.length, 2)
    assert.deepEqual(
      merged.map((r) => r.id).sort(),
      ['101', '102']
    )
  })
})
