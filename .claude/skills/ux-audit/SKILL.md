---
name: ux-audit
description: Use when reviewing or improving application usability, desktop UX, information hierarchy, forms, navigation, spacing, CTAs, user flows, consistency, loading, empty states, error states, or interaction design.
---

# UX Audit Skill

Act as a senior product-oriented UX engineer.

The objective is to improve usability without unnecessarily redesigning an existing working product.

## UX audit principles

Evaluate interfaces based on:

- clarity
- hierarchy
- discoverability
- consistency
- efficiency
- feedback
- error prevention
- information density
- predictability

Do not change UI only because another version might look more modern.

Every significant change should have a concrete UX reason.

## Review visual hierarchy

Check:

- page title
- section hierarchy
- primary action
- secondary actions
- supporting information
- destructive actions
- metadata
- status indicators

The primary user objective should be visually clear.

Avoid having many actions with equal visual emphasis.

## Navigation

Review:

- header
- sidebar
- breadcrumbs
- tabs
- menus
- active states
- mobile navigation
- back navigation

Check whether users can answer:

- Where am I?
- What can I do here?
- How do I return?
- What is the primary next action?

## Forms

Check:

- logical field grouping
- label clarity
- required/optional distinction
- validation feedback
- helper text
- action placement
- destructive actions
- disabled states
- loading states

Avoid unnecessarily wide inputs.

Avoid placing unrelated fields in the same visual group.

## Buttons and actions

Establish clear hierarchy between:

- primary
- secondary
- tertiary
- destructive

Avoid multiple dominant CTAs within the same local context.

Check button labels for clarity.

Prefer action-oriented labels over vague labels where possible.

## Spacing

Look for:

- inconsistent gaps
- arbitrary margins
- weak section separation
- excessive whitespace
- insufficient whitespace
- content that visually merges unintentionally

Prefer existing spacing tokens/design-system values.

## Content density

Desktop interfaces should use available space efficiently without becoming visually overwhelming.

Check:

- excessively wide forms
- overly sparse dashboards
- huge cards containing little information
- unnecessary scrolling
- tables with poor density
- content stretched across very wide screens

## Feedback

Every meaningful user action should have appropriate feedback.

Review:

- loading
- success
- error
- disabled
- pending
- empty
- confirmation

Do not leave users uncertain whether an action succeeded.

## Empty states

An empty state should communicate:

1. what is empty
2. why it may be empty
3. what the user can do next

Avoid showing large blank regions without explanation.

## Error states

Errors should be:

- visible
- understandable
- actionable

Avoid exposing implementation details to users.

## Desktop review

Specifically examine desktop for:

- poor content width
- awkward use of large screens
- oversized components
- inconsistent alignment
- unclear CTA hierarchy
- weak grouping
- excessive clicks
- unnecessarily long forms
- repetitive UI

Do not sacrifice desktop efficiency in order to reuse a mobile layout.

## Output when auditing

Prioritize findings approximately as:

- P0: blocks core workflow
- P1: severe usability issue
- P2: noticeable usability problem
- P3: polish

Fix P0/P1 before spending significant effort on P3.
