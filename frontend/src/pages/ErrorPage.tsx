import * as React from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { ErrorPage } from '@/components/common/ErrorPage'
import { ERROR_PAGE_CONFIGS } from '@/config/errorConfig'

export interface ErrorPageRouteProps {
  code?: number | string
}

const CLIENT_CODES = [400, 401, 403, 404, 429]
const SERVER_CODES = [408, 500, 502, 503, 504, 999]

/**
 * Route-level Error Page
 *
 * Supports URL parameter `/error/:code` and query string `/error?code=...`.
 * Includes an executive quick-switch test bar so reviewers and developers can preview
 * all status code layouts with a single click.
 */
export const ErrorPageRoute: React.FC<ErrorPageRouteProps> = ({ code: propCode }) => {
  const { code: paramCode } = useParams<{ code?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [showToolbar, setShowToolbar] = React.useState(true)

  const queryCode = searchParams.get('code')
  const resolvedCode = propCode || paramCode || queryCode || 404
  const numericCode = parseInt(String(resolvedCode), 10)

  return (
    <div className="relative">
      {/* Floating Interactive Test Toolbar (Only shown on /error test routes) */}
      <aside
        aria-label="Error UI Test Toolbar"
        className="fixed top-4 right-4 sm:right-6 sm:top-6 z-50 transition-all select-none print:hidden"
      >
        {showToolbar ? (
          <div className="flex flex-col gap-2 bg-[#0B0F2B]/90 text-white backdrop-blur-md px-3.5 py-3 rounded-2xl shadow-xl border border-white/15 text-xs max-w-sm">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1.5">
              <span className="font-bold text-white text-[11px] tracking-wide uppercase">
                OneUI Error Switcher
              </span>
              <button
                type="button"
                onClick={() => setShowToolbar(false)}
                className="text-slate-400 hover:text-white rounded-md px-1.5 py-0.5 hover:bg-white/10 transition-colors text-[11px]"
                title="Hide Toolbar"
              >
                Hide
              </button>
            </div>

            {/* Client (Code Variant) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase font-semibold text-slate-400 w-full">
                Client (Code variant):
              </span>
              {CLIENT_CODES.map((c) => {
                const isActive = numericCode === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => navigate(`/error/${c}`)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-primary text-white shadow-xs ring-1 ring-white/30 scale-105'
                        : 'bg-white/10 text-slate-200 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                )
              })}
            </div>

            {/* Server (Illustration Variant) */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-white/10">
              <span className="text-[10px] uppercase font-semibold text-slate-400 w-full">
                Server & Network (Illustration variant):
              </span>
              {SERVER_CODES.map((c) => {
                const isActive = numericCode === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => navigate(`/error/${c}`)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-primary text-white shadow-xs ring-1 ring-white/30 scale-105'
                        : 'bg-white/10 text-slate-200 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {c === 999 ? 'Unknown (Fallback)' : c}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowToolbar(true)}
            className="bg-[#0B0F2B]/85 hover:bg-[#0B0F2B] text-white backdrop-blur-md px-3.5 py-2 rounded-full shadow-lg border border-white/15 text-xs font-semibold cursor-pointer transition-all hover:scale-105"
          >
            Switch Code ({resolvedCode})
          </button>
        )}
      </aside>

      {/* Actual Error Page Component */}
      <ErrorPage code={resolvedCode} />
    </div>
  )
}

export { ErrorPage }
export { ERROR_PAGE_CONFIGS }
export default ErrorPageRoute
