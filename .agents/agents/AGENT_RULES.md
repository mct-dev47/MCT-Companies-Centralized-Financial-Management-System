# AGENT_RULES.md — MCT Financial Management System (Frontend)

You are a senior React engineer building the MCT Financial Management System UI.

**Before writing code, read:**
1. `DESIGN.md` — global tokens, type, states, accessibility (always)
2. `screens/<screen>.md` — the spec for the screen you are working on

If these rules and the design docs conflict, ask instead of guessing. Items marked "proposed" or listed under "Open Questions" are not final: follow the stated assumption and flag it in your summary.

## 1. Stack
- React 18+ with TypeScript (strict), Tailwind CSS, **shadcn/ui** (Button, Input, Label, Checkbox, Form, Select, Sidebar, Sheet, Card, Skeleton, Chart).
- Forms: `react-hook-form` + `zod` (`@hookform/resolvers/zod`).
- Charts: shadcn `Chart` (Recharts). No other chart library without asking.
- **Plain React SPA (Vite). Not Next.js.** No `next/*` imports, no server components, no `"use client"` directives, no SSR/API routes.
- Routing: `react-router-dom`. Server state: TanStack Query.
- shadcn setup for Vite: configure the `@/*` path alias in both `tsconfig.json` and `vite.config.ts`, then use the shadcn CLI.
- Env vars: `import.meta.env.VITE_*` only. They are public in the bundle, so never put secrets in them.
- Icons: `lucide-react` only.
- Font: **Inter** via `@fontsource-variable/inter`, imported once in `main.tsx`.

## 2. Design Tokens (never hardcode in components)
Define once in `globals.css` and the Tailwind config; consume via classes.

```css
:root {
  --primary: #960C01;
  --background: #FFFFFF;
  --focus: #0B0F2B;
  --error: #960C01;
  --disabled: #767B89;
  --stroke: #979797;
  --surface: #F4F4F4;        /* proposed */
  --primary-tint: rgb(150 12 1 / 0.2); /* proposed */
  --radius: 15px;
}
```

- Only palette colors from `DESIGN.md`. No ad-hoc hex values in JSX.
- Radius is 15px for inputs, buttons, cards, banners, and chart containers.
- Default borders: `border-[0.5px] border-stroke/50`.
- Type roles are Tailwind `fontSize` extensions (`heading`, `subheading`, `body`, `label`, `page-title`, `kpi-value`, `card-title`, `caption`). Scale with `clamp()`.
- Do not use `#960C01` for destructive actions. Wait for a `destructive` token.

## 3. shadcn Rules
- Customize through variants and `className` inside the component files under `components/ui`. Do not scatter inline overrides at call sites.
- Build and reuse shared pieces: `IconInput`, `PasswordInput`, `StatCard`, `ChartCard`, `FilterSelect`, `PageHeader`.
- Use shadcn `Form` / `FormField` / `FormMessage` for forms so `aria-*` wiring is automatic.
- Use shadcn `Sidebar` for the app shell nav.

## 4. Project Structure
```
src/
  components/
    ui/                 # shadcn generated
    layout/             # AppShell, AppSidebar, WelcomeBanner, PageHeader
    auth/               # AuthLayout, BrandPanel, GradientCircle, SignInForm, CompanyLinks
    dashboard/          # StatCard, SalesTrendChart, ExpenseDonut, LoanChart, DashboardFilters
  pages/                # route components (LoginPage, DashboardPage)
  routes.tsx            # react-router route table + auth guard
  services/             # authService, dashboardService (mock until API exists)
  hooks/                # useDashboardOverview, useSession
  lib/
    format.ts           # formatPHP, formatDate
    validation/         # zod schemas
  assets/mct-logo*.svg
docs: DESIGN.md, AGENT_RULES.md, screens/*.md
```
- One component per file, named exports, PascalCase. Keep components under ~150 lines.
- Constants (company list, nav items) live in typed constant files, not inline JSX.

## 5. Money, Dates, Data (critical for a financial app)
- Format all currency with `formatPHP()` built on `Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' })`. Never hardcode "₱" or concatenate.
- Never use floating-point arithmetic for money. Use integer centavos or a decimal library; format only at the edge.
- Apply `tabular-nums` to every amount.
- Dates via `Intl.DateTimeFormat`, timezone `Asia/Manila`.
- Dashboard data is keyed by `{ companyId, dateRange }`; all widgets react to the filters.
- Every data widget must implement loading (skeleton), empty, and error (with retry) states.
- User name, role, and company list come from the session/API, never hardcoded.

## 6. Auth & Security
- All auth calls go through `authService`; no `fetch` inside components.
- Never log or persist passwords. No tokens in `localStorage`; assume httpOnly cookies unless told otherwise.
- Generic credential error: "Invalid email or password."
- Protect dashboard routes with a session guard; redirect to `/login` when unauthenticated.
- Hiding nav items by role is UX only; assume the server enforces authorization.
- No secrets or hardcoded API URLs; use `VITE_` env vars for non-secret config only.

## 7. Accessibility (non-negotiable)
- Labels on every input and select (`sr-only` allowed).
- `aria-invalid` + `aria-describedby` for errors; decorative graphics `aria-hidden`.
- Charts: `role="img"` + descriptive `aria-label` and a text/table alternative.
- Visible focus rings (`focus` color), full keyboard support, landmarks (`nav`, `main`, `header`).
- Color is never the only signal.

## 8. Code Quality
- No `any`, no unused code, no commented-out blocks, no magic numbers or hex in JSX.
- No new dependencies without asking.
- Prefer Tailwind utilities; inline `style` only for computed values (e.g. gradient geometry).
- Run `tsc --noEmit` and lint before declaring work done.

## 9. Responsive
- `lg+`: desktop layouts per screen file. Below `lg`: sidebar becomes a `Sheet` drawer, grids collapse to a single column.
- Test at 375, 768, 1280, 1920.

## 10. Workflow
1. Restate the task in 2-3 lines and name the spec files you read.
2. List files you will create or change.
3. Implement in small, focused diffs; reuse shared components before creating new ones.
4. Summarize what was done, any deviation from the specs, and any Open Question assumption you relied on.

## 11. Do Not
- Invent screens, copy, colors, or features not in the specs.
- Change specified copy (e.g. "One Vision. Diverse Ventures. Shared Success.").
- Disable browser autofill or skip `autocomplete` attributes.
- Hardcode mock numbers in components; mocks belong in `services/`.
- Build features for screens that don't have a spec yet (Sales, Expense, Loan, Employee pages, 2FA). Stub the route and stop.