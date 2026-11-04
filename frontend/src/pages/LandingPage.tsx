import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, X, Building2, TrendingUp, Receipt, HandCoins, BookOpen } from 'lucide-react'
import { GradientCircle } from '@/components/auth/GradientCircle'
import { useSession } from '@/hooks/useSession'
import logo2Url from '@/assets/LOGO2.png'
import mct2Url from '@/assets/MCT2.png'
import v1Url from '@/assets/v1.png'
import v2Url from '@/assets/v2.png'
import v3Url from '@/assets/v3.png'
import mctBuildingClean from '@/assets/mct_building_clean.jpg'
import mctBuildingFacade from '@/assets/mct_building_facade.jpg'
import mctHotelBuilding from '@/assets/mct_hotel_building.jpg'
import mctCorporateOffice from '@/assets/mct_corporate_office.jpg'

type NavSection = 'hero' | 'features' | 'companies'

interface FeatureCardItem {
  id: string
  title: string
  description: string
}

const FEATURE_CARDS: FeatureCardItem[] = [
  {
    id: 'centralized-financial',
    title: 'Centralized Financial Management',
    description:
      'Consolidates financial oversight across all MCT subsidiaries into a unified executive dashboard in real-time.',
  },
  {
    id: 'sales-management',
    title: 'Sales Management',
    description:
      'Tracks revenue inflows, customer deposits, and billings/collections across diverse multi-industry business units.',
  },
  {
    id: 'expense-management',
    title: 'Expense Management',
    description:
      'Streamlines operational outflow tracking by categorizing departmental and entity-level expenditures.',
  },
  {
    id: 'inter-company-loans',
    title: 'Inter-Company Loans',
    description:
      'Facilitates internal financing between subsidiaries with dedicated borrower and lender perspectives. ',
  },
  {
    id: 'transaction-ledger',
    title: 'Transaction Ledger',
    description:
      'Archives sales, expenses, and loan records into an upright, comprehensive multi-lingual ledger.',
  },
]

// Icons are matched by card order. Reorder if your FEATURE_CARDS order differs.
const FEATURE_ICONS = [Building2, TrendingUp, Receipt, HandCoins, BookOpen]

interface CarouselCompany {
  id: string
  name: string
  tag: string
  image: string
}

const CAROUSEL_COMPANIES: CarouselCompany[] = [
  {
    id: 'foundation',
    name: 'MC. Tolentino College Foundation, Inc.',
    tag: 'Education & Foundation',
    image: mctBuildingClean,
  },
  {
    id: 'hospitality',
    name: 'MCTolentino Hospitality Business Corp.',
    tag: 'Hospitality & Leisure',
    image: mctBuildingClean,
  },
  {
    id: 'property',
    name: 'JK Property Ventures Corp.',
    tag: 'Real Estate & Development',
    image: mctCorporateOffice,
  },
  {
    id: 'construction',
    name: 'Speedfire Construction & Trading Corp.',
    tag: 'Construction & Engineering',
    image: mctBuildingClean,
  },
  {
    id: 'kitchen',
    name: 'MYCity. Kitchen. Corp.',
    tag: 'Food & Beverage',
    image: mctBuildingFacade,
  },
  {
    id: 'medsys',
    name: 'MedSys Uni Horizon Pharma Corp.',
    tag: 'Healthcare & Pharma',
    image: mctHotelBuilding,
  },
]

const ASSOCIATED_COMPANIES_COLUMNS = [
  [
    'JK Property Ventures Corp.',
    'MCTolentino Hospitality Business Corp.',
    'MYCity. Kitchen. Corp.',
    'MedSys Uni Horizon Pharma Corp.',
  ],
  [
    'Speedfire Construction & Trading Corp.',
    'Far East Asia Trading Corp.',
    'MC. Tolentino College Foundation, Inc.',
    'Bagong Bansa May Pagasa Movement, Inc.',
  ],
  [
    'JK Global Headways Business Solutions Corp.',
    'Bookworld Systems Solutions & Technologies Corp.',
    'Filcam Prime Holdings Corp.',
    'Golden Jupiter Property Ventures Corp.',
  ],
]

