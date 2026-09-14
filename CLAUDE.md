# Project Frontend Instructions

You are working on an existing production React (Next.js) application — a kindergarten CRM.

Primary goals:

1. Fully adapt the frontend for mobile and tablet.
2. Preserve and verify desktop layouts.
3. Audit desktop UX and improve real usability problems.
4. Preserve existing business logic and behavior.
5. Do not perform unrelated redesigns or architectural rewrites.

Use the project skills in `.claude/skills/` whenever relevant:

- `responsive-ui` for responsive implementation.
- `ux-audit` for usability and desktop UX decisions.
- `accessibility` for accessibility review.
- `browser-qa` for browser and viewport verification.

## Project context

Stack: Next.js 16 App Router, React 19, TypeScript, Drizzle + Postgres, NextAuth.
Pages live in `app/`, shared components in `components/`.

Styling: all presentation lives in the single stylesheet `app/globals.css`
(~600 lines) using semantic class names (`.shell`, `.panel`, `.children-table`).
Tailwind is imported but utility classes are **not** used in JSX — there is no
`sm:`/`md:`/`lg:` usage anywhere. Follow the existing convention: add or fix
rules in `app/globals.css`, do not introduce a parallel utility-class style.

Design tokens: colors, accents and status colors are CSS variables on `:root`
and `[data-theme="..."]`. Use the existing variables, never hardcoded hex.

Existing breakpoints (all `max-width`): 520, 720, 820, 900, 1050, 1100.
Reuse these before inventing new ones.

Verification: the dev server is the `dev` config in `.claude/launch.json`
(port 3100). Playwright is not installed — use the in-app Browser pane
(`preview_start`, `resize_window`, `read_console_messages`, screenshots) for
everything `browser-qa` asks for.

Commands: `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`.

## General rules

Before modifying a page:

1. Inspect its existing implementation.
2. Inspect shared components used by the page.
3. Understand the current design language.
4. Prefer systemic fixes over local CSS patches.

Preserve:

- APIs
- routing
- state management
- permissions
- business logic
- validation
- analytics
- existing workflows

Do not redesign functionality simply because a different design might look nicer.

Improve the existing product.

## Responsive workflow

Work approximately in this order:

1. App shell
2. Header/navigation/sidebar
3. Global layout primitives
4. Shared components
5. Forms
6. Tables and lists
7. Dialogs and overlays
8. Main pages
9. Edge states
10. Desktop UX review
11. Full responsive regression

## Engineering principles

Prefer:

- CSS Grid
- Flexbox
- intrinsic layouts
- minmax()
- clamp()
- max-width
- min-width: 0
- CSS media queries
- container queries when appropriate

Avoid:

- unnecessary JavaScript viewport detection
- excessive breakpoint hacks
- duplicated mobile/desktop business logic
- hardcoded absolute positioning
- unrelated refactoring

When the same issue appears multiple times, fix the shared primitive or component.

Always verify visual changes in the browser when browser tooling is available.
