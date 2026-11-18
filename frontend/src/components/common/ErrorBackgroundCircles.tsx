import * as React from 'react'

export interface ErrorBackgroundCirclesProps {
  className?: string
  enableFloat?: boolean
}

/**
 * Renders four soft maroon-to-white gradient decorative circles matching the 404 mockup:
 * - Top-left: partly off-screen on the left edge
 * - Top-right: upper-right quadrant
 * - Bottom-left: lower-left quadrant
 * - Bottom-right: partly off-screen in the lower-right corner
 *
 * All circles are aria-hidden, pointer-events-none, and contained to prevent horizontal scroll.
 */
export const ErrorBackgroundCircles: React.FC<ErrorBackgroundCirclesProps> = ({
  className = '',
  enableFloat = true,
}) => {
  // Soft 3D sphere gradient in brand maroon (#8E0F00)
  const sphereGradient =
    'radial-gradient(circle at 35% 35%, #FFFFFF 0%, #FFFFFF 8%, #F7D2CF 24%, #E06157 48%, #B62215 70%, #8E0F00 90%, #8E0F00 100%)'

  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden pointer-events-none select-none z-0 ${className}`}
    >
      {/* 1. TOP-LEFT: partly off-screen on the left edge */}
      <div
        className={`absolute -left-20 sm:-left-28 md:-left-36 top-[18%] sm:top-[16%] w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-full opacity-90 transition-transform duration-700 ${
          enableFloat ? 'animate-sphere-float-1 motion-reduce:animate-none' : ''
        }`}
        style={{
          background: sphereGradient,
        }}
      />

      {/* 2. TOP-RIGHT: in the upper-right quadrant */}
      <div
        className={`absolute right-4 sm:right-12 md:right-20 top-4 sm:top-8 md:top-12 w-48 h-48 sm:w-60 sm:h-60 md:w-72 md:h-72 rounded-full opacity-85 transition-transform duration-700 ${
          enableFloat ? 'animate-sphere-float-2 motion-reduce:animate-none' : ''
        }`}
        style={{
          background: sphereGradient,
        }}
      />

      {/* 3. BOTTOM-LEFT: in the lower-left quadrant */}
      <div
        className={`absolute left-6 sm:left-14 md:left-24 bottom-6 sm:bottom-12 md:bottom-16 w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 rounded-full opacity-85 transition-transform duration-700 ${
          enableFloat ? 'animate-sphere-float-3 motion-reduce:animate-none' : ''
        }`}
        style={{
          background: sphereGradient,
        }}
      />

      {/* 4. BOTTOM-RIGHT: partly off-screen in the bottom-right corner */}
      <div
        className={`absolute -right-20 sm:-right-24 md:-right-32 -bottom-20 sm:-bottom-24 md:-bottom-32 w-72 h-72 sm:w-96 sm:h-96 md:w-[440px] md:h-[440px] rounded-full opacity-90 transition-transform duration-700 ${
          enableFloat ? 'animate-sphere-float-accent motion-reduce:animate-none' : ''
        }`}
        style={{
          background: sphereGradient,
        }}
      />
    </div>
  )
}
