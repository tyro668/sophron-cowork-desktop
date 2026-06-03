# Desktop Glass Operations Design

This app follows a compact desktop operations style: a macOS-like glass workspace with dense, data-oriented controls. The visual target is calm, light, and efficient rather than decorative or promotional.

## Visual Language

- Use a cool mist background with frosted panels. Page surfaces should feel translucent but readable.
- Keep the primary layout as an operational shell: left navigation, central work surface, and optional right context panel.
- Prefer compact typography, 11px-15px for most interface text. Use 16px-18px only for the central page title or major dialog title.
- Keep body copy, table values, selected navigation, and command text high contrast. Reserve muted text for metadata, timestamps, and short helper labels.
- Use medium weight for emphasis. Avoid bold, oversized headings, and hero-like empty states.
- Accent color is cyan-teal. Use it for primary actions, active indicators, progress, and selection rings.
- Cards and panels use soft borders, subtle inner highlights, and restrained shadows.

## Layout

- Keep application pages full height and work-surface first. The first viewport should show actionable content.
- Main page content sits in a frosted central panel with a compact header and scrollable body.
- Sidebars use translucent surfaces with visible separators and compact navigation rows.
- Right context panels are secondary utility columns. Keep them narrow, segmented, and low contrast.
- Avoid nested card stacks. Use cards for repeated items, tables, inspectors, and dialogs only.

## Component Rules

- Primary buttons are 32px-36px high with icon + label where space allows.
- Icon-only buttons are 28px-32px square and require a title/tooltip.
- Inputs are 32px-36px high, rounded 8px-10px, with `text-[13px]`.
- Tables use 40px header rows and about 52px body rows.
- Status chips are 22px-24px high and use 11px-12px text.
- Message/tool rows should look like slim capsules, not large cards.
- The composer uses a frosted rounded rectangle with compact bottom controls.
- Dropdowns and popover menus close on outside click and Escape. Use `GlassSelect` for single-value selects and `GlassDropdownMenu` / `GlassMenuItem` for action menus. Use a frosted popover surface, readable body text, and `bg-accent/10 text-text-primary` for selected rows.

## Page Guidance

- Chat: center the conversation title in a 48px header; keep trace/tool blocks as narrow capsules; keep the composer anchored.
- Data: retain dense tables and toolbar controls; use glass cards for stats and table containers.
- Skills: treat as an operations inventory, not a marketing page; use the same settings skill table styling.
- Settings: use a compact left tab rail and frosted content panel; descriptions stay muted and short.
- Welcome: present immediate task entry and quick actions, not a landing page.

## Implementation

- Prefer shared theme tokens in `src/renderer/styles/globals.css`.
- Use `bg-background`, `bg-surface`, `border-border-muted`, and `shadow-card` so pages inherit the glass system. Use `text-text-primary` for readable content, `text-text-secondary` for supporting labels, and `text-text-muted` only for low-priority metadata.
- Use `.glass-card`, `.glass-surface`, `.app-main-panel`, and `.page-workspace` for new high-level containers.
- Use Tailwind opacity utilities such as `bg-background/42` only with the RGB theme tokens configured in `tailwind.config.js`; do not introduce ad hoc opaque whites.
- New UI work must also follow `UI_STYLE_GUIDE.md`.
