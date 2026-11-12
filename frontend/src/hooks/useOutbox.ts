import * as React from 'react'
import { offlineQueue, type OutboxSnapshot } from '@/services/offlineQueue'
import { offlineSync, type SyncState } from '@/services/offlineSync'

/** Live view of the offline outbox and sync state (spec 0038). */
export function useOutbox(): OutboxSnapshot & SyncState {
  const queue = React.useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getSnapshot)
  const sync = React.useSyncExternalStore(offlineSync.subscribe, offlineSync.getState)
  return { ...queue, ...sync }
}

/**
 * Loads the logged in user's outbox and keeps the sync loop running.
 * Mounted once in AppShell, so it runs on every signed in page.
 */
export function useOfflineSyncLifecycle(userId: string | null): void {
  React.useEffect(() => {
    let cancelled = false
    void offlineQueue.setActiveUser(userId).then(() => {
      if (cancelled || !userId) return
      offlineSync.start()
      offlineSync.resumeAfterLogin()
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Signing out unmounts the shell: hide this user's entries (they stay stored for their next login)
  React.useEffect(() => () => void offlineQueue.setActiveUser(null), [])
}

/**
 * Ask before logging out while entries are still waiting (AC-13).
 * Logging out never deletes them: they stay on this device and sync after the same user logs in again.
 */
export function confirmLogoutWithOutbox(): boolean {
  const count = offlineQueue.pendingCount()
  if (count === 0 || typeof window === 'undefined') return true
  return window.confirm(
    `${count} ${count === 1 ? 'entry has' : 'entries have'} not reached the server yet.\n\n` +
      'They stay saved on this device and will sync the next time you log in here with this account. ' +
      'Log out anyway?'
  )
}
