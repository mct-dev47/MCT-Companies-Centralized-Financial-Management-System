/**
 * Offline outbox (spec 0038).
 *
 * New sales, expenses, and unpaid sale receivables that could not reach the server wait here.
 * Entries live in IndexedDB (the browser's built in database, stored on this device, no internet
 * needed), so they survive leaving the page, reloading, closing the tab, and logging out.
 * Each entry belongs to the user who created it. The access token is never stored here.
 *
 * `offlineSync.ts` sends the entries when the connection is back.
 */
import type { NewSalesInput } from '@/services/salesService'
import type { NewExpenseInput } from '@/services/expenseService'

export type OutboxKind = 'sale' | 'expense' | 'receivable'
export type OutboxStatus = 'waiting' | 'sending' | 'needs_attention'

/** What `receivablesService.createReceivable` takes; `sale_id` is filled in when its sale syncs. */
export interface OutboxReceivableInput {
  customer_name: string
  customer_type: string
  items_summary: string
  total_amount: number
  amount_paid?: number
  payment_option?: string
  payment_method?: string
  notes?: string
  company_name?: string
  sale_id?: number
  date?: string
}

interface OutboxEntryBase {
  /** Also sent to the server as `client_ref`, so a resend never creates a duplicate. */
  id: string
  userId: string
  company: string
  status: OutboxStatus
  attempts: number
  /** Epoch ms; the sync loop skips the entry until then (backoff). */
  nextAttemptAt: number
  lastError?: string
  createdAt: number
}

export type OutboxEntry =
  | (OutboxEntryBase & { kind: 'sale'; input: NewSalesInput })
  | (OutboxEntryBase & { kind: 'expense'; input: NewExpenseInput })
  | (OutboxEntryBase & { kind: 'receivable'; input: OutboxReceivableInput; dependsOn: string })

export type NewOutboxEntry =
  | { id?: string; kind: 'sale'; company: string; input: NewSalesInput }
  | { id?: string; kind: 'expense'; company: string; input: NewExpenseInput }
  | { id?: string; kind: 'receivable'; company: string; input: OutboxReceivableInput; dependsOn: string }

export interface OutboxSnapshot {
  userId: string | null
  entries: OutboxEntry[]
  paused: boolean
  /** False when IndexedDB is unavailable (some private windows): entries then last only until reload. */
  persistent: boolean
}

const DB_NAME = 'mct_offline'
const DB_VERSION = 1
const OUTBOX = 'outbox'
const META = 'meta'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const store = db.createObjectStore(OUTBOX, { keyPath: 'id' })
          store.createIndex('by_user', 'userId', { unique: false })
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  try {
    const tx = db.transaction(name, mode)
    return await reqToPromise(fn(tx.objectStore(name)))
  } catch (err) {
    console.warn('Offline outbox storage error:', err)
    return undefined
  }
}

// ---------------------------------------------------------------- in memory snapshot

let snapshot: OutboxSnapshot = { userId: null, entries: [], paused: false, persistent: true }
const listeners = new Set<() => void>()

function emit(next: Partial<OutboxSnapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((l) => l())
}

function sortEntries(entries: OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt)
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
}

async function persist(entry: OutboxEntry): Promise<void> {
  await withStore(OUTBOX, 'readwrite', (s) => s.put(entry))
}

async function unpersist(id: string): Promise<void> {
  await withStore(OUTBOX, 'readwrite', (s) => s.delete(id))
}

// ---------------------------------------------------------------- public API

export const offlineQueue = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getSnapshot(): OutboxSnapshot {
    return snapshot
  },

  /** Number of entries not yet confirmed by the server, for the current user. */
  pendingCount(): number {
    return snapshot.entries.length
  },

  newId,

  /**
   * Load the outbox of the user who just logged in (or clear the view on logout).
   * Entries are never deleted here: another user's entries simply stay hidden until they log in.
   */
  async setActiveUser(userId: string | null): Promise<void> {
    if (userId === snapshot.userId) return
    if (!userId) {
      emit({ userId: null, entries: [], paused: false })
      return
    }
    const db = await openDb()
    if (!db) {
      emit({ userId, entries: [], paused: false, persistent: false })
      return
    }
    const rows =
      (await withStore<OutboxEntry[]>(OUTBOX, 'readonly', (s) => s.index('by_user').getAll(userId))) || []
    const meta = await withStore<{ key: string; paused: boolean } | undefined>(META, 'readonly', (s) =>
      s.get(`paused:${userId}`)
    )
    // A page closed mid send leaves entries in "sending"; client_ref makes resending them safe
    const restored = rows.map((e) => (e.status === 'sending' ? { ...e, status: 'waiting' as const } : e))
    await Promise.all(restored.filter((e, i) => e !== rows[i]).map(persist))
    emit({ userId, entries: sortEntries(restored), paused: Boolean(meta?.paused), persistent: true })
  },

  /** Add entries for the current user. Returns the stored entries (with their ids). */
  async enqueue(items: NewOutboxEntry[]): Promise<OutboxEntry[]> {
    const userId = snapshot.userId
    if (!userId) throw new Error('Cannot save offline: no user is logged in.')
    const now = Date.now()
    const created = items.map(
      (item, i) =>
        ({
          ...item,
          id: item.id || newId(),
          userId,
          status: 'waiting',
          attempts: 0,
          nextAttemptAt: 0,
          createdAt: now + i, // keeps the order rows were typed in
        }) as OutboxEntry
    )
    await Promise.all(created.map(persist))
    emit({ entries: sortEntries([...snapshot.entries, ...created]) })
    return created
  },

  async update(id: string, patch: Partial<OutboxEntry>): Promise<void> {
    const current = snapshot.entries.find((e) => e.id === id)
    if (!current) return
    const next = { ...current, ...patch, id: current.id, userId: current.userId } as OutboxEntry
    await persist(next)
    emit({ entries: snapshot.entries.map((e) => (e.id === id ? next : e)) })
  },

  /** Remove an entry, plus anything waiting on it (a deleted sale takes its receivable with it). */
  async remove(id: string): Promise<void> {
    const ids = new Set([id])
    snapshot.entries.forEach((e) => {
      if (e.kind === 'receivable' && e.dependsOn === id) ids.add(e.id)
    })
    await Promise.all([...ids].map(unpersist))
    emit({ entries: snapshot.entries.filter((e) => !ids.has(e.id)) })
  },

  /** The server confirmed this entry: drop it alone (entries waiting on it stay and are sent next). */
  async removeSynced(id: string): Promise<void> {
    await unpersist(id)
    emit({ entries: snapshot.entries.filter((e) => e.id !== id) })
  },

  async clearAll(): Promise<void> {
    await Promise.all(snapshot.entries.map((e) => unpersist(e.id)))
    emit({ entries: [] })
  },

  async setPaused(paused: boolean): Promise<void> {
    const userId = snapshot.userId
    if (!userId) return
    await withStore(META, 'readwrite', (s) => s.put({ key: `paused:${userId}`, paused }))
    emit({ paused })
  },
}
