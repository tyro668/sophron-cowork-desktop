# Project instructions

All UI work under `src/renderer` must follow [`UI_STYLE_GUIDE.md`](UI_STYLE_GUIDE.md).

- Preserve the existing layout unless the task explicitly requests a layout change.
- Use semantic theme tokens; do not hard-code accent colors in components.
- Keep configuration screens compact and omit helper descriptions below fields.
- Do not introduce gradients, glass blur, glow effects, or heavy shadows.
- All UI code must natively support i18n: never hard-code user-facing text in components — use `useTranslation`/`useFormTranslation` keys, and keep `zh.json` and `en.json` in sync.
- Visually verify affected screens after UI changes.
