# Share your screen to a screen

Present your laptop on a ScreenTinker screen from a web browser — in a meeting room, a classroom,
a lobby — and the screen goes back to its normal content the moment you stop.

- **Editors and admins** share from the dashboard: **Share my screen** on a screen's page
  (Advanced), or on a screen card / the **Share my screen** task in the Simple view.
- **Guests** (no account) share in a meeting room with the **code the screen shows**: they open
  `/share` on their laptop (or scan the QR next to the code), type the code, and present. This is
  off by default and switched on per screen by a workspace admin.

While a share is running the screen shows it **fullscreen**, with a small *"Shared by &lt;name&gt;"*
badge (*"· guest"* for a guest). Sound is optional (tick **Include sound**). The playlist underneath
is paused and muted, and comes back when the share ends — whether the sharer pressed Stop, closed
the tab or lost their connection, an editor stopped it, or the time limit (60 minutes by default)
was reached.

Nothing is recorded. The video goes **directly from the sharer's browser to the screen**; the
ScreenTinker server never sees it.

---

## Which screens can show a share

| Player | Screen share | Notes |
|---|---|---|
| **Web player** (`/player` in Chrome, Edge, Firefox, Safari; ChromeOS; a Raspberry Pi or PC running a browser kiosk; the desktop/Electron shell) | **Yes** | Declares `remote.screen_share` when the browser has WebRTC. Verified end to end in headless Chrome (see *Tests*). |
| Native **Android** player (APK) | Not yet | Its native WebRTC stack (the one Talk uses to show an operator's webcam fullscreen) can do this; the receiver has not been written. The signalling protocol was shaped so it can reuse Talk's code (see *Protocol*). |
| **BrightSign**, **LG webOS**, **Amazon Vega**, **iOS/iPadOS** app | Not yet | They run the web player inside a host shell where receiving WebRTC is unverified, so the player deliberately does **not** declare the capability there. |
| **Samsung Tizen**, **Roku**, native **Pi / Windows / macOS** players, **e-ink** | Not yet | No WebRTC receiver. |

The dashboard only offers screens that declare `remote.screen_share` (`lib/player-capabilities.js`;
it is in no platform baseline, so an older player is never assumed able). A screen that cannot show
a share says so on its page instead of offering a button that would do nothing, and the meeting-room
code is never shown on such a screen.

## Which browsers can share

Sharing (sending) needs `getDisplayMedia()`: current **Chrome, Edge, Firefox and Safari on a
computer**. Phones and tablets mostly cannot share their screen from a browser (iOS Safari and
Android Chrome do not offer `getDisplayMedia`); the page says so plainly rather than failing.

> ⚠️ **The sharer's page must be served over HTTPS** (or `localhost`). Browsers only allow screen
> capture in a secure context. A self-hosted dashboard reached as `http://192.168.1.10:3001` can
> *show* shares on its screens but cannot *start* one from that address — the dashboard and the
> `/share` page say *"Screen sharing needs a secure (https) address"*. Put the server behind your
> usual TLS reverse proxy (Caddy, nginx, Traefik, Cloudflare Tunnel). The **screen** (the receiver)
> works over plain HTTP.

Sound: Chrome and Edge can share a tab's sound (and on Windows/ChromeOS the whole system's); Firefox
and Safari share video only. Without sound the share still works.

---

## Using it

### From the dashboard (editors and admins)

**Advanced → Screens → a screen.** The *Now Playing* tab has a **Screen sharing** card, and the
header has **🖥️ Share my screen** when this screen can take one. Press it, choose a screen, window or
tab in the browser's picker, and a bar appears at the bottom of the dashboard: *Sharing to
&lt;screen&gt; — Stop sharing*. The bar follows you around the dashboard; closing the tab stops the
share.

The card also shows who is sharing right now (*"Gail (guest) is sharing (since 14:05)"*) with
**Stop this share** — any editor can stop any share on a screen they can edit.

**Simple view.** Screens that can take a share get a **Share my screen** button under their card,
and the home page gets a **Share my screen** task: *Which screen? → Choose what to share → you're
live → Stop sharing*.

View-only members see the card (and who is sharing) but get no Share or Stop buttons, and the server
refuses them (403).

### The meeting-room code (guests)

A workspace admin switches on **Meeting-room code** in the screen's *Screen sharing* card. The screen
then shows, in its bottom-right corner:

