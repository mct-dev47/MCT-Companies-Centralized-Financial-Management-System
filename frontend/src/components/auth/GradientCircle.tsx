import * as React from 'react'
import { cn } from '@/lib/utils'

export interface GradientCircleProps {
  className?: string
  style?: React.CSSProperties
  variant?: '1' | '2' | '3' | 'accent' | 'none'
  hasShadow?: boolean
}

export const GradientCircle: React.FC<GradientCircleProps> = ({
  className,
  style,
  variant = 'none',
  hasShadow = true,
}) => {
  const variantClass =
    variant === '1'
      ? 'animate-sphere-float-1'
      : variant === '2'
      ? 'animate-sphere-float-2'
      : variant === '3'
      ? 'animate-sphere-float-3'
      : variant === 'accent'
      ? 'animate-sphere-float-accent'
      : ''

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none rounded-full select-none aspect-square will-change-transform',
        hasShadow && 'shadow-[0_22px_48px_rgba(0,0,0,0.26)]',
        variantClass,
        className
      )}
      style={{
        background:
          'radial-gradient(circle at 36% 36%, #FFFFFF 0%, #FFFFFF 8%, #F7D2CF 24%, #E06157 46%, #BE2B20 68%, #960C01 88%, #960C01 100%)',
        ...style,
      }}
    />
  )
}
