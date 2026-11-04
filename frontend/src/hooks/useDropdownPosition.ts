import * as React from 'react'

export interface DropdownPosition {
  isMobile: boolean
  style?: React.CSSProperties
}

/**
 * Calculates responsive dropdown menu positioning:
 * - On mobile (< 640px): fixed position, horizontally centered (left: 50%, transform: translateX(-50%)),
 *   placed right below the trigger button (or above if tight on space), with max-width constrained
 *   to screen width minus margin so no choices are ever cropped.
 * - On desktop (>= 640px): standard relative/absolute positioning under the button.
 */
export function useDropdownPosition(
  triggerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean
): DropdownPosition {
  const [pos, setPos] = React.useState<DropdownPosition>({ isMobile: false })

  React.useLayoutEffect(() => {
    if (!isOpen) return

    const compute = () => {
      const isMobile = window.innerWidth < 640
      if (!isMobile || !triggerRef.current) {
        setPos({ isMobile: false })
        return
      }

      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - 12
      const spaceAbove = rect.top - 12

      // If space below is less than 160px and space above has more room, flip upward
      const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow

      setPos({
        isMobile: true,
        style: {
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(calc(100vw - 32px), 320px)',
          maxHeight: `${Math.min(360, Math.max(180, openUpward ? spaceAbove : spaceBelow))}px`,
          top: openUpward ? undefined : `${rect.bottom + 8}px`,
          bottom: openUpward ? `${window.innerHeight - rect.top + 8}px` : undefined,
          zIndex: 9999,
        },
      })
    }

    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, { passive: true })
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute)
    }
  }, [isOpen, triggerRef])

  return pos
}