export const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useSession()
  const [activeNav, setActiveNav] = React.useState<NavSection>('hero')
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const [isCarouselPaused, setIsCarouselPaused] = React.useState(false)
  const [featuresInView, setFeaturesInView] = React.useState(false)

  const [mouseOffset, setMouseOffset] = React.useState({ x: 0, y: 0 })
  const heroRef = React.useRef<HTMLElement>(null)
  const featuresRef = React.useRef<HTMLElement>(null)
  const carouselTrackRef = React.useRef<HTMLDivElement>(null)

  // Document title
  React.useEffect(() => {
    document.title = 'MCT Group of Companies - Centralized Financial Management System'
  }, [])

  // Dynamic active section spy on scroll
  React.useEffect(() => {
    const sections: NavSection[] = ['hero', 'features', 'companies']
    const handleScroll = () => {
      const scrollPos = window.scrollY + 160
      for (let i = sections.length - 1; i >= 0; i--) {
        const el = document.getElementById(sections[i])
        if (el && el.offsetTop <= scrollPos) {
          setActiveNav(sections[i])
          break
        }
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // IntersectionObserver for features animation
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setFeaturesInView(true)
        }
      },
      { threshold: 0.15 }
    )

    if (featuresRef.current) {
      observer.observe(featuresRef.current)
    }

    return () => observer.disconnect()
  }, [])

  const handleHeroMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!heroRef.current) return
    const rect = heroRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2
    setMouseOffset({ x, y })
  }

  const handleHeroMouseLeave = () => {
    setMouseOffset({ x: 0, y: 0 })
  }

  const handleScrollTo = (id: NavSection) => {
    setActiveNav(id)
    setMobileMenuOpen(false)
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleAuthAction = () => {
    if (user) {
      const role = (user.role || '').toLowerCase()
      if (role === 'admin') {
        navigate('/employee')
        return
      }
      const isAuditOrFinance = role === 'finance' || role === 'audit' || role.includes('audit') || role === 'owner'
      const namesCount = Array.isArray(user.companyNames) ? user.companyNames.filter(Boolean).length : 0
      const idsCount = Array.isArray(user.companyIds) ? user.companyIds.filter(Boolean).length : 0
      const assignedList = Array.isArray(user.assignedCompanies) ? user.assignedCompanies.filter(Boolean).length : 0
      let commaCount = 0
      if (user.assignedCompany && user.assignedCompany !== 'All Companies') {
        commaCount = user.assignedCompany.split(',').map((c) => c.trim()).filter(Boolean).length
      }
      const count = Math.max(namesCount, idsCount, assignedList, commaCount)
      const canChooseCompany = isAuditOrFinance || (role === 'supervisor' && count >= 2)
      navigate(canChooseCompany ? '/centralized-auth' : '/dashboard')
    } else {
      navigate('/login')
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans select-none overflow-x-hidden">
      {/* 1. Header Navigation: Permanently fixed on top with active state underline */}
      <header className="fixed top-0 left-0 right-0 w-full z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-2xs transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Logo Lockup using LOGO2.png & MCT2.png (Left) */}
          <button
            type="button"
            onClick={() => handleScrollTo('hero')}
            className="flex items-center gap-2 sm:gap-3 cursor-pointer group text-left"
            title="MCT Group of Companies"
          >
            <img
              src={logo2Url}
              alt="MCT Logo"
              className="h-8 sm:h-10 md:h-11 w-auto object-contain shrink-0 group-hover:scale-105 transition-transform"
            />
            <div className="flex flex-col justify-center items-start">
              <img
                src={mct2Url}
                alt="MCT"
                className="h-3.5 sm:h-4 md:h-5 max-h-[16px] sm:max-h-[20px] w-auto object-contain object-left block"
              />
              <span className="text-[9px] sm:text-[10px] font-semibold text-muted-fg tracking-tight leading-tight mt-0.5 whitespace-nowrap">
                Group of Companies
              </span>
            </div>
          </button>

          {/* Desktop Navigation Links moved to the RIGHT alongside Login */}
          <div className="hidden md:flex items-center gap-8">
            <nav className="flex items-center gap-7 text-sm font-semibold">
              {/* Home Link */}
              <button
                type="button"
                onClick={() => handleScrollTo('hero')}
                className={`relative transition-colors cursor-pointer py-1 ${activeNav === 'hero'
                  ? 'text-[#960C01] font-bold'
                  : 'text-slate-700 hover:text-[#960C01] font-semibold'
                  }`}
              >
                Home
                {activeNav === 'hero' && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#960C01] rounded-full transition-all duration-300" />
                )}
              </button>

              {/* Features Link */}
              <button
                type="button"
                onClick={() => handleScrollTo('features')}
                className={`relative transition-colors cursor-pointer py-1 ${activeNav === 'features'
                  ? 'text-[#960C01] font-bold'
                  : 'text-slate-700 hover:text-[#960C01] font-semibold'
                  }`}
              >
                Features
                {activeNav === 'features' && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#960C01] rounded-full transition-all duration-300" />
                )}
              </button>

              {/* MCT Companies Link */}
              <button
                type="button"
                onClick={() => handleScrollTo('companies')}
                className={`relative transition-colors cursor-pointer py-1 ${activeNav === 'companies'
                  ? 'text-[#960C01] font-bold'
                  : 'text-slate-700 hover:text-[#960C01] font-semibold'
                  }`}
              >
                MCT Companies
                {activeNav === 'companies' && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-[#960C01] rounded-full transition-all duration-300" />
                )}
              </button>
            </nav>

            {/* Right Action: Login -> Button with radius 15 */}
            <button
              type="button"
              onClick={handleAuthAction}
              className="inline-flex items-center gap-1.5 h-9 px-5 rounded-[15px] bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs sm:text-sm font-bold shadow-xs hover:shadow-md transition-all cursor-pointer"
            >
              <span>{user ? 'Dashboard' : 'Login'}</span>
              <span className="text-sm font-bold leading-none">→</span>
            </button>
          </div>

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-xl text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 px-6 py-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-150 shadow-lg">
            <button
              type="button"
              onClick={() => handleScrollTo('hero')}
              className={`w-full text-left py-2 font-bold ${activeNav === 'hero' ? 'text-[#960C01]' : 'text-slate-700'
                }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => handleScrollTo('features')}
              className={`w-full text-left py-2 font-bold ${activeNav === 'features' ? 'text-[#960C01]' : 'text-slate-700'
                }`}
            >
              Features
            </button>
            <button
              type="button"
              onClick={() => handleScrollTo('companies')}
              className={`w-full text-left py-2 font-bold ${activeNav === 'companies' ? 'text-[#960C01]' : 'text-slate-700'
                }`}
            >
              MCT Companies
            </button>
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleAuthAction}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[15px] bg-[#960C01] text-white font-bold text-sm shadow-xs"
              >
                <span>{user ? 'Go to Dashboard' : 'Login'}</span>
                <span className="text-sm font-bold leading-none">→</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 2. Hero Section */}
      <section
        ref={heroRef}
        id="hero"
        onMouseMove={handleHeroMouseMove}
        onMouseLeave={handleHeroMouseLeave}
        className="relative overflow-hidden bg-white flex items-center pt-28 sm:pt-32 pb-16 sm:pb-24 scroll-mt-20 min-h-[580px] lg:min-h-[700px]"
      >
        {/* Sphere 1: small, top-left, kept away from the headline */}
        <div
          className="absolute -top-10 -left-16 w-36 sm:w-44 lg:w-48 aspect-square pointer-events-none z-0 transition-transform duration-700 ease-out will-change-transform"
          style={{ transform: `translate3d(${mouseOffset.x * 20}px, ${mouseOffset.y * 20}px, 0)` }}
        >
          <GradientCircle variant="1" hasShadow={false} className="w-full h-full opacity-80" />
        </div>

        {/* Sphere 2: large, bottom-right, sits BEHIND the dashboard */}
        <div
          className="absolute -bottom-32 -right-24 lg:-right-10 w-[320px] sm:w-[420px] lg:w-[520px] aspect-square pointer-events-none z-0 transition-transform duration-1000 ease-out will-change-transform"
          style={{ transform: `translate3d(${mouseOffset.x * -24}px, ${mouseOffset.y * -16}px, 0)` }}
        >
          <GradientCircle variant="2" hasShadow={false} className="w-full h-full opacity-90" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          {/* LEFT: copy */}
          <div className="text-left">
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[62px] font-black text-[#960C01] leading-[1.12] tracking-tight">
              One Vision.
              <br />
              Diverse Ventures.
              <br />
              Shared Success.
            </h1>

            <p className="text-base sm:text-lg text-slate-700 font-medium mt-5 leading-relaxed max-w-md">
              One place to track sales, expenses and loans across all MCT companies.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAuthAction}
                className="inline-flex items-center justify-center px-8 py-3.5 rounded-[15px] bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-base font-bold shadow-lg shadow-[#960C01]/25 hover:shadow-xl transition-all cursor-pointer"
              >
                Get Started
              </button>
              <a
                href="#companies"
                className="inline-flex items-center justify-center px-8 py-3.5 rounded-[15px] border-2 border-[#960C01]/30 text-[#960C01] text-base font-bold hover:bg-red-50 hover:border-[#960C01]/60 transition-all"
              >
                View Companies
              </a>
            </div>
          </div>

          {/* RIGHT: dashboard mockup with the icons as orbiting badges */}
          <div
            className="relative mx-auto w-full max-w-md lg:max-w-none transition-transform duration-500 ease-out will-change-transform"
            style={{ transform: `translate3d(${mouseOffset.x * -10}px, ${mouseOffset.y * -10}px, 0)` }}
          >
            {/* Icon badges (v1, v2, v3) */}
            <div className="absolute -top-6 -left-4 z-20 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-white shadow-xl ring-1 ring-black/5 animate-bounce [animation-duration:4s]">
              <img src={v3Url} alt="Growth Metrics" className="h-8 w-8 sm:h-9 sm:w-9 object-contain" />
            </div>
            <div className="absolute top-1/2 -right-4 sm:-right-6 z-20 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-white shadow-xl ring-1 ring-black/5 animate-bounce [animation-duration:5s]">
              <img src={v2Url} alt="Hand Holding Coin" className="h-8 w-8 sm:h-9 sm:w-9 object-contain" />
            </div>
            <div className="absolute -bottom-6 left-8 z-20 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-white shadow-xl ring-1 ring-black/5 animate-bounce [animation-duration:4.5s]">
              <img src={v1Url} alt="Currency Cycle" className="h-8 w-8 sm:h-9 sm:w-9 object-contain" />
            </div>

            {/* Dashboard card */}
            <div className="relative rounded-3xl bg-white/90 backdrop-blur p-5 sm:p-6 shadow-2xl shadow-[#960C01]/20 ring-1 ring-black/5">
              {/* Window dots + title */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#960C01]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                </div>
                <span className="text-xs font-semibold text-slate-500">Group Overview</span>
              </div>

              {/* Stat tiles (placeholder numbers) */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { label: "Sales", value: "₱2.4M", tone: "text-emerald-600" },
                  { label: "Expenses", value: "₱1.1M", tone: "text-[#960C01]" },
                  { label: "Loans", value: "₱640K", tone: "text-slate-700" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[11px] font-medium text-slate-500">{s.label}</p>
                    <p className={`mt-1 text-base sm:text-lg font-extrabold ${s.tone}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Mini bar chart */}
              <div className="mt-5 rounded-xl bg-slate-50 p-4">
                <p className="text-[11px] font-medium text-slate-500">Monthly revenue</p>
                <div className="mt-3 flex h-28 items-end gap-2">
                  {[40, 55, 45, 70, 60, 85, 75].map((h, i) => (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className={`flex-1 rounded-t-md ${i === 5 ? "bg-[#960C01]" : "bg-[#960C01]/25"
                        }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Features Section */}
      <section
        ref={featuresRef}
        id="features"
        className="relative bg-gradient-to-br from-[#7a0901] via-[#960C01] to-[#b31208] text-white py-16 sm:py-24 px-4 sm:px-6 lg:px-8 overflow-hidden scroll-mt-20"
      >
        {/* Ambient orbs */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none animate-pulse"
          style={{ animationDuration: "6s" }}
        />
        <div
          className="absolute -bottom-24 -left-24 w-96 h-96 bg-black/20 rounded-full blur-3xl pointer-events-none animate-pulse"
          style={{ animationDuration: "8s" }}
        />

        {/* Subtle dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(#fff 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="max-w-7xl mx-auto relative z-10">
          {/* Header */}
          <div
            className={`text-center max-w-3xl mx-auto transition-all duration-700 ease-out ${featuresInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
          >
            <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-widest uppercase">
              Features
            </h2>
            <div className="mx-auto mt-3 h-1 w-12 rounded-full bg-white/70" />
            <p className="text-white/85 text-xs sm:text-sm md:text-base font-normal mt-4 leading-relaxed">
              A unified financial command center designed for the MCT Group of Companies,
              consolidating multi-entity revenue, operational disbursements, and inter-company
              lending into a single, audit-ready platform.
            </p>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-5 mt-10 sm:mt-14">
            {FEATURE_CARDS.map((card, idx) => {
              const Icon = FEATURE_ICONS[idx % FEATURE_ICONS.length];

              return (
                /* Outer wrapper handles the staggered entrance only */
                <div
                  key={card.id}
                  style={{ transitionDelay: featuresInView ? `${idx * 110}ms` : "0ms" }}
                  className={`transition-all duration-700 ease-out ${featuresInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
                    }`}
                >
                  {/* Inner card handles hover, so the stagger delay doesn't slow it down */}
                  <div className="group relative h-full overflow-hidden rounded-2xl bg-white text-slate-800 p-5 sm:p-6 shadow-xl border border-white/40 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-black/40">
                    {/* Top accent bar */}
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#960C01] to-red-400 origin-left scale-x-30 group-hover:scale-x-100 transition-transform duration-500" />

                    {/* Faint step number */}
                    <span className="absolute right-4 top-3 text-5xl font-black text-slate-100 select-none transition-colors duration-300 group-hover:text-red-100">
                      {String(idx + 1).padStart(2, "0")}
                    </span>

                    {/* Icon badge */}
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-[#960C01] transition-all duration-300 group-hover:bg-[#960C01] group-hover:text-white group-hover:rotate-3 group-hover:scale-105">
                      <Icon className="h-6 w-6" strokeWidth={2} />
                    </div>

                    {/* Title */}
                    <h3 className="relative mt-5 text-sm sm:text-base font-extrabold text-[#960C01] leading-snug tracking-tight">
                      {card.title}
                    </h3>

                    {/* Description */}
                    <p className="relative mt-3 text-xs sm:text-[13px] text-slate-600 leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. One Name, Many Companies */}
      <section
        id="companies"
        className="relative bg-white flex flex-col pt-12 sm:pt-16 pb-6 sm:pb-8 overflow-hidden scroll-mt-20"
      >
        {/* Heading */}
        <div className="max-w-4xl mx-auto text-center px-4 mb-2 sm:mb-4 shrink-0">
          <span className="text-xs sm:text-sm font-semibold text-slate-800 tracking-wide block">
            One Name, Many Companies
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#960C01] mt-1 tracking-tight">
            Built on Trust and Service
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-2 max-w-3xl mx-auto leading-relaxed">
            Explore the companies under the{" "}
            <strong className="text-slate-800 font-semibold">MCT Group</strong>, each
            committed to delivering dependable service, together.
          </p>
        </div>

        {/* Curved carousel */}
        <div
          className="relative w-full overflow-hidden bg-white group"
          onMouseEnter={() => setIsCarouselPaused(true)}
          onMouseLeave={() => setIsCarouselPaused(false)}
        >
          {/* Top curve */}
          <div className="absolute top-0 left-0 right-0 w-full overflow-hidden leading-none z-20 pointer-events-none">
            <svg
              className="relative block w-full h-10 sm:h-14 md:h-20 text-white fill-current"
              viewBox="0 0 1440 90"
              preserveAspectRatio="none"
            >
              <path d="M 0,0 L 1440,0 L 1440,25 Q 720,90 0,25 Z" />
            </svg>
          </div>

          {/* Bottom curve */}
          <div className="absolute bottom-0 left-0 right-0 w-full overflow-hidden leading-none z-20 pointer-events-none">
            <svg
              className="relative block w-full h-10 sm:h-14 md:h-20 text-white fill-current"
              viewBox="0 0 1440 90"
              preserveAspectRatio="none"
            >
              <path d="M 0,90 L 1440,90 L 1440,65 Q 720,0 0,65 Z" />
            </svg>
          </div>

          {/* Marquee track */}
          <div ref={carouselTrackRef} className="flex items-center overflow-x-hidden select-none">
            <div
              className="flex items-center gap-0 animate-marquee"
              style={{ animationPlayState: isCarouselPaused ? "paused" : "running" }}
            >
              {[...CAROUSEL_COMPANIES, ...CAROUSEL_COMPANIES, ...CAROUSEL_COMPANIES].map(
                (company, index) => (
                  <div
                    key={`${company.id}-${index}`}
                    className="relative w-[260px] sm:w-[340px] md:w-[400px] lg:w-[480px] h-[300px] sm:h-[360px] md:h-[400px] shrink-0 overflow-hidden group/item"
                  >
                    <img
                      src={company.image}
                      alt={company.name}
                      className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover/item:scale-[1.15]"
                    />

                    {/* Hover tint */}
                    <div className="absolute inset-0 bg-black/0 group-hover/item:bg-black/10 transition-colors duration-300 pointer-events-none" />

                    {/* Company label (sits above the bottom curve) */}
                    <div className="absolute inset-x-0 bottom-14 md:bottom-16 z-10 px-4 text-center pointer-events-none">
                      <span className="inline-block rounded-full bg-black/55 backdrop-blur-sm px-4 py-1.5 text-xs sm:text-sm font-semibold text-white">
                        {company.name}
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 5. Footer: Incorporating MCT Associated Companies with Company Logo and Copyright bar */}
      <footer className="bg-slate-50/90 border-t border-slate-200/80 pt-10 sm:pt-12 pb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header Row: Company Logo Lockup */}
          <div className="flex items-center mb-8">
            <button
              type="button"
              onClick={() => handleScrollTo('hero')}
              className="flex items-center gap-3 cursor-pointer group text-left"
              title="MCT Group of Companies"
            >
              <img
                src={logo2Url}
                alt="MCT Logo"
                className="h-8 sm:h-9 w-auto object-contain shrink-0 group-hover:scale-105 transition-transform"
              />
              <div className="flex flex-col justify-center items-start text-left">
                <img
                  src={mct2Url}
                  alt="MCT"
                  className="h-4 w-auto object-contain object-left block"
                />
                <span className="text-[9px] font-semibold text-muted-fg tracking-tight leading-tight mt-0.5 whitespace-nowrap">
                  Group of Companies
                </span>
              </div>
            </button>
          </div>

          {/* 3 Columns of Companies */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-8 text-xs sm:text-sm text-slate-600 pb-10 sm:pb-12">
            {ASSOCIATED_COMPANIES_COLUMNS.map((col, cIdx) => (
              <div key={cIdx} className="space-y-2.5">
                {col.map((companyName, idx) => (
                  <div
                    key={idx}
                    className="font-medium text-slate-700 hover:text-[#960C01] transition-colors cursor-default"
                  >
                    <span>{companyName}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Gray Copyright Bar matching media_1792028445138.png */}
        <div className="bg-slate-200/80 border-t border-slate-300/70 py-4 px-4 text-center">
          <p className="text-[11px] sm:text-xs text-slate-600 font-normal">
            &copy; 2026 MCT Group of Companies. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
