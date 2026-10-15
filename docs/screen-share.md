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

| Player | Screen share | How | Remote viewer while a share is up | Verified here |
|---|---|---|---|---|
| **Web player** (`/player` in Chrome, Edge, Firefox, Safari; ChromeOS; a Pi or PC running a browser kiosk; the desktop/Electron shell) | **Yes** | `/player/screen-share.js` (the receiver), declared when the browser has `RTCPeerConnection` with `addTransceiver` (Chromium 69+). | The shared picture with its badge (`drawScreenShare` in the capture). | End to end in headless Chrome: guest, editor, remote-viewer screenshot, multi share. |
| Native **Android** player (APK) | **Yes** | `ScreenShareReceiver` on the libwebrtc Talk already bundles (`io.getstream:stream-webrtc-android`); `ScreenShareOverlay` draws the share into a `TextureView` over the ducked content, with the badge and the meeting-room code + QR. Receive-only, needs no permission, so it is declared unconditionally. | The shared picture with its badge: the TextureView is readable (and turns with a portrait/wall transform, unlike Talk's SurfaceView), and the capture redraws the overlay on top so the paused content video never shows through. MediaProjection/accessibility tiers capture the display as it is. | JVM unit tests for the wire handling (`ScreenShareProtocolTest`) and a full Kotlin compile. **Not run on a device here** (no device/emulator; `assembleDebug` stops at the missing release key). |
| Native **Raspberry Pi**, **Windows** and **macOS** players | **Yes** | They already run the server's WebRTC modules in a QtWebEngine page (Talk, live video); that page now loads `/player/screen-share.js`, so the receiver, overlay and badge are the web player's own, in Chromium. The meeting-room code is a QML badge (`ShareCode.qml`) so it never sits a web layer over a touch screen. | The shared picture: `grabWindow()` reads the WebEngine layer. | That exact page (built by the native code) run in Chromium against a real server, driven like `app.py` drives it: plays fullscreen with the badge, reports per session, stops clean. pytest for the event handling; the QML badge rendered offscreen. **Not run on a Pi/Windows/Mac here.** QtWebEngine has no H.264 in its official builds, so the share negotiates VP8/VP9 — a Pi decodes that in software (fine for slides, heavy for 1080p video). |
| **iPad / iPhone** app (iOS 16+) | **Yes** | The web player in `WKWebView` (WebRTC since iOS 14.3; the app plays inline media without a gesture). | As the web player. | Capability unit test only. **Not run on an iPad here.** |
| **Samsung Tizen** (TV and SSSP signage) | **Tizen 10+ only** (2026 models) | The web player's receiver copied into the .wgt (`build-wgt.sh`) + `js/screen-share-tizen.js`; declared only on Tizen ≥ 10 **and** when the receiver's probe passes. The content steps aside as for screen-off (AVPlay torn down — its plane composites above the DOM). | An honest card: *"A screen share is on screen — it can't be captured on this TV"* and the sharer's name. Tizen decodes `<video>` onto a hardware plane a canvas cannot read. | Unit tests (version gate, wiring, card). **Not run on a Samsung display here.** Tizen 9.0 is "partially" supported per Samsung and deliberately not claimed until tested. |
| **LG webOS** (TV and signage) | No | LG: *"WebRTC is only available on contracted partner apps."* The web player withholds the capability inside the webOS shell. | — | — |
| **BrightSign** | No | WebRTC in `roHtmlWidget` sits behind `security_params.camera_enabled`, documented for USB cameras, which the player does not set; receive-only is not documented. Withheld. | — | — |
| **Amazon Vega** (Fire TV) | No | The Vega WebView does not document WebRTC either way. Withheld until tested on a stick. | — | — |
| **Apple TV (tvOS)** | No | tvOS has no WebKit/WKWebView; would need a native WebRTC SDK. There is no tvOS player. | — | — |
| **Roku** | No | Roku OS has no web engine and no WebRTC. | — | — |
| **e-ink** | No | — | — | — |

Sources (checked 2026-10): Samsung web engine specifications, "Real-time communication" —
<https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html> and
<https://developer.samsung.com/signage/develop/specifications/web-engine-specifications.html>;
LG webOS TV web engine — <https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine>
and the LG developer forum answer <https://forum.webostv.developer.lge.com/t/inquiry-regarding-webrtc-support-on-webos-tv/28059>;
BrightSign `roHtmlWidget` — <https://docs.brightsign.biz/develop/rohtmlwidget>;
Apple `WKWebView` availability — <https://developer.apple.com/documentation/webkit/wkwebview> and
<https://webkit.org/blog/11353/mediarecorder-api/>;
Amazon Vega WebView — <https://developer.amazon.com/docs/vega/0.24/develop-your-app-with-webview.html>;
Qt WebEngine features — <https://doc.qt.io/qt-6/qtwebengine-features.html>;
Roku — <https://partnersuccess.roku.com/hc/en-us/articles/360060167853-Does-Roku-support-WebRTC-and-Play-WebRTC-streams>.

The dashboard only offers screens that declare `remote.screen_share` (`lib/player-capabilities.js`;
it is in no platform baseline, so an older player is never assumed able). A screen that cannot show
a share says so on its page and in the Simple view, naming its player — *"This screen can't show a
screen share (Roku)"*, *"… yet (Android). Update the ScreenTinker app on it and it can."*, or for
Tizen *"It needs a Samsung display with Tizen 10 (2026 models) or newer"* — instead of offering a
button that would do nothing, and the meeting-room code is never shown on such a screen. Every
receiver gives up after 45 seconds without a picture and tells the sharer, so even a screen that
claims the capability wrongly is never left black.

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

### Several screens at once (multi share)

One capture, shown on several screens at the same time — a town hall on every screen of a floor,
the same slides in two meeting rooms:

- **A screen's page:** under **Share my screen**, open **Also show on…** and tick the other screens
  (only screens that can show a share are listed; offline ones are greyed out).
- **A device group** (Advanced → Screens, the group's header): **Share my screen to this group**.
- **Simple view:** the *Share my screen* task lets you tap several screens before **Next**.

The bar says *"Sharing to 4 screens"* and *"Showing on 3 of 4 screens"* while they connect. Each
screen shows the share with its own *"Shared by …"* badge, and each screen's remote viewer shows it.

- Screens that **cannot** take the share right now (a player without a receiver, offline, already
  showing someone else's share) are **skipped and named** after you pick what to share — *"Not shared
  to Lobby TV, Kiosk 3: they can't show a screen share right now."* The rest start.
- **Stop** on the bar ends it on every screen. A screen that disconnects drops out on its own and the
  others keep going (you get a note). On a screen's card, another editor can **Stop on this screen**
  or **Stop on all N screens**.
- **Limit:** one share reaches at most `SCREEN_SHARE_MAX_TARGETS` screens (default **6**). Each screen
  is a separate peer-to-peer upload *from the sharer's computer* (roughly 1–3 Mbit/s each for a
  screen of slides, more for video), so the limit protects the sharer's uplink, not the server. Asking
  for more is refused with that reason; nothing starts.
- **Mirror displays** (the same display link open in another place, [web-player.md](web-player.md)):
  every way of sharing to a display also reaches its mirrors: **Share my screen** on the display's
  page, its screen card or the Simple view, a multi share naming it, and a guest's meeting-room code.
  The one-screen start (`POST /api/screen-share/devices/:id`) and the guest join (`POST
  /api/share/join`) answer with the display's own leg in their usual fields plus, added, `share_id`
  and `legs` (display first, then each mirror; the sharer's page sends the one capture to each) and,
  for the signed-in start only, `skipped`. A mirror that is offline, busy, cannot show a share or is
  past the target limit is left out, never a reason to refuse; the display itself unavailable refuses
  as before. **Stop** on the display (sharer or owner) ends it on its mirrors; a mirror that drops
  off or is removed loses only its own leg. The card counts the display once ("+ mirrors" apart).
  Mirrors are never a choice: the card says "Also shows on its mirrors (n): …", and **Also show
  on…** offers displays only (picking one brings its mirrors).
- **A mirror that appears during a share joins it.** When a mirror of a display being shared to
  connects (opened for the first time, or back after a drop), the server mints a leg for it in the
  same share and hands it to the sharer's page over a signalling socket that page already has open
  (`{type:'add_leg', share_id, leg}`; a guest's leg carries no device id). The page sends the same
  capture to it, and the bar updates ("Showing on 3 of 3 screens"). Only the server chooses: a
  mirror of a display the share was started for, in its workspace, that can take a share; nothing
  the sharer sends can add a screen. The target limit holds: a full share skips the mirror and the
  sharer is told (`{type:'leg_skipped', screen_name, reason}`). A sharer page from before this
  ignores the message; the unused leg expires after a minute.
  `withMirrors()` / `expandShareTargets()` in `lib/screen-share.js` decide.
- **The meeting-room code on mirrors:** the code belongs to the display; its mirrors show the same
  code (a mirror that connects while it is live gets it at once) and a guest who types it at a
  mirror presents to the display and all its mirrors. Redeeming it spends it everywhere; no screen of
  the family shows a code while the display is busy (nor a mirror busy with its own share); when the
  share ends they all get the same new code. A share to one mirror alone replaces the display's code
  when it starts and again when it ends. The switch is on the display (a mirror's page has none).

#### Sharing to many screens (beyond the limit)

For a whole building, one upload has to go to a **restreamer** that fans out to every screen — the
[go2rtc](live-video.md) sidecar live video already uses. That path is **not implemented** in this
release: it would put the media through a server (so *"the server never sees the video"*, below, no
longer holds), needs an H.264 capture (go2rtc's WebRTC engine is H.264-only), and every
receiver would need a pull mode. Until it lands, raise `SCREEN_SHARE_MAX_TARGETS` only for sharers on
a wired uplink, and use several shares (or a playlist with a stream) for anything larger.

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
| Server env | `SCREEN_SHARE_MAX_TARGETS` — how many screens one share may reach at once (1–50). Each is an upload from the sharer's computer. | `6` |
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

The trade-off: every screen is its own upload from the sharer. A multi share to a handful of screens
is still peer to peer (one RTCPeerConnection per screen, one capture); showing one laptop on a whole
building is where a restreamer pays off — see *Sharing to many screens* above.

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
- **Multi share** changes nothing on this wire: it is N ordinary sessions with the same `share_id`,
  one per screen, each with its own single-use ticket, sharer socket and screen leg. A screen only
  ever sees its own session, and the relay's ticket ↔ session ↔ device binding keeps the legs apart.
- **Reference receivers:** the web player (`server/lib/screen-share-player.js`, also copied into the
  Tizen .wgt and loaded by the native player's QtWebEngine page) and Android
  (`android/.../remote/ScreenShareReceiver.kt`, wire handling in `ScreenShareProtocol.kt`).
- While a share is on screen, the player's screenshot / live-view capture must show the share (or,
  where the platform cannot read the video back, an honest card naming the sharer), never the paused
  content underneath.

## API

JWT only (`/api/screen-share`, not reachable with an API token):

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/api/screen-share/devices/:id` | any member | `{feature, workspace_enabled, supported, available, reason, can_share, can_admin, guest_enabled, max_seconds, session, max_targets, platform}`; `session` carries `share_id` and `screens` (how many screens that share is on). |
| `POST` | `/api/screen-share/shares` | editor+ on every screen | Multi share. Body `{device_ids?, group_id?, audio}`. → `{share_id, ws_path, max_seconds, legs: [{device_id, screen_name, session_id, ticket, ice_servers}], skipped: [{id, name, reason, platform}]}`. A screen the caller cannot edit (or another tenant's) refuses the whole request (403/404) and creates nothing; screens that cannot take it are `skipped`; `409 {reason:"too_many_targets", max_targets}` above the limit; `409 {reason:"none_available", skipped}` when none can. |
| `DELETE` | `/api/screen-share/shares/:shareId` | editor+ on every screen | Stop it everywhere. → `{stopped: n}`; 404 for an unknown share or another tenant's. |
| `GET` | `/api/screen-share/groups/:groupId` | any member | `{feature, workspace_enabled, can_share, max_targets, screens: [{id, name, ok, reason, platform}]}` — which of a group's screens can take a share. |
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

- One share per screen; one share reaches up to `SCREEN_SHARE_MAX_TARGETS` screens (see *Several
  screens at once*).
- **State is in memory** in the server process the screen is connected to. A restart ends running
  shares (both sides are told) and issues new codes. On a [scale-out](scale-out.md) replica, screens
  connect to the primary, so share from the primary's address.
- Sharing needs HTTPS on the sharer's side (see above).
- LG webOS, BrightSign, Amazon Vega, tvOS, Roku and e-ink screens cannot show a share, and Samsung
  displays need Tizen 10+ (see the table).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No **Share my screen** button | The screen's player does not declare `remote.screen_share` (see the card's note), the workspace switch is off, you are a viewer, or `SCREEN_SHARE_ENABLED=false`. |
| *"needs a secure (https) address"* | Open the dashboard / `/share` over HTTPS. |
| *"This browser cannot share its screen"* | A phone, or an old browser. Use a computer. |
| *"The screen did not answer"* | The screen is offline or not connected to this server process. |
| *"could not connect to the screen"* | No network path between the two. Same network, or add TURN. |
| The code on the screen is not accepted | It changes after each use and every 10 minutes — use the one showing now. After 10 wrong tries wait a minute. |
| No code on the screen | The code is off for this screen, the workspace switch is off, someone is sharing, or the screen's player cannot show a share (see the table). |
| *"One share can reach at most N screens"* | Pick fewer screens, or raise `SCREEN_SHARE_MAX_TARGETS` for sharers on a wired uplink. |
| Some screens of a group were skipped | They cannot take a share now (player without a receiver, offline, busy); the toast names them. |
| A Raspberry Pi share stutters with video | The Pi decodes the share in software (QtWebEngine has no H.264, so it is VP8/VP9). Slides are fine; share a lower resolution or a window for video. |
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
  A second test does the same for an editor's API start and the owner's stop. Then: the remote
  viewer's screenshot is the share; **multi share** — one sharer, two web-player screens (separate
  browser contexts) both playing, stop one (the other keeps playing), stop all (capture ended); and
  the **native player's RTC page**, generated by `native/…/ui/rtc_page.py` and run in Chromium (the
  engine QtWebEngine embeds) the way `app.py` drives it, receiving a share. Skips cleanly without
  Chrome (and the native test without `python3`).
- `server/test/screen-share-multi.test.js` — multi share against the real server: one leg per screen
  with one share id, per-leg isolation (one screen cannot attach to another's leg, tickets single-use,
  signalling never crosses), viewers and any other-tenant id refuse the whole request with nothing
  left behind, skipped screens named, the limit, groups, one screen disconnecting alone, stop one /
  stop all, and the one-screen API unchanged.
- `server/test/screen-share-players.test.js` — every other player: Tizen (receiver copy byte-identical,
  Tizen 10+ gate, wiring, the remote-viewer card), Android and native declarations and wiring, no
  baseline ever granting the capability, and this table's sources.
- `android/app/src/test/.../remote/ScreenShareProtocolTest.kt` (JUnit) and
  `native/tests/test_screen_share.py` (pytest) — each native receiver's wire handling.
