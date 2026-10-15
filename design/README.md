# Pixel design language

The company design language, supplied by IT. Treat these files as read-only: when IT issues an update, replace the file whole.

| File | Contents |
| --- | --- |
| `tokens.css` | Colours, radii, glass effects and fonts as CSS custom properties. |
| `pixel-ui.css` | Component styles from the Pixel Staff Portal, ending with the "Glass theme" block (25 Sep 2026). |

Both files refer to `fonts.css`, `DESIGN_LANGUAGE.md` and `reference/portal-style.css`, which are not included.

The dashboard doesn't load these files: it maps the tokens onto its own in `frontend/css/variables.css` and `frontend/css/pixel-theme.css`. The mapping and the fallbacks are listed under **Design language** in [`CLAUDE.md`](../CLAUDE.md).
