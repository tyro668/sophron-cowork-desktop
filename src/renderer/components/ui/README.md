# `components/ui` — shared primitive layer

Hand-maintained base controls adapted from the shadcn/ui **Radix** component
patterns (no CLI codegen, no `components.json`, no extra runtime dependency).
Only primitives the app actually uses live here.

## Rules

- Styling uses semantic theme tokens only (`bg-surface`, `border-border-muted`,
  `text-text-primary`, `bg-accent`, `text-accent-foreground`, …). Never hard-code
  hex colors or per-theme classes; dark mode comes from `.light` being absent,
  accent themes from `data-accent-theme` — primitives must not re-implement them.
- No glass blur, gradients, glow, or heavy shadows (see `UI_STYLE_GUIDE.md`).
  Overlays are solid `bg-surface` + `shadow-elevated`.
- No `electronAPI`, business models, or data-task APIs — pure props in/out.
- Interactive primitives keep Radix behavior: keyboard nav, `data-highlighted`,
  focus-visible rings, portal positioning.

## Composition model

Two exports per file:

- **Canonical class strings** (`selectTriggerClass`, `menuContentClass`,
  `menuItemClass`, …) for adapters that compose Radix parts with custom content.
- **Thin components** (`SelectTrigger`, `DropdownMenuItem`, `Button`, …) that
  apply the canonical classes and accept `className` overrides via `cn()`.

`components/Glass*` are compatibility facades preserving existing call sites;
new code should import from `./ui` (or `components/ui`) directly.

Dev preview: `vite dev` → `/preview-ui.html` renders every variant/tone/state
across light/dark and all accent themes.