```
[QR]  Share your screen here
      Go to signage.example.com/share and enter
      K7QM-3XHP
```

A guest opens that address (or scans the QR), types the code and an optional name, presses
**Share my screen**, picks what to share — and is live. The code is hidden while someone is sharing
and a new one appears afterwards.

The address in the QR is `APP_URL` when set, otherwise the address the screen itself reaches the
server on (the same rule as emailed links, `lib/public-origin.js`). Set `APP_URL` if the screens and
the people in the room reach the server by different names.

---

## Admin settings

| Where | Setting | Default |
|---|---|---|
| Server env | `SCREEN_SHARE_ENABLED=false` removes the feature from the whole server (routes 404, no buttons, codes gone). | on |
| Server env | `SCREEN_SHARE_MAX_MINUTES` — the longest a single share may run (1–480). | `60` |
| Members page (workspace admin) | **Allow screen sharing in this workspace.** Turning it off ends any share in progress and hides every code. | on |
| A screen's page (workspace admin) | **Meeting-room code** on this screen. | **off** |
| Admin → Organizations (platform admin) | The org's **ICE servers** (STUN/TURN) — the same per-org override live video and Talk use. | — |

There is no separate permission: starting a share needs the same edit rights as changing what the
screen plays.

## Networking: why it works out of the box on a LAN, and when you need TURN

The browser and the screen connect **peer to peer** with WebRTC. On the same network they find each
other directly (host candidates) and need nothing else. Across networks — a guest on the visitor
Wi-Fi, a screen behind a different NAT — they need help:

- **STUN** lets each side discover its public address. ScreenTinker hands out the org's ICE servers,
  or, if none are set, the server-wide `GO2RTC_STUN_URLS` (default `stun:stun.l.google.com:19302`).
  Set `GO2RTC_STUN_URLS` to your own STUN server if you do not want the browsers to contact Google's.
