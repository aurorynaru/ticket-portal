# 06 — Kage MCP integration and design-first agent workflow

**Official setup page:** https://kage.design/mcp-setup  
**Remote MCP endpoint:** `https://kage.design/mcp`  
**Checked:** 2026-10-13. Kage documents Streamable HTTP, no required API key/account, and design-reference tools. Live designs have **not** been retrieved for this implementation kit.

## OpenCode (recommended for a local LLM coding worker)

At project root, create or merge `opencode.json` (merge rather than overwriting existing MCP servers):

```json
{
  "mcp": {
    "kage": {
      "enabled": true,
      "type": "remote",
      "url": "https://kage.design/mcp"
    }
  }
}
```

Restart/reload OpenCode if necessary, and verify its MCP server/tool inventory. If there is a connection error, record it and diagnose rather than inventing a Kage design result.

## Other coding agent configurations (only use the one matching your environment)

**Claude Code:**

```bash
claude mcp add --transport http kage https://kage.design/mcp
```

**Codex CLI:**

```bash
codex mcp add kage --url https://kage.design/mcp
```

**Cursor** `.cursor/mcp.json`:

```json
{"mcpServers":{"kage":{"url":"https://kage.design/mcp"}}}
```

These are **Kage's official published examples**, not commands executed as part of this documentation package.

## Documented Kage tools and their intended usage

| MCP tool / prompt | Usage |
|---|---|
| `design_brief` | Ask for closest design precedents for a given screen and style |
| `search_designs` | Discover matching product screenshots |
| `get_design` | Retrieve a selected design's prompt, screenshot, extracted components |
| `get_component` | Inspect a specific component of a selected design |
| `list_taxonomy` | Inspect catalog categories/styles when uncertain |
| `design_like` (prompt) | Ask for visual structure inspired by references |

**Don't hardcode tool argument JSON** until your MCP client exposes the actual input schema. Record the tool name, input intention, returned slug/ID, design observations and screenshot evidence. Screenshots are inspiration, **not assets to copy**.

## UI design sequence — mandatory before Phase P3

1. Verify MCP connection; enumerate Kage tools.
2. Call `design_brief` for the overall app shell using this prompt:

   > Design a compact, accessible internal ticketing dashboard for 100 employees. Desktop-first but mobile usable. Inspiration: the clarity and density of Linear/Notion-style business apps, not their branding. Needs left navigation, responsive top bar, KPI summary, status filters, searchable ticket table, priorities, assignees, and readable activity timeline. Implementation uses server-rendered EJS, HTMX and Tailwind; no SPA.

3. Use `search_designs`, `get_design`, and `get_component` where helpful; select **two reference screens and 2–4 component references** based on actual Kage responses.
4. Call `design_brief` for these specific screens, using prompts below.
5. Create `design/STYLE_GUIDE.md` (an implementation-generated deliverable) documenting palette tokens, type scale, spacing, elevation, borders, breakpoints, empty/loading/error states, and accessibility.
6. Implement **one shell layout and one detail page**, compare visually at desktop (1440px) and mobile (390px), then refine before duplicating components.
7. Store design notes/screenshots or URLs under `checks/design/`; include provenance and implementation differences.

## Screen-specific prompts (use as natural language with documented MCP tools)

**Dashboard:** "A minimal enterprise helpdesk dashboard with four metric cards, assigned-work list, overdue indicator, search, dense tables, clear status/priority tokens, and high information hierarchy. Neutral modern design, accessible light theme, optional dark mode."

**Ticket list:** "An efficient support ticket list with quick filters, persistent search, status tabs, sortable columns, visible assignees, keyboard-friendly bulk-free interactions, mobile card fallback; aesthetically inspired by modern productivity tools, not copied."

**Ticket detail:** "A professional issue-tracker detail screen: ticket title and metadata, main issue body, activity timeline, issue/actions/resolution form, secure attachments and assignee controls; prioritize readable long-form notes."

**Create/edit/resolve:** "Concise accessible forms with clear labels, inline validation, mandatory structured resolution fields, cancel and confirm states, and mobile-first spacing."

**Admin & notifications:** "Clean internal users/roles management and notification center with simple tables and status markers; low visual noise."

## Adapt reference design to the specified stack

- Translate Kage output to reusable **EJS partials** and precompiled Tailwind utility classes.
- Avoid React/Next.js code or assumptions even if a retrieved reference came from a React product.
- No remote font dependency required; use system fonts unless licensing/download approved.
- Use SVG icons you authored or approved icon set; do not hotlink screenshot assets.
- Prefer good hierarchy and workflow speed to flashy visuals, animation or large background images.
- Capture keyboard focus, contrast, mobile reflow and long-title overflow states.

## Design acceptance

- [ ] Kage connected and tool response captured (or blocker clearly reported).
- [ ] Original screen design documented with actual returned references.
- [ ] Dashboard, list, detail, creation/resolution and admin pages reviewed.
- [ ] 1440px and 390px screenshots captured from local app.
- [ ] No copy of screenshot branding/text/logo; no runtime design MCP dependency.
- [ ] Interaction works with HTMX and with normal form submissions for critical actions.

If Kage is temporarily unreachable, **finish non-UI tasks** and record a `P3 blocked: design MCP unavailable` item rather than pretending references were used. Ask the owner before replacing Kage with another design source.
