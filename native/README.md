# ScreenTinker native player — Windows and macOS

One native player with Android-app parity, two operating systems (macOS is beta — see
`docs/macos-player.md`). It is not the web player in a
browser: playback, zones, transitions, sync, triggers and device control are native Python/Qt code,
and QtWebEngine is used only where Android uses a WebView (widgets, YouTube, HTML bundles, and the
WebRTC intercom/live view).

- **Engine** (`screentinker_native/`, OS-neutral): socket, playback, zones, transitions, sync,
  triggers, cache, QML scene. **OS backends** (`screentinker_native/platform/linux`, `…/windows`, `…/macos`):
  device info, screen power, mixer, brightness, shell/PTY, the privileged door, OS actions. Nothing
  above `platform/` may test the OS itself.
- **Stack:** Python + **PySide6** (Qt for Python, **LGPL-3.0**). ⚠️ Never PyQt6 — it is GPL-3.0, and
  ScreenTinker ships no GPL code. python-socketio, aiohttp.
- **Windows:** Windows 10 1809+ / 11, x64. An Inno Setup installer bundling everything (PyInstaller),
  plus the `ScreenTinkerHelper` service.
- **macOS (beta):** macOS 12+. `ScreenTinker.app` in a .dmg (PyInstaller), started at login by a
  per-user LaunchAgent. No privileged helper, so no reboot/clock/install from the dashboard, and it does
  not update itself. `native/packaging/macos/build.sh`; details in `docs/macos-player.md`.

## Install — Windows

Download `ScreenTinker-Setup-<version>.exe` from your server (`https://your-server/download/win`) and
run it, or roll it out silently:

```
ScreenTinker-Setup-X.Y.Z.exe /VERYSILENT /SUPPRESSMSGBOXES /SERVER=https://your-server [/NAME="Lobby"] [/ALLOWPACKAGES=1]
```

It installs the player to Program Files, the **ScreenTinkerHelper** service (LocalSystem), a firewall
rule for the LAN trigger/control ports, and `%ProgramData%\ScreenTinker\config.json` (admin-only).
The helper starts the player full screen in the signed-in user's session and restarts it if it dies,
so a kiosk PC needs **automatic sign-in** (netplwiz / Autologon) and nothing else. An upgrade keeps
the configuration and the pairing. "Exit player" on the on-screen menu stops the relaunching until the
next sign-in.

## What it does (parity with the Android app)

Everything the Android player declares, plus `system.pty`. The authoritative, per-row status is
`docs/player-parity.md`.

- Playback: images, video (incl. HLS/RTSP live streams), widgets, YouTube, HTML bundles, multi-zone
  layouts, GL transitions (the shared library, baked for Qt with `qsb`), PiP, slide voiceover and music.
- Scheduling: per-item dayparts, date windows, `play_when` conditions, shuffle/weighted order, default
  (standby) content — all from the shared, vector-tested evaluators.
- Offline: resumable, revision-keyed media cache; cold start from the cached playlist; proof-of-play
  queued while offline and replayed on reconnect.
- Sync: video walls (leader/follower) and clock-scheduled group sync, on the server-disciplined clock.
- LAN: UDP/HTTP triggers with priority/hold/lease, and the local control API.
- Remote: screenshots, the live remote view, touch/key input, WebRTC live video and intercom.
- Device: reboot, shutdown, screen on/off (backlight, HDMI-CEC, DPMS and an always-black overlay),
  volume, per-window and system brightness (backlight / DDC-CI), time and timezone, the display power
  schedule, `set_server_url` with verify-and-rollback, `http_request` from the panel's own network,
  kiosk lock, block-uninstall, one-shot shell and an **interactive terminal**, self-update and
  package install.

## Security model

- **Windows:** everything that needs SYSTEM goes to the ScreenTinkerHelper service over a named pipe
  with a fixed verb list, and **only the installed `ScreenTinker.exe` may call it** — another program
  running as the same user (including the dashboard's own remote shell) is refused. An installer runs
  only if its sha256 matches what the ADMIN-configured server announces (the helper asks the server
  itself); anything else needs `/ALLOWPACKAGES=1`. See `docs/windows-native-player.md`.
- The remote shell and the interactive terminal run as the player's user.
- `http_request` refuses cloud-metadata addresses before and after DNS resolution and pins the
  connection to the vetted address.

## Development

```sh
cd native
pip install PySide6-Essentials PySide6-Addons 'python-socketio[asyncio_client]' aiohttp pytest
python3 -m pytest -q                               # logic ports (shared vectors) + player units
# ⚠️ On a workstation, run players SILENT and away from the host mixer:
export ST_TEST_NO_SYSTEM_AUDIO=1 PULSE_SERVER=unix:/nonexistent PIPEWIRE_REMOTE=/nonexistent
QT_QPA_PLATFORM=offscreen python3 -m screentinker_native --server http://localhost:3001 \
    --state-dir /tmp/st-dev --windowed -v          # headless (software scene graph: transitions crossfade)
```

Windows (on a Windows machine with Python 3.12 x64 and Inno Setup 6):

```powershell
powershell -ExecutionPolicy Bypass -File native\packaging\windows\build.ps1 [-Version X.Y.Z]
# -> native\dist\ScreenTinker-Setup-<VERSION>.exe (served at /download/win, /api/win/update/check)
```

Layout:

```
screentinker_native/
  app.py            process wiring: Qt thread + network thread, the single command dispatch
  net/link.py       the device socket (Android WebSocketService discipline)
  net/triggers.py   LAN triggers + local API        net/device_http.py  http_request + endpoints
  player/           engine (layouts, sync), controller (PlaylistController port), cache, transitions
  system/           display power, audio, brightness, shell + PTY, power schedule, updater, root helper door
  logic/            pure ports held to shared/*-vectors.json and the Kotlin unit tests
  ui/               Stage (QML bridge), QML scene, slide audio, trigger overlay, WebRTC page
packaging/          the Windows installer, the macOS app bundle, the audience-counting add-on
```
