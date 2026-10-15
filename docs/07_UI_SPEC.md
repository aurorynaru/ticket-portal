# 07 — Pages, design system, and accessibility

## Visual character

A fast, calm, information-dense internal business tool. Use Kage MCP references from `06_KAGE_MCP_DESIGN.md` to set concrete tokens **before** the final visual pass. Initial placeholders below are only guidance; the generated STYLE_GUIDE after MCP calls becomes the design authority.

- Neutral background/surfaces, one accent color, status colors with **text labels** (do not communicate only by color).
- Font: system UI; body ~14–16px, minimum readable labels; headers and section titles with restrained hierarchy.
- Content max width ~1400px for tables, responsive cards for narrow screens, 8px spacing rhythm.
- Sticky sidebar on desktop, collapsible navigation on mobile; one primary Create Ticket action.
- Avoid heavy JS frameworks, client-generated table state and over-animated interactions.

## Required screen inventory

| Screen | Required elements | Primary success action |
|---|---|---|
| Login | email/password, forgot password, errors, safe redirects | session established |
| Dashboard | open/in-progress/overdue/resolved counts; assigned list, quick action | open useful ticket |
| All tickets | text search, status, priority, team, assignee, sort, paging | find/triage ticket |
| My created | tickets created by current user | follow work assigned out |
| Assigned to me | tickets currently assigned to current user | update work |
| Create ticket | title, description, type, category, team, priority, assignee, due date | create/assign |
| Ticket detail | issue body, metadata, timeline, activity, comments, attachments, action controls | work/resolve/close |
| Resolve dialog/page | issue summary, actions taken, resolution, optional root cause | resolve valid ticket |
| Notifications | unread/all tabs, ticket links, mark read | act on assignments |
| Reports | ticket counts and basic time-based metrics | inspect operational backlog |
| Admin users | account list, provision/deactivate, role changes, team mapping | manage access |
| Admin teams/categories | names, membership and categories | configure taxonomy |
| Errors/empty states | 401/403/404/409/422/500, no data, offline/deploy | recover without confusion |

## Ticket detail layout

Desktop: main column (~2/3) for description, work notes, comments, attachments, resolution history; side rail (~1/3) for assignment, status, priority, creator, team, dates, watcher controls. Mobile: one column with details stacked below title and actions.

Show a **clearly separated issue/actions/resolution section** when resolved/closed. For unresolved tickets, show "Add resolution" action only to authorized assignee/manager/admin. A creator sees "Close ticket" only after RESOLVED; server independently validates.

## Reusable partials

`layout`, `sidebar`, `topbar`, `ticket-table`, `ticket-row`, `ticket-status-badge`, `priority-badge`, `assignee-picker`, `timeline-event`, `comment`, `attachment-row`, `resolve-form`, `confirmation`, `pagination`, `filter-bar`, `toast`, `empty-state`, `error-summary`, `notification-badge`.

## Accessibility specification

- Semantic landmarks (`main`, `nav`, headings in order), explicit form labels, focus indicators, working keyboard navigation.
- Error summary linked to invalid fields, `aria-describedby`, `role=alert` for actionable errors.
- Dialogs return focus when dismissed; support Escape without losing unsaved text.
- HTMX updates use intentional `aria-live` announcements and focus management; avoid silent updates.
- Tables with table headers, responsive overflow, mobile card/list alternative where necessary.
- User content escaped, URLs and filenames rendered safely, no raw HTML in comments by default.
- WCAG AA contrast for text and controls targeted, including dark status chips if implemented.

## Design evidence checklist

Create screen captures in the implementation repository for dashboard, list, detail, create, resolve, mobile view, empty/error states, with browser dimensions recorded. Keep Kage provenance separately from your actual app screenshot. No visual QA pass means no P3 completion.
