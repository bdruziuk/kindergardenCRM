---
name: accessibility
description: Use when implementing or reviewing semantic HTML, keyboard navigation, focus management, forms, dialogs, ARIA, labels, contrast, interactive controls, WCAG compliance, or accessible responsive UI.
---

# Accessibility Skill

Target WCAG 2.2 AA principles where practical.

Accessibility is part of implementation quality, not a separate visual polish phase.

## Semantic HTML

Prefer native semantic elements.

Use:

- button for actions
- anchor for navigation
- form controls for inputs
- headings for document hierarchy
- nav/main/header/footer where appropriate

Do not use ARIA when native HTML already provides correct semantics.

## Keyboard navigation

Interactive UI must be usable without a mouse.

Check:

- tab order
- visible focus
- menus
- dropdowns
- dialogs
- forms
- tabs
- custom controls

Do not create keyboard traps.

## Focus management

For dialogs:

- move focus appropriately on open
- contain focus when necessary
- return focus on close

Do not remove visible focus indicators unless an accessible replacement exists.

## Forms

Every input requires an accessible label.

Errors should be programmatically associated with their fields when appropriate.

Check:

- required state
- invalid state
- helper text
- error text
- grouped controls

Placeholder text is not a replacement for a label.

## Interactive targets

Touch targets must be usable on mobile.

Avoid extremely small icon-only controls.

Icon-only actions require an accessible name.

## Images

Meaningful images require useful alternative text.

Decorative images should not create unnecessary screen-reader noise.

## Color

Do not communicate critical information using color alone.

Check text/background contrast and control-state contrast.

## Motion

Respect reduced-motion preferences where meaningful animations exist.

Avoid motion that is necessary to understand core functionality.

## Responsive accessibility

Check accessibility after responsive changes.

Responsive implementations frequently introduce problems such as:

- hidden but focusable controls
- duplicated navigation
- incorrect DOM ordering
- off-screen menus
- invisible focus states
- mobile dialogs that cannot scroll

Avoid duplicated mobile and desktop elements being simultaneously exposed to assistive technologies.
