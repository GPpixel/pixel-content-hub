# CLAUDE.md

Guidance for anyone, human or AI, changing Pixel Content Hub.

## What this is

Pixel's digital signage server: a dashboard to manage screens, upload content, build playlists and schedules, and a web player that the screens open. It is built on [ScreenTinker](https://github.com/screentinker/screentinker) 3.0.0 (MIT), restyled to the Pixel design language and branded as Pixel Content Hub. The import commit records the exact upstream commit.

- `server/` is the Node.js server (Express, Socket.IO, SQLite). Its dependencies live in `server/package.json`, not the root one.
- `frontend/` is the dashboard, served as static files. `frontend/index.html` is the app.
- `server/player/` is the web player the screens run.
- The native players (`android/`, `native/`, `tizen/`, `webos/`, `roku/` and so on) are upstream's and still say ScreenTinker.

`README.md` describes Pixel Content Hub, with screenshots in `docs/images/`. `ARCHITECTURE.md` and the rest of `docs/` describe the upstream product. `docs/pixel-install.md` is how Pixel installs it.

## Ground rules

- **Don't change behaviour or looks unless that is the task.** Keep Pixel changes small and in the places listed under "Design language" below, so upstream fixes can still be applied.
- **Keep the licence and attribution.** `LICENSE` (MIT, ScreenTinker) stays as it is, and the README keeps saying where the code comes from.
- **Node 22.14 or newer.** The server refuses to start on older Node.
- **State lives under `DATA_DIR`** (default `server/`): `db/`, `uploads/`, `certs/` (including the generated JWT secret). Never commit it. Don't change the JWT secret on a running install: everyone is signed out and saved secrets become unreadable.
- **Run the tests** before pushing: `cd server && npm test`. Add or update a test for any behaviour change.
- **The player has a generated copy.** After editing `server/player/index.html`, run `cd server && npm run build:legacy-player` to regenerate `server/player/legacy.html`.
- **No in-app updates.** Upstream's "Update Now" would install a ScreenTinker release over the Pixel changes, so it's turned off (see "No ScreenTinker updates" below). Bring upstream changes in as a patch instead (below).

## Bringing in ScreenTinker updates

This repo's history starts at an import of ScreenTinker 3.0.0 (upstream commit `7eaa954`); upstream's own history isn't in it, so its releases don't merge. Apply the changes between two upstream releases as a patch instead:

```bash
git remote add upstream https://github.com/screentinker/screentinker.git   # once
git fetch upstream --tags
git checkout -b upstream-sync main
git diff v3.0.0 v3.0.1 > /tmp/upstream.patch      # the release you have, then the one to bring in
git apply --3way /tmp/upstream.patch
```

Conflicts can come up wherever Pixel changed a file: the styles, the branding defaults, a few dashboard views and the player. Keep the Pixel side of each, and drop changes to anything listed under "Removed from upstream" below. Re-run `npm run build:legacy-player` if the player changed, run the tests, and open a pull request into `main`.

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

Figtree for body text and Cal Sans for headings, self-hosted from `frontend/assets/fonts/pixel/` (OFL; the licences are next to the files). The dashboard's Content-Security-Policy only allows same-origin fonts, and a server on a LAN may have no internet, so don't switch to a font CDN.

### Branding defaults

An unbranded workspace is "Pixel Content Hub" with the Pixel accent and background. The defaults live in `server/lib/branding.js` (`HARDCODED_BRANDING`), the `white_labels` table defaults in `server/db/schema.sql`, and the white-label routes. `frontend/js/branding.js` and `brand-prime.js` treat the Pixel default and the old ScreenTinker default colours as "not a brand", so they never override the Pixel palette. A real white-label colour still replaces the accent.

### Logo and icon

- `frontend/assets/pixel-inspiration-logo-white.svg` is the company logo (the same file as the staff portal). The sidebar header, the Simple view's top bar (`views/simple-home.js`) and the sign-in page show it as a lockup: logo, a thin rule, then "Content Hub" (`.pixel-lockup` in `pixel-theme.css`), as the staff portal does with "Hub". A white-label logo replaces the lockup on the sign-in page.
- `frontend/assets/icon.svg` is the app icon: the white logo on a crimson (`--accent-gradient`) tile. It is the favicon; `icon-192.png` and `icon-512.png` are rendered from it for the web app manifest and home-screen icons. Replace all three together.

### Usage statistics prompt

The dashboard doesn't show upstream's "Help show how widely ScreenTinker is deployed?" prompt (`PIXEL_HIDE_STATS_PROMPT` in `frontend/js/views/dashboard.js`), because those statistics go to ScreenTinker. Nothing is sent unless a platform admin turns sharing on in Settings. Upstream's sponsor request is turned off with `ST_HIDE_SPONSOR=true` in `server/.env`.

