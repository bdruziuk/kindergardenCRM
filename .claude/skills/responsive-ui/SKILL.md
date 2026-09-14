---
name: responsive-ui
description: Use when implementing or fixing responsive React UI for mobile, tablet, desktop, layouts, grids, forms, tables, navigation, dialogs, overflow, typography, spacing, or viewport-specific behavior.
---

# Responsive UI Skill

Act as a senior frontend engineer specializing in responsive application design.

The objective is not merely to make desktop layouts narrower.

Adapt layout, hierarchy, interaction and density intentionally for different viewport sizes.

## Required viewport coverage

Verify representative widths around:

- 320px
- 360px
- 390px
- 430px
- 768px
- 834px
- 1024px
- 1280px
- 1440px
- 1920px

Do not optimize only for exact breakpoint values.

Layouts must behave continuously between breakpoints.

## Mobile

On mobile:

- no unintended horizontal scrolling
- content must remain readable
- primary actions must remain accessible
- controls must be touch-friendly
- navigation must remain usable
- forms should usually become one column
- dialogs must fit the viewport
- dropdowns/popovers must stay inside the viewport
- important functionality must not simply disappear
- long text must wrap correctly
- fixed elements must not cover important content

Pay special attention to:

- `min-width`
- flex children refusing to shrink
- long words/URLs
- tables
- charts
- buttons with long labels
- breadcrumbs
- tab bars
- fixed widths
- absolutely positioned content

## Tablet

Treat tablets as their own layout class.

Review specifically:

- 768px
- 834px
- 1024px

Check both portrait and landscape behavior.

Do not assume a desktop layout will work merely because it technically fits.

Review:

- sidebars
- navigation
- dashboards
- card grids
- tables
- forms
- dialogs
- header actions

## Desktop

Responsive fixes must not degrade desktop.

After mobile/tablet changes, verify desktop again.

Check at least:

- 1280px
- 1440px
- 1920px

Look for:

- excessive content width
- stretched forms
- overly long text lines
- bad whitespace
- alignment regressions
- unexpectedly large gaps

## Layout implementation

Prefer:

- CSS Grid
- Flexbox
- `minmax()`
- `auto-fit`
- `auto-fill`
- `clamp()`
- `max-width`
- intrinsic sizing
- `min-width: 0`

Prefer CSS for presentation differences.

Use JavaScript viewport detection only if application behavior genuinely depends on viewport state.

## Breakpoints

Do not add a breakpoint for every individual component problem.

Use existing project breakpoints where practical.

Prefer content-driven breakpoints.

If the design breaks at 870px, solve the actual layout problem rather than blindly forcing a conventional breakpoint.

## Typography

Check:

- font size
- line height
- heading wrapping
- line length
- truncation
- button labels
- form labels

Use `clamp()` where fluid typography genuinely improves the interface.

Do not shrink text until it becomes difficult to read.

## Forms

On narrow screens:

- multi-column forms normally become single-column
- inputs should fit their container
- errors must not overflow
- labels must remain readable
- actions must remain visible

Check:

- select
- autocomplete
- date picker
- textarea
- upload controls
- validation messages

## Tables

Do not blindly convert every table into cards.

Choose a strategy appropriate for the information:

- horizontal scrolling
- priority columns
- responsive column hiding
- stacked rows
- compact layout
- card layout

Ensure the user can still understand relationships between data.

## Modals and overlays

Verify:

- width
- max-height
- internal scrolling
- action buttons
- close button
- keyboard usage
- mobile viewport
- tablet viewport

Dropdowns, popovers and tooltips must remain inside the viewport.

## Completion criteria

A responsive task is complete only when:

- mobile works
- tablet works
- desktop still works
- no unintended horizontal overflow exists
- interactions work
- content is readable
- dialogs work
- long content is handled
- no obvious regressions remain
