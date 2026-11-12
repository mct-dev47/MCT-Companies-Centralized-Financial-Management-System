/**
 * Sends waiting outbox entries to the server (spec 0038).
 *
 * Runs while the app is open, on any page: when the connection comes back, on app start and login,
 * and every 30 seconds while entries are waiting. Entries are sent one at a time, oldest first,
 * so an unpaid sale always reaches the server before its receivable.
 */
import { offlineQueue, type OutboxEntry } from '@/services/offlineQueue'
import { salesService } from '@/services/salesService'
import { expenseService } from '@/services/expenseService'
import { receivablesService } from '@/services/receivablesService'
import { receivablesStore } from '@/services/receivablesStore'
import { bankService } from '@/services/bankService'
import { authService } from '@/services/authService'
import { isAuthError, isConnectivityError, isServerError } from '@/lib/requestErrors'
import { notifySuccess } from '@/utils/errorUtils'

const TICK_MS = 30_000
/** Wait after each failed attempt: 5s, 15s, 1 min, then every 5 min. */
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000]

export interface SyncState {
  online: boolean
  syncing: boolean
  /** The session expired: syncing waits until the user logs in again. */
  needsLogin: boolean
}

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  needsLogin: false,
}
const listeners = new Set<() => void>()
let started = false
let runPromise: Promise<void> | null = null

function setState(next: Partial<SyncState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0]
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The server rejected this entry.'
}

type SendResult = { ok: true; saleId?: number } | { ok: false; stop: boolean }

async function send(entry: OutboxEntry): Promise<SendResult> {
  try {
    if (entry.kind === 'sale') {
      const created = await salesService.addSale({ ...entry.input, clientRef: entry.id })
      const saleId = Number(created?.id)
      return { ok: true, saleId: Number.isNaN(saleId) ? undefined : saleId }
    }
    if (entry.kind === 'expense') {
      await expenseService.addExpense({ ...entry.input, clientRef: entry.id })
      return { ok: true }
    }
    await receivablesService.createReceivable({ ...entry.input, client_ref: entry.id })
    return { ok: true }
  } catch (err) {
    if (isConnectivityError(err) || isServerError(err)) {
      const attempts = entry.attempts + 1
      await offlineQueue.update(entry.id, {
        status: 'waiting',
        attempts,
        nextAttemptAt: Date.now() + backoffFor(attempts),
        lastError: messageOf(err),
      })
      if (isConnectivityError(err)) setState({ online: false })
      // No connection: the rest would fail too, so stop this round
      return { ok: false, stop: isConnectivityError(err) }
    }
    if (isAuthError(err)) {
      await offlineQueue.update(entry.id, { status: 'waiting' })
      const user = await authService.refreshSession()
      if (!user) setState({ needsLogin: true })
      return { ok: false, stop: true }
    }
    await offlineQueue.update(entry.id, { status: 'needs_attention', lastError: messageOf(err) })
    return { ok: false, stop: false }
  }
}

async function runRound(): Promise<void> {
  const snap = offlineQueue.getSnapshot()
  if (!snap.userId || snap.paused || state.needsLogin) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ online: false })
    return
  }

  let synced = 0
  setState({ syncing: true })
  try {
    // Re-read the queue each step: the user may edit, delete, or pause while a round runs
    for (;;) {
      const current = offlineQueue.getSnapshot()
      if (current.paused || current.userId !== snap.userId) break
      const now = Date.now()
      const ids = new Set(current.entries.map((e) => e.id))

      // A receivable whose sale is gone and never synced can't be sent
      for (const e of current.entries) {
        if (e.kind === 'receivable' && e.status === 'waiting' && !ids.has(e.dependsOn) && !e.input.sale_id) {
          await offlineQueue.update(e.id, { status: 'needs_attention', lastError: 'Its sale was not saved.' })
        }
      }

      const next = offlineQueue
        .getSnapshot()
        .entries.find(
          (e) =>
            e.status === 'waiting' &&
            e.nextAttemptAt <= now &&
            // a receivable waits until its sale has synced and left the queue
            !(e.kind === 'receivable' && ids.has(e.dependsOn))
        )
      if (!next) break

      await offlineQueue.update(next.id, { status: 'sending' })
      const result = await send(next)
      if (result.ok) {
        if (next.kind === 'sale' && result.saleId !== undefined) {
          // Hand the new sale ID to its receivable before the sale leaves the queue
          for (const dep of offlineQueue.getSnapshot().entries) {
            if (dep.kind === 'receivable' && dep.dependsOn === next.id) {
              await offlineQueue.update(dep.id, { input: { ...dep.input, sale_id: result.saleId } })
            }
          }
        }
        // Confirmed by the server: drop only this entry (its receivable, if any, is sent next)
        await offlineQueue.removeSynced(next.id)
        synced += 1
        setState({ online: true })
      } else if (result.stop) {
        break
      }
    }
  } finally {
    setState({ syncing: false })
  }

  if (synced > 0) {
    salesService.invalidateCache()
    expenseService.invalidateCache()
    bankService.invalidateCache()
    void receivablesStore.refreshFromBackend().catch(() => {})
    notifySuccess(`${synced} offline ${synced === 1 ? 'entry was' : 'entries were'} saved to the server.`)
  }
}

export const offlineSync = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getState(): SyncState {
    return state
  },

  /** Run one sync round now (no-op if one is already running). */
  syncNow(): Promise<void> {
    if (!runPromise) {
      runPromise = runRound().finally(() => {
        runPromise = null
      })
    }
    return runPromise
  },

  /** Call after a fresh login so a sync paused by an expired session resumes. */
  resumeAfterLogin(): void {
    setState({ needsLogin: false })
    void this.syncNow()
  },

  /** Start the background loop once per page load. */
  start(): void {
    if (started || typeof window === 'undefined') return
    started = true
    window.addEventListener('online', () => {
      setState({ online: true })
      void this.syncNow()
    })
    window.addEventListener('offline', () => setState({ online: false }))
    window.setInterval(() => {
      if (offlineQueue.pendingCount() > 0) void this.syncNow()
    }, TICK_MS)
    void this.syncNow()
  },
}
