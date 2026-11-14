import * as React from 'react'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { UserProfileDropdown } from '@/components/layout/UserProfileDropdown'
import { OutboxIndicator } from '@/components/layout/OfflineOutbox'

export const TopHeader: React.FC = () => {
  return (
    <header className="h-14 sm:h-16 w-full bg-background border-b border-stroke/20 flex items-center justify-between px-6 sm:px-8 sticky top-0 z-30 select-none">
      {/* Left side empty placeholder to maintain flex justify-between */}
      <div className="flex items-center gap-3" />

      {/* Right side: Notification Bell & User Profile Dropdown */}
      <div className="flex items-center gap-3 sm:gap-4">
        <OutboxIndicator />
        <NotificationBell />
        <div className="w-px h-6 bg-stroke/30 mx-0.5 hidden sm:block" />
        <UserProfileDropdown />
      </div>
    </header>
  )
}