### No ScreenTinker updates

The dashboard never offers a ScreenTinker release, because installing one would replace the Pixel changes. `server.js` doesn't start upstream's GHCR polling, `routes/admin.js` answers `/api/admin/check-update` with no update (`PIXEL_NO_UPSTREAM_UPDATES`), and the System page hides the latest-version card and the Check now / Update now buttons (`PIXEL_NO_UPSTREAM_UPDATES` in `frontend/js/views/admin.js`). So the sidebar's Update badge and the Simple home's "ScreenTinker x is available" notice never show. `test/pixel-no-upstream-updates.test.js` checks it.

### Support access

Upstream's vendor "Support Access" (a support token on the sign-in page, a request-code section in Settings) is removed. The sign-in page and Settings don't show it, `routes/auth.js` answers every `/api/auth/support` endpoint with a 404, and `middleware/auth.js` refuses any support session. `docs/support-access.md` describes the upstream feature, which doesn't apply here. `test/pixel-no-support-access.test.js` checks it stays off.

### Screens without a player

A screen can exist with no player behind it, so its playlists and schedules can be set up before the hardware arrives or while a player is replaced.

- **Add screen** (the Advanced dialog in `index.html` and `dashboard.js`, and the Simple guide in `views/onboarding.js`) offers "I have a 6-digit code" or "Don't have a code yet? Create without a player" (`POST /api/devices/without-player` in `server.js`), plus a button to the downloads page.
- **Reset or replace player** on a screen's page (`showPlayerModal` in `views/device-detail.js`) resets the screen, letting its player go (`POST /api/devices/:id/detach-player`), or attaches the player showing a pairing code (`POST /api/devices/:id/attach-player`; replacing a working player needs `replace: true`). Any app or the web player works.
- `lib/device-player.js` does both. A reset drops the screen's device token, enrolment key and fingerprints, so the old player can't come back as it, and tells that player to show a new pairing code. Attaching reuses the org-import "pair into" merge (`lib/trust/import-screens.js`): the screen moves onto the new player's row id and keeps everything else.
- API responses carry `player_attached` (`lib/device-sanitize.js`); the dashboard shows "No player" for a screen without one. `test/pixel-player-reset.test.js` covers it.

### Screen previews

Each screenshot costs the player, so previews aren't live by default. The Screens page refreshes previews every 2 minutes (`PIXEL_PREVIEW_REFRESH_MS` in `views/dashboard.js`), and each card has a refresh button. A screen's Now Playing preview refreshes once a minute (`PIXEL_PREVIEW_IDLE_MS` in `views/device-detail.js`), with "Refresh preview" for one on request (it replaces the Screenshot button at the top of the page) and "Start live view" for a frame every 5 seconds plus the live video tile.

### Removed from upstream

**Player rollouts page.** Platform admins' Player rollouts page is removed from the dashboard (`views/admin.js`); its place in the sidebar is "Player App Downloads", a link to the downloads page (`/download/`, titled "Download a Pixel Content Hub player"). The server's rollout logic is unchanged.


**Raspberry Pi player.** Upstream's native Raspberry Pi player is removed: its packaging (`native/packaging/linux/`), `scripts/raspberry-pi-setup.sh`, the `/download/pi` and `/api/pi/update/check` routes (`routes/pi-update.js`, `lib/deb-cache.js`), the Pi build steps in the Dockerfile and the release, upgrade and Debian setup scripts, the Raspberry Pi button under Add display, and `docs/pi-native-player.md`. `test/download-index.test.js` checks the download page offers no Pi player.

**Marketing site.** Upstream's public website is removed: the landing page, `guides/`, `compare/`, `solutions/`, `integrations/`, the certified hardware pages and their submission form (`certified-hardware.json`, `lib/certified-hardware.js`, `routes/certified-hardware.js`, `routes/hardware-submissions.js`), the public template gallery (`/templates`), `sitemap.xml`, `llms.txt` and `marketing/`. `/` always opens the dashboard, `robots.txt` asks crawlers to stay out, and old links under `/guides/`, `/integrations/` and `/solutions/` get a 404. The download page's setup guide links go to ScreenTinker's website. The hardware submissions table stays in the database schema, unused, to keep the schema as upstream has it.

### Known fallbacks

- **Glass needs `backdrop-filter`.** Without it, surfaces stay solid (the token values above).
- **Upstream's legal pages** (`frontend/legal/`) and the API reference (`/docs`) are not restyled.
- **The sidebar is fixed to the edge**, not floating with `--radius-lg` as in the staff portal, to keep the dashboard's layout and mobile menu unchanged.

When something can't follow the design language, use the nearest token from the table above and add it to this list.
