import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Loader2 } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

interface NavUserBlockProps {
  isCollapsed?: boolean
}

export const NavUserBlock: React.FC<NavUserBlockProps> = ({ isCollapsed = false }) => {
  const { user, signOut } = useSession()
  const navigate = useNavigate()
  const [isLoggingOut, setIsLoggingOut] = React.useState(false)

  const handleLogout = async () => {
    if (isLoggingOut) return
    try {
      setIsLoggingOut(true)
      await signOut()
    } finally {
      // Regardless of outcome, navigate to /login with replace
      navigate('/login', { replace: true })
    }
  }

  // Get initials from user full name
  const initials = (() => {
    if (!user?.fullName) return 'U'
    const parts = user.fullName.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  })()

  const avatarSrc =
    user?.avatarUrl ||
    (typeof window !== 'undefined' ? localStorage.getItem('mct_user_avatar') : null)

  if (isCollapsed) {
    return (
      <div className="w-full flex flex-col items-center gap-2 py-1">
        <Avatar
          className="h-9 w-9 border-2 border-primary bg-white shrink-0 mx-auto"
          title={`${user?.fullName || 'User'} (${user?.role || ''})`}
        >
          {avatarSrc && (
            <AvatarImage
              src={avatarSrc}
              alt={user?.fullName || 'User'}
              className="p-1 object-contain"
            />
          )}
          <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>

        <Button
          type="button"
          size="icon"
          disabled={isLoggingOut}
          onClick={handleLogout}
          className="h-8 w-8 bg-[#960C01] hover:bg-[#800a01] text-white rounded-lg flex items-center justify-center shadow-xs"
          title="Log out of account"
          aria-label="Log out of account"
        >
          {isLoggingOut ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-3">
        <Avatar className="h-10 w-10 border-2 border-primary bg-white shrink-0">
          {avatarSrc && (
            <AvatarImage
              src={avatarSrc}
              alt={user?.fullName || 'User'}
              className="p-1 object-contain"
            />
          )}
          <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-focus truncate">
            {user?.fullName ?? ''}
          </span>
          <span className="text-[11px] font-semibold text-primary truncate">
            {user?.role ?? ''}
          </span>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        disabled={isLoggingOut}
        onClick={handleLogout}
        className="w-auto px-3 h-8 text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white rounded-md flex items-center gap-1.5 shadow-sm"
        aria-label="Log out of account"
      >
        {isLoggingOut ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Logging out…</span>
          </>
        ) : (
          <>
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </>
        )}
      </Button>
    </div>
  )
}
