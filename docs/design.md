# DESIGN.md — MCT Financial Management System (Global Foundations)

Applies to **every screen**.


Stack: React + Tailwind + shadcn/ui. Font: Inter. Design frame: ~1920px wide desktop. Values below are frame pixels; implement in rem with responsive scaling.

Items marked **(proposed)** were not in the original brief and were inferred from the mockups. Confirm before treating as final.

---

## 1. Color Tokens

### Core (from brief)
| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#960C01` | Brand red: primary buttons, banners, headings accents, chart bars, active states |
| `background` | `#FFFFFF` | Cards, panels, sidebar, inputs |
| `focus` | `#0B0F2B` | Focused field border/ring |
| `error` | `#960C01` | Field error border + message |
| `disabled` | `#767B89` | Disabled primary button |
| `stroke` | `#979797` @ 50%, 0.5px | Default borders (inputs, checkbox) |

### Extended (proposed)
| Token | Value | Usage |
|-------|-------|-------|
| `surface` | ~`#F4F4F4` | App page background behind cards (dashboard) |
| `primary-tint` | `#960C01` @ ~20% | Inactive chart bars, subtle red fills, hover on red-outlined controls |
| `muted-fg` | `#767B89` | Secondary text, inactive nav items, axis labels |
| `chart-neutral` | `#979797` @ ~60% | Secondary donut segment, neutral series |
| `icon-tile` | gray ~`#E5E5E5` | Background tile behind KPI icons |
| `destructive` | **TBD** | A delete/danger action must be distinguishable from `primary`. Do not reuse `#960C01` for destructive buttons. Ask design for a value |
| `success` / `warning` | **TBD** | Needed for status badges (paid, pending, overdue) |

Rule: use only these tokens. No ad-hoc hex values in components.

## 2. Typography (Inter)

### Brief scale (large / marketing-style, used on auth)
| Role | Size | Notes |
|------|------|-------|
| Heading | 64 | Auth headings |
| Sub-heading | 48 | Reserved section sub-headings |
| Body | 20 | Auth body copy |
| Label | 16 | Inputs, buttons, links |

### App scale (proposed, estimated from the dashboard mockup)
| Role | Size | Weight | Used for |
|------|------|--------|----------|
| `page-title` | 40 | Bold | "Financial Overview" |
| `banner-title` | 40 | Semibold | Welcome banner greeting |
| `kpi-value` | 36 | Bold | ₱120,000 |
| `card-title` | 20 | Semibold | Chart/card titles |
| `body` | 20→16 | Regular | Descriptions, nav items |
| `caption` | 14 | Regular | Axis labels, legends, date ranges, nav sub-items |

- Numbers/currency: `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) everywhere amounts appear.
- Line-height: headings 1.1, body 1.4, labels 1.25.

## 3. Shape, Depth & Spacing
- **Radius: 15px** (`--radius`) for inputs, buttons, cards, banner, filter controls, chart containers.
- **Cards:** white, radius 15, soft shadow (proposed: `0 4px 16px rgb(0 0 0 / 0.08)`); no heavy borders.
- **Spacing:** 4px base grid; card gaps ≈ 24px; card inner padding ≈ 24px (proposed).
- Page max width: fluid; content region fills the area right of the sidebar.

## 4. Icons
- `lucide-react` only. Stroke style, consistent size (20px nav, 24px KPI tiles, 16px inline).
- Brand logo is an SVG asset (`/assets/mct-logo.svg`) in two variants: white (on red) and red (on white, with "Group of Companies" lockup).

## 5. Currency, Dates, Locale
- Currency: **Philippine peso (₱)**. Always format via `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`. Never hardcode "₱" strings or concatenate.
- Dates: long form in headers ("Monday, October 5, 2026"), via `Intl.DateTimeFormat('en-PH')`.
- Timezone: Asia/Manila.

## 6. Interactive States
### Fields
| State | Style |
|-------|-------|
| Default | 0.5px `stroke` @ 50%, white bg |
| Focused | `focus` border + ring |
| Error | `error` border, icon + message in `error` |
| Disabled | 50% opacity, `cursor-not-allowed` |

### Buttons
| Variant | Style |
|---------|-------|
| Primary | bg `primary`, white text, radius 15; hover `brightness-90`; focus-visible 2px `focus` ring |
| Primary disabled | bg `disabled`, white text |
| Outline-primary (proposed) | 1px `primary` border, `primary` text, white bg (company filter) |
| Outline-neutral (proposed) | 0.5px `stroke` border, dark text (date-range filter) |
| Loading | spinner + progressive text, non-interactive |

## 7. Data Visualization (shadcn Chart / Recharts)
- Series color: `primary`. Inactive/secondary bars: `primary-tint`. Secondary categories: `chart-neutral`.
- Do not rely on color alone: legends, tooltips and accessible labels required.
- Chart containers sit inside cards (radius 15). Axis text uses `caption` + `muted-fg`; light gridlines or none.
- Always provide a tooltip with formatted currency.

## 8. Accessibility
- Every input has an associated label (visible or `sr-only`).
- Errors via `aria-invalid` + `aria-describedby`.
- White-on-`primary` meets AA; keep it so. Muted text must stay AA on its background.
- Visible focus states everywhere; full keyboard operation.
- Decorative graphics `aria-hidden`; charts need a text/table alternative.

## 9. Responsive
- `lg+`: full desktop layouts per screen file.
- Below `lg`: sidebar becomes a drawer (shadcn `Sheet`), grids collapse to a single column, filters wrap.
- Use `clamp()` so the 1920-frame type sizes scale down.

## 10. Open Questions
1. `destructive`, `success`, `warning` colors.
2. Exact `surface` gray, shadow, and padding values (measure from the Figma file).
3. App type scale in section 2 is estimated; confirm in Figma.
4. Legend naming inconsistencies between screens (see `screens/dashboard.md`).
