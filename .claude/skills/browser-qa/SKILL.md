---
name: browser-qa
description: Use when visually verifying React frontend changes with Playwright or browser tools, testing responsive viewports, detecting overflow, layout regressions, interaction failures, console errors, dialogs, forms, and navigation.
---

# Browser QA Skill

Do not consider frontend code correct solely because it compiles.

Visually and interactively verify meaningful UI changes in a browser.

Use Playwright or available browser tooling where possible.

## Minimum viewport matrix

Verify representative pages at:

- 390x844 mobile
- 768x1024 tablet portrait
- 1024x768 tablet landscape
- 1440x900 desktop
- 1920x1080 large desktop

For fragile components, test additional widths.

## Visual checks

Look for:

- horizontal overflow
- clipped content
- overlapping UI
- text wrapping failures
- incorrect stacking
- broken grids
- inconsistent spacing
- off-screen dialogs
- misplaced dropdowns
- broken sticky/fixed elements
- hidden controls
- inaccessible actions

## Interaction checks

Test relevant:

- navigation
- menus
- sidebar
- forms
- validation
- modals
- dropdowns
- tabs
- accordions
- pagination
- search
- filters
- primary CTAs

## Console

Check for:

- React errors
- warnings introduced by changes
- runtime exceptions
- failed rendering
- hydration issues where relevant

## Responsive regression

After fixing mobile/tablet problems, re-check desktop.

After changing shared components, inspect multiple representative usages.

Do not assume a shared component change is safe because one page looks correct.

## Screenshots

When browser tooling permits screenshots, use them to inspect major pages and compare responsive behavior.

Screenshots supplement interaction testing; they do not replace it.

## Completion

Before declaring frontend work complete:

1. verify representative viewports
2. verify critical interactions
3. inspect for overflow
4. inspect console
5. re-check desktop
6. verify shared-component regressions
