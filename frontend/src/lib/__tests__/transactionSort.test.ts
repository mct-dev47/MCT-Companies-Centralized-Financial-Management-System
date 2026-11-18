import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTransactionTimestamp,
  compareTransactionsDesc,
  compareTransactions,
} from '../transactionSort.ts'

describe('Transaction chronological sorting', () => {
  it('parses ISO timestamps with timezone offsets and ignores date-only strings', () => {
    assert.equal(parseTransactionTimestamp(undefined), 0)
    assert.equal(parseTransactionTimestamp(null), 0)
    assert.equal(parseTransactionTimestamp('2026-11-18'), 0)

    const utc = parseTransactionTimestamp('2026-11-18T02:00:00Z')
    const mnl = parseTransactionTimestamp('2026-11-18T10:00:00+08:00')
    assert.equal(utc, mnl)
    assert.ok(utc > 0)
  })

  it('sorts first by transaction date, then by timestamp of that transaction (desc)', () => {
    const items = [
      { id: 'tx-z', date: '2026-11-18', createdAt: '2026-11-18T09:00:00+08:00' },
      { id: 'tx-a', date: '2026-11-18', createdAt: '2026-11-18T14:30:00+08:00' },
      { id: 'tx-m', date: '2026-11-19', createdAt: '2026-11-19T08:00:00+08:00' },
      { id: 'tx-b', date: '11/17/2026', createdAt: '2026-11-17T16:00:00+08:00' },
    ]

    const sorted = [...items].sort(compareTransactionsDesc)
    assert.deepEqual(
      sorted.map((t) => t.id),
      ['tx-m', 'tx-a', 'tx-z', 'tx-b'],
    )
  })

  it('sorts oldest first when sortOrder is asc (date first, then timestamp)', () => {
    const items = [
      { id: 'tx-2', date: '2026-11-18', createdAt: '2026-11-18T14:30:00+08:00' },
      { id: 'tx-1', date: '2026-11-18', createdAt: '2026-11-18T09:00:00+08:00' },
      { id: 'tx-0', date: '2026-11-17', createdAt: '2026-11-17T23:00:00+08:00' },
    ]

    const sorted = [...items].sort((a, b) => compareTransactions(a, b, 'asc'))
    assert.deepEqual(
      sorted.map((t) => t.id),
      ['tx-0', 'tx-1', 'tx-2'],
    )
  })

  it('uses timestamp even when ids would sort in opposite order', () => {
    const items = [
      { id: 'btx-999', date: '2026-11-18', createdAt: '2026-11-18T08:00:00+08:00' },
      { id: 'btx-001', date: '2026-11-18', createdAt: '2026-11-18T15:00:00+08:00' },
    ]

    const desc = [...items].sort((a, b) => compareTransactions(a, b, 'desc'))
    assert.deepEqual(desc.map((t) => t.id), ['btx-001', 'btx-999'])

    const asc = [...items].sort((a, b) => compareTransactions(a, b, 'asc'))
    assert.deepEqual(asc.map((t) => t.id), ['btx-999', 'btx-001'])
  })
})
