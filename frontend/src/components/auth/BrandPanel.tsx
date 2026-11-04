import * as React from 'react'
import { GradientCircle } from '@/components/auth/GradientCircle'
import logoIconUrl from '@/assets/LOGO.png'
import mctTextUrl from '@/assets/MCT.png'

export const BrandPanel: React.FC = () => {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [mouseOffset, setMouseOffset] = React.useState({ x: 0, y: 0 })

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    setMouseOffset({ x, y })
  }

  const handleMouseLeave = () => {
    setMouseOffset({ x: 0, y: 0 })
  }

  return (
    <div
      ref={panelRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative flex flex-col justify-between overflow-hidden bg-[#960C01] text-white p-[clamp(0.75rem,2.5vh,2rem)] sm:p-6 md:p-8 lg:p-12 xl:p-16 h-auto md:h-full md:min-h-[100dvh] max-h-[35vh] md:max-h-none shrink-0 select-none transition-all duration-300"
    >
      {/* Background Animated Spheres Layer */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        {/* Circle 1: Top-Right */}
        <div
          className="absolute top-[4%] right-[6%] md:right-[10%] w-[clamp(80px,20vw,280px)] aspect-square opacity-60 md:opacity-100 transition-transform duration-700 ease-out will-change-transform"
          style={{
            transform: `translate3d(${mouseOffset.x * 24}px, ${mouseOffset.y * 24}px, 0)`,
          }}
        >
          <GradientCircle variant="1" className="w-full h-full" />
        </div>

        {/* Circle 2: Middle-Left */}
        <div
          className="absolute top-[18%] -left-[20%] md:-left-[30%] w-[clamp(140px,36vw,540px)] aspect-square opacity-45 md:opacity-100 transition-transform duration-1000 ease-out will-change-transform"
          style={{
            transform: `translate3d(${mouseOffset.x * -28}px, ${mouseOffset.y * -20}px, 0)`,
          }}
        >
          <GradientCircle variant="2" className="w-full h-full" />
        </div>

        {/* Circle 3: Bottom-Right/Center */}
        <div
          className="absolute -bottom-[14%] right-[4%] w-[clamp(120px,32vw,500px)] aspect-square opacity-45 md:opacity-100 transition-transform duration-800 ease-out will-change-transform"
          style={{
            transform: `translate3d(${mouseOffset.x * 30}px, ${mouseOffset.y * 32}px, 0)`,
          }}
        >
          <GradientCircle variant="3" className="w-full h-full" />
        </div>

        {/* Circle 4 (Accent): Subtle floating accent sphere */}
        <div
          className="absolute top-[46%] right-[8%] w-[clamp(40px,10vw,130px)] aspect-square opacity-40 md:opacity-80 transition-transform duration-600 ease-out will-change-transform"
          style={{
            transform: `translate3d(${mouseOffset.x * -16}px, ${mouseOffset.y * 18}px, 0)`,
          }}
        >
          <GradientCircle variant="accent" className="w-full h-full" />
        </div>
      </div>

      {/* Header / Logo Lockup: LOGO.png + MCT.png + Group of Companies */}
      <header className="relative z-10 shrink-0">
        <div className="flex items-center gap-[clamp(0.5rem,1.5vw,0.875rem)]">
          <img
            src={logoIconUrl}
            alt="MCT Logo Icon"
            className="h-[clamp(28px,4.5vh,44px)] sm:h-10 md:h-11 w-auto object-contain shrink-0"
          />
          <div className="flex flex-col justify-center items-start">
            <img
              src={mctTextUrl}
              alt="MCT"
              className="h-[clamp(14px,2.2vh,24px)] sm:h-5 md:h-6 lg:h-6.5 max-h-[26px] md:max-h-none w-auto object-contain object-left block"
            />
            <span className="text-[clamp(8px,1.2vh,11px)] sm:text-[10px] md:text-[11px] font-semibold text-white/90 tracking-wider uppercase mt-0.5 leading-tight">
              Group of Companies
            </span>
          </div>
        </div>
      </header>

      {/* Center/Lower Brand Copy */}
      <main className="relative z-10 my-auto py-[clamp(0.25rem,1.2vh,1.5rem)] sm:py-4 md:py-8 lg:py-0 max-w-xl shrink-0">
        <h1 className="text-[clamp(1rem,2.8vh,2.5rem)] sm:text-2xl md:text-3xl lg:text-[46px] xl:text-[54px] font-bold text-white tracking-tight leading-[1.12] mb-[clamp(0.25rem,1vh,1.25rem)]">
          One Vision.<br className="hidden sm:inline" />{' '}
          Diverse Ventures.<br className="hidden sm:inline" />{' '}
          Shared Success.
        </h1>
        <p className="text-[clamp(0.7rem,1.5vh,1rem)] sm:text-xs md:text-sm lg:text-[17px] xl:text-[18px] text-white/90 leading-snug md:leading-relaxed font-normal max-w-md">
          One place to track sales, expenses and loans across all MCT companies.
        </p>
      </main>

      {/* Footer / Copyright - On desktop it sits at bottom left; on mobile it is placed at the document footer */}
      <footer className="hidden md:block relative z-10 pt-4 text-xs lg:text-sm text-white/80 font-normal shrink-0">
        <p>© 2026 MCT Group of Companies</p>
      </footer>
    </div>
  )
}
