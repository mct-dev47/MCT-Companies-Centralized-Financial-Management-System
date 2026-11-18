import * as React from 'react'
import { GradientCircle } from '@/components/auth/GradientCircle'

export interface ErrorBackgroundCirclesProps {
  mouseOffset?: { x: number; y: number }
  className?: string
}

/**
 * Renders four soft maroon-to-white gradient decorative spheres using the
 * EXACT same GradientCircle component and floating animations as the Login / BrandPanel.
 *
 * Placed in the four corners matching the 404 mockup:
 * - Circle 1: Top-Left / Middle-Left (partly off-screen)
 * - Circle 2: Top-Right
 * - Circle 3: Bottom-Left
 * - Circle 4: Bottom-Right (partly off-screen)
 *
 * Includes mouse parallax tracking identical to the login screen.
 */
export const ErrorBackgroundCircles: React.FC<ErrorBackgroundCirclesProps> = ({
  mouseOffset = { x: 0, y: 0 },
  className = '',
}) => {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 pointer-events-none overflow-hidden select-none z-0 ${className}`}
    >
      {/* Circle 1: Top-Left / Middle-Left (partly off-screen to the left) */}
      <div
        className="absolute top-[16%] -left-[14%] sm:-left-[10%] lg:-left-[8%] w-[clamp(150px,26vw,380px)] aspect-square opacity-70 md:opacity-95 transition-transform duration-1000 ease-out will-change-transform"
        style={{
          transform: `translate3d(${mouseOffset.x * -28}px, ${mouseOffset.y * -20}px, 0)`,
        }}
      >
        <GradientCircle variant="2" hasShadow={true} className="w-full h-full" />
      </div>

      {/* Circle 2: Top-Right (upper-right quadrant) */}
      <div
        className="absolute top-[4%] right-[6%] sm:right-[10%] lg:right-[12%] w-[clamp(110px,18vw,260px)] aspect-square opacity-60 md:opacity-90 transition-transform duration-700 ease-out will-change-transform"
        style={{
          transform: `translate3d(${mouseOffset.x * 24}px, ${mouseOffset.y * 24}px, 0)`,
        }}
      >
        <GradientCircle variant="1" hasShadow={true} className="w-full h-full" />
      </div>

      {/* Circle 3: Bottom-Left (lower-left quadrant) */}
      <div
        className="absolute bottom-[6%] left-[6%] sm:left-[10%] lg:left-[12%] w-[clamp(120px,20vw,280px)] aspect-square opacity-60 md:opacity-90 transition-transform duration-800 ease-out will-change-transform"
        style={{
          transform: `translate3d(${mouseOffset.x * -20}px, ${mouseOffset.y * 24}px, 0)`,
        }}
      >
        <GradientCircle variant="3" hasShadow={true} className="w-full h-full" />
      </div>

      {/* Circle 4: Bottom-Right (partly off-screen in the bottom-right corner) */}
      <div
        className="absolute -bottom-[12%] -right-[10%] sm:-right-[8%] lg:-right-[6%] w-[clamp(160px,28vw,420px)] aspect-square opacity-70 md:opacity-95 transition-transform duration-900 ease-out will-change-transform"
        style={{
          transform: `translate3d(${mouseOffset.x * 30}px, ${mouseOffset.y * 32}px, 0)`,
        }}
      >
        <GradientCircle variant="accent" hasShadow={true} className="w-full h-full" />
      </div>
    </div>
  )
}

export default ErrorBackgroundCircles
