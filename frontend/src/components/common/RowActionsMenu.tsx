import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, Eye, Pencil, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface RowActionsMenuProps {
  onViewDetails?: () => void
  onEdit?: () => void
  onMarkAudited?: () => void
  onFlagDiscrepancy?: () => void
  onDelete?: () => void
  canAudit?: boolean
  canEdit?: boolean
  canDelete?: boolean
  auditStatus?: string
  viewLabel?: string
  editLabel?: string
  deleteLabel?: string
  customItems?: React.ReactNode
  className?: string
}

export const RowActionsMenu: React.FC<RowActionsMenuProps> = ({
  onViewDetails,
  onEdit,
  onMarkAudited,
  onFlagDiscrepancy,
  onDelete,
  canAudit = false,
  canEdit = false,
  canDelete = false,
  auditStatus,
  viewLabel = 'View Details',
  editLabel = 'Edit',
  deleteLabel = 'Delete',
  customItems,
  className,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const handleOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (isOpen) {
      setIsOpen(false)
      setMenuPosition(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const openUpward = rect.bottom + 180 > window.innerHeight
    setMenuPosition({
      top: openUpward ? rect.top - 6 : rect.bottom + 6,
      right: Math.max(12, window.innerWidth - rect.right),
      openUpward,
    })
    setIsOpen(true)
  }

  const handleClose = React.useCallback(() => {
    setIsOpen(false)
    setMenuPosition(null)
  }, [])

  React.useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
        triggerRef.current?.focus()
      }
    }

    window.addEventListener('click', handleClose)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleClose])

  const hasAuditActions = canAudit && (onMarkAudited || onFlagDiscrepancy)
  const isVerified = auditStatus === 'Verified'

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        className="h-10 w-10 p-0 rounded-[10px] text-muted-fg hover:text-focus hover:bg-surface cursor-pointer flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-focus/40"
        title="Actions"
        aria-label="Open action menu"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreVertical className="w-4 h-4" />
      </Button>

      {isOpen &&
        menuPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-52 bg-white rounded-[16px] border border-stroke/30 shadow-soft p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. View Details */}
            {onViewDetails && (
              <button
                type="button"
                onClick={() => {
                  handleClose()
                  onViewDetails()
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-focus hover:bg-surface transition-colors text-left cursor-pointer min-h-[40px]"
              >
                <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>{viewLabel}</span>
              </button>
            )}

            {/* 2. Edit */}
            {canEdit && onEdit && (
              <button
                type="button"
                onClick={() => {
                  handleClose()
                  onEdit()
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-focus hover:bg-surface transition-colors text-left cursor-pointer min-h-[40px]"
              >
                <Pencil className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>{editLabel}</span>
              </button>
            )}

            {/* 3. Audit Actions (Mark as Audited & Flag Discrepancy) */}
            {hasAuditActions && (
              <>
                {onMarkAudited && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose()
                      onMarkAudited()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-emerald-800 hover:bg-emerald-50 transition-colors text-left cursor-pointer min-h-[40px]"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>{isVerified ? 'Re-Audit' : 'Mark as Audited'}</span>
                  </button>
                )}

                {onFlagDiscrepancy && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose()
                      onFlagDiscrepancy()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-rose-800 hover:bg-rose-50 transition-colors text-left cursor-pointer min-h-[40px]"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                    <span>Flag Discrepancy</span>
                  </button>
                )}
              </>
            )}

            {/* Custom items (e.g. specialized actions per page) */}
            {customItems}

            {/* 4. Delete (danger action, always at bottom with separator) */}
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={() => {
                  handleClose()
                  onDelete()
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer border-t border-stroke/20 mt-1 pt-2 min-h-[40px]"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{deleteLabel}</span>
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

