# Style guide — Ticketing UI (Phase P3)

Design authority for all EJS views. Generated from Kage MCP references
(retrieved 2026-10-13) + `docs/07_UI_SPEC.md`. This file is the source of
truth for visual decisions; code must follow it.

## Kage provenance

Tools used (all succeeded): `kage_list_taxonomy`, `kage_design_brief`,
`kage_search_designs`, `kage_get_design`.

Reference screens (fetched via `kage_get_design`):

| Slug | Page | What we take from it |
|---|---|---|
| `lune-landing-page` | https://kage.design/designs/lune-landing-page | Light editorial system: off-white canvas `#fafaf8`, near-black ink `#171716`, cool-gray secondary `#777873`, hairline rules `#e4e5e1`, 1px borders, 8–12px radii, little/no shadow, quiet left-rail navigation, small-caps metadata, 12–15px body text, one near-black filled primary button. |
| `linear-landing-page` | https://kage.design/designs/linear-landing-page | App structure: compact left sidebar (Pulse/Inbox/My Issues), issue detail = key + title + status chip, hairline dividers, small-caps labels, dense readable tables, minimal color. |

Component references (from `lune-landing-page` components):
`lune-navigation` (left rail), `lune-table` (hairline row tables),
`lune-feature-grid` (bordered card grids), `lune-cta` (single dark action),
`lune-footer` (ruled multi-column footer).

Searches also surfaced `opensend-landing-page` (monochrome hairline grid)
and `zernio-landing-page` (light canvas, single accent, flat cards) as
corroborating references. No dashboard-category designs exist in the
library (taxonomy count 0), so app screens are composed from the
references above rather than copied from a dashboard reference.

Nothing from the references is copied: no logos, wordmarks, copy, imagery,
or icon sets. Only structural and token-level inspiration.

## Tokens (Tailwind v4 `@theme` in `src/styles/input.css`)

| Token | Value | Use |
|---|---|---|
| `--color-canvas` | `#fafaf9` | page background |
| `--color-surface` | `#ffffff` | cards, tables, sidebar |
| `--color-ink` | `#18181b` | primary text, primary buttons |
| `--color-ink-soft` | `#52525b` | secondary text |
| `--color-ink-faint` | `#a1a1aa` | metadata, placeholders |
| `--color-line` | `#e4e4e7` | hairline borders |
| `--color-line-soft` | `#f1f1f3` | row dividers, subtle fills |
| `--color-accent` | `#2563eb` | links, focus rings, active nav |
| `--color-accent-soft` | `#eff6ff` | active nav fill, info tints |

Status chips (kept from P2, text label always present):
OPEN `slate-100/slate-700`, ASSIGNED `sky-50/sky-700`,
IN_PROGRESS `indigo-50/indigo-700`, BLOCKED `amber-50/amber-700`,
RESOLVED `emerald-50/emerald-700`, CLOSED `slate-200/slate-600`.

## Type & spacing

- System UI sans; body 14px (`text-sm`), labels 12–13px, page titles
  20px semibold, section headings 12px uppercase tracked `ink-soft`.
- 8px spacing rhythm; content max width 1400px (`max-w-[1400px]`),
  forms max 640px.
- Ticket numbers, dates, counts: `tabular-nums`.

## App shell

- Desktop (≥1024px): fixed 240px left sidebar (brand, nav, user card +
  sign out at bottom), content offset `lg:pl-60`.
- Mobile (<1024px): sticky top bar (brand + menu button); sidebar becomes
  an off-canvas drawer with backdrop; Escape/backdrop closes it.
  Vanilla JS only (`public/assets/app.js`), no framework.
- Skip-to-content link first in DOM.
- One primary action per page: near-black filled button (`bg-ink
  text-white`), secondary = hairline outline, tertiary = text link.

## Components

- **Cards**: white surface, 1px `line` border, 8px radius, no shadow
  (except open dropdowns: `shadow-lg`).
- **Tables**: hairline dividers, 12px uppercase headers, 40px rows,
  hover `line-soft`; horizontal scroll wrapper on narrow screens.
- **Badges**: pill, 11px medium, status palette above.
- **Forms**: 13px labels medium, 1px `line` inputs 8px radius, focus =
  2px accent ring (visible `:focus-visible` everywhere).
- **Feedback**: `role=alert` banners (red-50/red-700 error,
  amber-50/amber-800 warning/conflict, emerald-50 success), empty states
  centered with one suggested action.
- **Ticket detail**: 2/3 main column (description, resolution, comments,
  activity) + 1/3 side rail (status, priority, assignee, dates, watcher);
  stacks to one column below 1024px.

## Constraints

- No new dependencies, no icon fonts, no images; inline SVG only if
  needed (none currently).
- All existing route contracts, form field names, labels used by tests,
  CSRF, and RBAC-gated visibility are preserved.
- Light mode only (per owner preference).