- **TURN** relays the media when no direct path exists (strict firewalls, symmetric NAT, a guest
  network isolated from the screens' VLAN). Set the org's ICE servers (Admin → Organizations) or
  `GO2RTC_TURN_URL` / `GO2RTC_TURN_USER` / `GO2RTC_TURN_PASS`. **These are the same settings live video
  and Talk use; go2rtc itself does not need to be running for screen share.**

If a share starts but never appears ("Your computer could not connect to the screen"), the two sides
could not find a path: put them on the same network, or add a TURN server.

> TURN credentials are given to whoever starts a share — including a guest who entered a valid
> code — exactly as they are given to the screens and the dashboard for live video and Talk. Use a
> TURN account limited to relaying, or short-lived credentials from your TURN server.

## Why peer-to-peer and not the go2rtc sidecar

Live video and Talk route media through an optional [go2rtc](live-video.md) sidecar. Screen share
does not, deliberately:

- **It works on a plain install.** go2rtc is optional and off by default; a feature that needed it
  would not work for most self-hosters. Peer-to-peer needs no extra container, port or config on a LAN.
- **There is exactly one viewer.** A restreamer pays off when many viewers watch one source (a
  dashboard wall watching a screen). A share has one sender and one screen, so a relay in the middle
  only adds latency, a codec constraint (go2rtc's WebRTC engine is H.264-only for video) and a hop.
- **Privacy.** The media never passes through any server we run — not even a sidecar on the same box.
- **NAT is the same problem either way.** go2rtc needs reachable candidates or TURN just the same; the
  org's ICE settings already exist and cover both.

The trade-off: one share is seen by one screen. Showing one laptop on a whole wall of screens at once
is a different feature (it *would* want a restreamer) and is not part of this one.

---

## Security and privacy

- **Media is never stored or relayed by the server.** It flows browser → screen over DTLS-SRTP.
  The server holds only the signalling (SDP offer/answer and ICE candidates) in memory, for the
  length of the share.
- **Signalling is authenticated on both legs.**
  - The sharer gets a **single-use ticket** from an authenticated start (or a valid code), valid for
    60 seconds, sent as the *first WebSocket message* (`/api/screen-share/ws`) — never in a URL.
  - The screen authenticates its leg (`/api/devices/:id/screen-share/ws`) with its own
    `device_token` in the first message, and the session must have been minted **for that screen**:
    another screen's valid token cannot attach to it.
  - The relay carries only `webrtc/offer`, `webrtc/answer`, `webrtc/candidate` and a few state
    words, each **rebuilt from validated fields** (size-limited SDP, candidate lines only, a capped
    number per leg). Nothing else crosses.
- **Tenancy.** Every route resolves the screen's *own* workspace and checks the caller's access to it
  (`resourceAccess`), so a screen id from another workspace is a 403 whichever workspace you are in.
  The screen-share routes are JWT-only — API tokens cannot start shares.
- **Viewers cannot start or stop.** `workspace_viewer` gets 403 on every write. The meeting-room code
  and the workspace switch need a workspace admin.
- **Audit log** (`activity_log`): `screen_share.start` (who, which screen), `screen_share.guest_join`
  (the name the guest typed and their address), `screen_share.stop` (why: stopped by sharer / owner,
  time limit, screen offline, connection failed …, who stopped it, and how long it ran),
  `screen_share.guest_toggle`, `screen_share.workspace_toggle`. The ticket and the code are never
  logged.
- **XSS.** The sharer's name is cleaned (control and bidi-override characters removed, 40 characters)
  and is only ever rendered as text — on the screen with `textContent`, on the dashboard with `esc()`.
- **No WebRTC, no breakage.** If the sharer's browser cannot capture, the page says why (not HTTPS,
  no `getDisplayMedia`, no WebRTC). If the screen cannot connect, the share ends with a clear reason
  and the screen just keeps playing its content; it is never left on a black frame (the screen gives
  up after 45 seconds without a picture).

### Abuse: the meeting-room code

The code is the only credential a guest needs, so it is designed to be usable only by someone who
can **see the screen**:

| Control | How |
|---|---|
| Only on the screen | The code lives in server memory and on the screen. No API returns it — not even to an admin. The QR carries it in the URL *fragment*, which the browser never sends to the server (so it is not in access logs), and the `/share` page strips it from the address bar. |
| Hard to guess | 8 characters from a 32-symbol alphabet without look-alikes (Crockford: no I, L, O, U) — 40 bits. |
| Rotates | Every 10 minutes even if unused, and **after every successful join** (a photographed code is useless afterwards). |
| Rate-limited | `POST /api/share/join` allows 10 tries a minute per address. A wrong, expired or spent code all get the same answer. |
| Off by default | Per screen, switched on by a workspace admin; the workspace switch and `SCREEN_SHARE_ENABLED` override it. |
| One at a time | A screen takes one share; the code is hidden while it is busy. |
| Owner can kick | Any editor can stop a share from the screen's page (**Stop this share**). |
| Bounded | Every share ends at `SCREEN_SHARE_MAX_MINUTES`. |
| Accountable | Each guest join is audited with the name they gave and their address. |

The guest's name is shown as *"Shared by &lt;name&gt; · guest"*, so a guest cannot pass as a colleague.

---

## Protocol (for player authors)

```
sharer browser                 ScreenTinker server                     screen (player)
──────────────                 ───────────────────                     ───────────────
POST /api/screen-share/devices/:id   (or POST /api/share/join {code})
  ◀── { ticket, ws_path, ice_servers, max_seconds }
WS /api/screen-share/ws
  {type:auth, ticket} ─────────▶  ── socket.io device:screenshare-start ──▶
  ◀── {type:ready}                   {session_id, shared_by, guest, audio,
                                      max_seconds, ice_servers}
                                                       ◀── WS /api/devices/:id/screen-share/ws
                                                           {type:auth, device_token, session_id}
  ◀── {type:screen_joined}                                 ──▶ {type:ready}
  ◀── {type:webrtc/offer, value}  ◀─────────────────────── {type:webrtc/offer}  (recvonly video+audio)
  {type:webrtc/answer, value} ───────────────────────────▶ (sharer's tracks on those transceivers)
  ◀──── {type:webrtc/candidate, value, mid?, mline?} ────▶  (both ways, trickled)
  ◀── {type:screen_playing}  ◀──────────────────────────── {type:state, value:playing}
  {type:stop}  ──▶  both legs get {type:ended, reason}; device:screenshare-stop {session_id, reason}
```

- The **screen offers** (recvonly video + audio) and the sharer answers; the screen drives
  negotiation because it is the side that is always there.
- Messages use go2rtc's own WebSocket shape (`webrtc/offer|answer|candidate`, `value`), so a native
  player can reuse the Talk leg it already has (Android `AudioTalker`), adding the first-message
  `auth`.
- `device:screenshare-code` `{code, url, qr, expires_at}` (or `{code: null}`) tells a screen what to
  show in its corner; `qr` is a PNG data URL.
- A player declares `remote.screen_share` only when it implements the receiver.

## API

JWT only (`/api/screen-share`, not reachable with an API token):

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/api/screen-share/devices/:id` | any member | `{feature, workspace_enabled, supported, available, reason, can_share, can_admin, guest_enabled, max_seconds, session}` |
| `POST` | `/api/screen-share/devices/:id` | editor+ | Start. Body `{audio}`. → `{session_id, ticket, ws_path, ice_servers, max_seconds, screen_name}`; `409 {reason}` when `disabled`, `workspace_disabled`, `unsupported`, `offline` or `busy`. |
| `DELETE` | `/api/screen-share/devices/:id` | editor+ | Stop whoever is sharing. → `{stopped}` |
| `PUT` | `/api/screen-share/devices/:id/guest` | workspace admin | `{enabled}` — the meeting-room code. |
| `GET`/`PUT` | `/api/screen-share/workspace/:wsId` | member / workspace admin | `{enabled}` — the workspace switch. |

Public, rate-limited (10/min per address):

| Method | Path | What |
|---|---|---|
| `POST` | `/api/share/join` | `{code, name?, audio?}` → same as a start; `404 {reason:"invalid_code"}` for any bad code. |
| `GET` | `/share` | The meeting-room page. |

`GET /api/status` reports `features.screen_share`.

## Limits

- **One screen per share**, one share per screen (see *Why peer-to-peer*).
- **State is in memory** in the server process the screen is connected to. A restart ends running
  shares (both sides are told) and issues new codes. On a [scale-out](scale-out.md) replica, screens
  connect to the primary, so share from the primary's address.
- Sharing needs HTTPS on the sharer's side (see above).
- Screens that are not the web player: not yet (see the table).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No **Share my screen** button | The screen's player does not declare `remote.screen_share` (see the card's note), the workspace switch is off, you are a viewer, or `SCREEN_SHARE_ENABLED=false`. |
| *"needs a secure (https) address"* | Open the dashboard / `/share` over HTTPS. |
| *"This browser cannot share its screen"* | A phone, or an old browser. Use a computer. |
| *"The screen did not answer"* | The screen is offline or not connected to this server process. |
| *"could not connect to the screen"* | No network path between the two. Same network, or add TURN. |
| The code on the screen is not accepted | It changes after each use and every 10 minutes — use the one showing now. After 10 wrong tries wait a minute. |
| No code on the screen | The code is off for this screen, the workspace switch is off, someone is sharing, or the player is not the web player. |
| No sound | Tick **Include sound** *and* choose "Share tab audio"/"Share system audio" in the browser's picker (Chrome/Edge). |

## Tests

- `server/test/screen-share.test.js` — the relay and codes in process: ticket single-use, the screen
  leg needs its own token and a session for that screen, message validation/stripping, cleanup on
  either side leaving / the screen going offline / owner stop / time limit / workspace switch,
  audit rows, code alphabet, single use, expiry and rotation, capability gating of codes.
- `server/test/screen-share-routes.test.js` — the real server with a real Socket.IO screen: editor
  vs viewer vs another tenant vs anonymous, capability gating, one-at-a-time, kick, the meeting-room
  code switch (admin-only), the code pushed to the screen and never returned by the API, single use,
  rate limit, Socket.IO disconnect cleanup, the workspace switch, the `/share` page under the strict CSP.
- `server/test/screen-share-player.test.js` — the web player declares `remote.screen_share` only in
  a real browser with WebRTC (not in the BrightSign / host shells), and wires start/stop/code.
- `server/test/screen-share-e2e.test.js` — **real end to end**: headless Chrome with fake capture
  (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  --auto-select-desktop-capture-source=…`) and the real web player page. A guest reads the code off
  the player, presents through `/share`, and the test asserts the player renders a **playing,
  fullscreen `<video>` whose time advances**, with the badge; Stop removes it and a new code appears.
  A second test does the same for an editor's API start and the owner's stop. Skips cleanly without
  Chrome.
