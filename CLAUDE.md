# CLAUDE.md

Guidance for anyone, human or AI, changing Pixel Content Hub.

## What this is

Pixel's digital signage server: a dashboard to manage screens, upload content, build playlists and schedules, and a web player that the screens open. It is built on [ScreenTinker](https://github.com/screentinker/screentinker) 3.0.0 (MIT), restyled to the Pixel design language and branded as Pixel Content Hub. The import commit records the exact upstream commit.

- `server/` is the Node.js server (Express, Socket.IO, SQLite). Its dependencies live in `server/package.json`, not the root one.
- `frontend/` is the dashboard, served as static files. `frontend/index.html` is the app.
- `server/player/` is the web player the screens run.
- The native players (`android/`, `native/`, `tizen/`, `webos/`, `roku/` and so on) are upstream's and still say ScreenTinker.

`ARCHITECTURE.md`, `README.md` and `docs/` describe the upstream product. `docs/pixel-pi-install.md` is how Pixel installs it.

## Ground rules

- **Don't change behaviour or looks unless that is the task.** Keep Pixel changes small and in the places listed under "Design language" below, so upstream fixes can still be merged in.
- **Keep the licence and attribution.** `LICENSE` (MIT, ScreenTinker) stays as it is, and the README keeps saying where the code comes from.
- **Node 22.14 or newer.** The server refuses to start on older Node.
- **State lives under `DATA_DIR`** (default `server/`): `db/`, `uploads/`, `certs/` (including the generated JWT secret). Never commit it. Don't change the JWT secret on a running install: everyone is signed out and saved secrets become unreadable.
- **Run the tests** before pushing: `cd server && npm test`. Add or update a test for any behaviour change.
- **The player has a generated copy.** After editing `server/player/index.html`, run `cd server && npm run build:legacy-player` to regenerate `server/player/legacy.html`.
- **Don't use the in-app "Update Now".** It upgrades to upstream ScreenTinker releases and would replace the Pixel changes. Bring upstream changes in with a git merge instead.

## Writing docs

- **Describe the project as it is.** Don't narrate how it got there or who changed it ("Claude added…", "we moved…"). That history belongs in commit messages and pull requests.
- **Write for the reader.** Plain words, short sentences, no internal jargon in anything staff will read.
- **Say each thing once.** Each fact lives in one doc; other docs link to it rather than repeating it.

## Design language

The company design language is in `design/` (`tokens.css` and `pixel-ui.css`, from IT, read-only: when IT issues an update, replace the files whole). It's dark grey, translucent "glass" surfaces with a crimson accent, Figtree body text and Cal Sans headings. This is the same design language Pixel Media Checker follows.

The dashboard doesn't load `design/` directly, because `pixel-ui.css` uses class names (`.btn`, `.card`…) that clash with the dashboard's own. Instead:

1. **`frontend/css/variables.css`** sets the dashboard's existing token names to Pixel values. Every component reads these, so this is where colours change. Translucent tokens are flattened onto `--bg-solid` (`#2b2b2b`) so a surface that uses them is solid, which is the design language's own fallback for glass. The raw Pixel tokens are also defined there with a `--px-` prefix.
2. **`frontend/css/pixel-theme.css`**, loaded last, adds what a token can't: the self-hosted fonts, the page washes, glass on the large surfaces, pill buttons and nav items, and neutral selected states.

**Any UI change must use these tokens.** Don't hard-code new hex values or fonts in views or CSS. To add a colour, take it from `design/tokens.css`; if it's translucent and used as a solid surface, flatten it onto `#2b2b2b` (`round(43 + alpha × (channel − 43))` per channel).

### Colours

| Dashboard token | Value | Design token | Notes |
| --- | --- | --- | --- |
| `--bg-primary` | `#232323` | `--bg` | Page background, under the three washes. |
| `--bg-secondary` | `#2B2B2B` | `--bg-solid` | Sidebar and modal base. |
| `--bg-card` | `#2B2B2B` | `--bg-solid` | Solid stand-in for `--bg-panel` glass. |
| `--bg-card-hover` | `#454545` | `--bg-hover` | Flattened. |
| `--bg-input` | `#383838` | `--bg-inner` | Fields and tiles inside a card, flattened. |
| `--border` | `#494949` | `--border` | Flattened. |
| `--text-primary` | `#F2F2F2` | `--text-primary` | |
| `--text-secondary` | `#BBBBBB` | `--text-secondary` | Flattened. |
| `--text-muted` | `#9A9A9A` | `--text-muted` | Flattened. |
| `--accent` | `#C0394B` | `--accent` | Primary actions, brand. |
| `--accent-hover` | `#A8303F` | `--accent-hover` | |
| `--accent-2` | `#DD5A6E` | `--accent-bright` | Focus rings, primary button border, highlights. |
| `--accent-3` | `#EC8F9C` | `--accent-link` | Links and text on accent tints. |
| `--grad-accent` | `#CC4659` → `#B8364A` | `--accent-gradient` | Primary buttons. |
| `--success` / `--warning` / `--danger` | `#22C55E` / `#F5A623` / `#EF4444` | `--green` / `--amber` / `--red` | |

The web player (`server/player/index.html`) styles its pairing and status screens inline, with `#232323` for the background and `#C0394B` for the accent.

### Shape

| Element | Radius | Token |
| --- | --- | --- |
| Cards, panels, modals (`--radius-lg`) | 22 px | `--radius` |
| Inputs, menus, small boxes (`--radius`) | 12 px | `--radius-sm` |
| Buttons, nav items | pill | `--radius-pill` |

### Type

Figtree for body text and Cal Sans for headings, self-hosted from `frontend/assets/fonts/pixel/` (OFL; the licences are next to the files). The dashboard's Content-Security-Policy only allows same-origin fonts, and a Pi on a LAN may have no internet, so don't switch to a font CDN.

### Branding defaults

An unbranded workspace is "Pixel Content Hub" with the Pixel accent and background. The defaults live in `server/lib/branding.js` (`HARDCODED_BRANDING`), the `white_labels` table defaults in `server/db/schema.sql`, and the white-label routes. `frontend/js/branding.js` and `brand-prime.js` treat the Pixel default and the old ScreenTinker default colours as "not a brand", so they never override the Pixel palette. A real white-label colour still replaces the accent.

### Known fallbacks

- **Glass needs `backdrop-filter`.** Without it, surfaces stay solid (the token values above).
- **Upstream's marketing pages** (`frontend/landing.html`, `frontend/guides/`, `frontend/legal/` and similar) are not restyled. Run with `DISABLE_HOMEPAGE=true` so `/` opens the dashboard.
- **The sidebar is fixed to the edge**, not floating with `--radius-lg` as in the staff portal, to keep the dashboard's layout and mobile menu unchanged.

When something can't follow the design language, use the nearest token from the table above and add it to this list.
