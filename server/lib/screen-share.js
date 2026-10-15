'use strict';
/*
 * 3.0: "Share your screen to a TV" — the signalling relay and session state (docs/screen-share.md).
 *
 * A person's browser (the SHARER: an editor on the dashboard, or a guest in a meeting room with the
 * code the screen shows) sends its getDisplayMedia() stream straight to a screen (the PLAYER) over
 * peer-to-peer WebRTC. This server never touches the media. It only:
 *
 *   1. decides who may share to which screen (routes/screen-share.js, routes/screen-share-guest.js),
 *   2. hands the sharer a single-use TICKET for this one session,
 *   3. pairs two WebSockets — the sharer's and the screen's — and relays the SDP offer/answer and
 *      ICE candidates between them, validated and rebuilt field by field (never passed through),
 *   4. ends the session when either side leaves, an owner stops it, or the maximum duration passes.
 *
 * WHY PEER-TO-PEER AND NOT THE go2rtc SIDECAR that live video and Talk use: a share has exactly one
 * viewer (the screen), so a restreamer buys nothing, and go2rtc is optional and off by default — a
 * feature that needs it would not work on a plain self-hosted install. P2P works with no sidecar on
 * a LAN (host candidates), and the org's existing ICE config (lib/org-webrtc.js: per-org TURN/STUN
 * override, else the GO2RTC_STUN/TURN globals) covers NAT for the rest.
 *
 * WHY TWO WEBSOCKETS rather than the Socket.IO namespaces: a guest has no account and so no
 * dashboard socket, and one relay shape for both sharer kinds is one thing to secure. The screen's
 * leg is a WebSocket too (authenticated with its device_token in the FIRST MESSAGE, not the URL, so
 * the token never lands in an access log) and speaks go2rtc's own message shape
 * ({type:'webrtc/offer'|'webrtc/answer'|'webrtc/candidate', value}) so the native Android talk leg
 * could later reuse its signalling code unchanged. The screen is told to open that leg over its
 * existing Socket.IO connection (device:screenshare-start).
 *
 * The screen OFFERS (recvonly video + audio) and the sharer ANSWERS with its tracks. That way the
 * screen — the side that can be relied on to exist and be online — drives the negotiation, and the
 * sharer's page only ever reacts.
 *
 * ⚠️ STATE IS IN MEMORY, in the process the screen is connected to. A share needs the sharer's
 * WebSocket and the screen's to land on the same process; on a scale-out replica the screens stay
 * on the primary, so the sharer must reach the primary too (docs/screen-share.md, "Limits").
 */
const crypto = require('crypto');
const WebSocket = require('ws');
const config = require('../config');
const { db } = require('../db/database');
const playerCapabilities = require('./player-capabilities');
const { audit } = require('./audit');

const CAP = 'remote.screen_share';

// A ticket must be used (sharer WebSocket opened and authenticated) within this long of being minted.
const TICKET_TTL_MS = 60 * 1000;
// After the sharer connects, the screen has this long to open its leg before we give up.
const DEVICE_JOIN_MS = 20 * 1000;
// Each WebSocket must authenticate (first message) within this long, or it is closed.
const AUTH_MS = 10 * 1000;
// Liveness ping on both legs; a peer that misses two is gone (a laptop lid closed mid-share).
const PING_MS = 15 * 1000;
// Meeting-room codes rotate this often even if nobody uses them, and after every successful join.
const CODE_TTL_MS = 10 * 60 * 1000;
// Bounds on what the relay will carry. An SDP is a few KB; a candidate line is ~150 bytes.
const MAX_SDP = 64 * 1024;
const MAX_CANDIDATE = 1024;
const MAX_CANDIDATES_PER_LEG = 200;
const MAX_NAME = 40;

/*
 * The code alphabet: Crockford base32 — no I, L, O or U, so a code read off a TV across a room is
 * not ambiguous, and input normalisation (normaliseCode) forgives the look-alikes. 8 characters is
 * 40 bits: with 10 guesses a minute per address (server.js) and a code that changes every ten
 * minutes, guessing one is not a practical attack even across a building full of screens.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 8;

const sessions = new Map();    // session id -> session
const byDevice = new Map();    // device id  -> session (one share per screen)
const codes = new Map();       // device id  -> { code, expiresAt }
const codeIndex = new Map();   // code       -> device id
const origins = new Map();     // device id  -> the origin that screen reaches us on (for its QR)
// share id -> the DISPLAYS (never mirrors) the share was started for. What lets a mirror that
// connects mid-share join it (joinLiveShare): only a mirror of one of these displays may.
const shareDisplays = new Map();
let deviceNs = null;
let sweepTimer = null;

// ------------------------------------------------------------------------------------------------
// Gates
// ------------------------------------------------------------------------------------------------

function featureOn() { return !!config.screenShareEnabled; }
function workspaceOn(ws) { return !!ws && ws.screen_share_enabled !== 0; }
function maxSeconds() { return Math.round((config.screenShareMaxMinutes || 60) * 60); }

// Is a player connected to THIS process right now? The room is the truth for "can we reach it";
// the devices.status column lags by the offline debounce.
function isOnline(deviceId) {
  try {
    if (deviceNs && deviceNs.adapter && deviceNs.adapter.rooms) {
      const room = deviceNs.adapter.rooms.get(deviceId);
      if (room && room.size > 0) return true;
    }
  } catch (_) { /* fall through */ }
  return false;
}

/*
 * Whether this screen can be shared to right now, and if not, why — the reason is what the
 * dashboard shows, so each is distinct: 'disabled' (server), 'workspace_disabled', 'unsupported'
 * (the player does not declare remote.screen_share), 'offline', 'busy'.
 */
function availability(device, workspace) {
  if (!featureOn()) return { ok: false, reason: 'disabled' };
  if (!workspaceOn(workspace)) return { ok: false, reason: 'workspace_disabled' };
  if (!playerCapabilities.supports(device, CAP)) return { ok: false, reason: 'unsupported' };
  if (!isOnline(device.id)) return { ok: false, reason: 'offline' };
  if (byDevice.has(device.id)) return { ok: false, reason: 'busy' };
  return { ok: true };
}

function iceServersFor(deviceId) {
  try { return require('./org-webrtc').iceServersForDevice(deviceId); } catch (_) { return []; }
}

// A display name a person typed. Control characters out, whitespace collapsed, bounded. It is only
// ever rendered with textContent (player badge, dashboard via esc()), but it is also written to the
// audit log, so it is cleaned here once.
function cleanName(raw, fallback) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || fallback;
}

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

// ------------------------------------------------------------------------------------------------
// Sessions
// ------------------------------------------------------------------------------------------------

/*
 * Mint a session and its single-use ticket. The caller has already checked access and
 * availability(); this re-checks busy so two simultaneous starts cannot both win.
 *
 * opts: { device, workspace, sharedBy, userId, guest, ip, audio }
 * returns { session, ticket } or { error: 'busy' }
 */
function createSession(opts) {
  const { device, workspace } = opts;
  if (byDevice.has(device.id)) return { error: 'busy' };
  const ticket = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const s = {
    id,
    // Multi share: every screen of one share carries the same shareId; a one-screen share is its
    // own share (shareId === id), so nothing that predates multi share changes.
    shareId: opts.shareId || id,
    deviceId: device.id,
    deviceName: device.name || '',
    workspaceId: workspace.id,
    sharedBy: cleanName(opts.sharedBy, 'Guest'),
    userId: opts.userId || null,
    guest: !!opts.guest,
    ip: opts.ip || null,
    audio: !!opts.audio,
    ticketHash: sha256(ticket),
    ticketUsed: false,
    createdAt: Date.now(),
    startedAt: null,
    live: false,
    sharer: null,
    device: null,
    deviceCandidates: 0,
    sharerCandidates: 0,
    offerSeen: false,
    answerSeen: false,
    pendingToDevice: [],
    timers: {},
    ended: false,
  };
  sessions.set(s.id, s);
  byDevice.set(device.id, s);
  if (!mirrorsLib().sourceOf(device.id)) {
    if (!shareDisplays.has(s.shareId)) shareDisplays.set(s.shareId, new Set());
    shareDisplays.get(s.shareId).add(device.id);
  }
  s.timers.ticket = setTimeout(() => endSession(s, 'not_connected'), TICKET_TTL_MS);
  unrefTimer(s.timers.ticket);
  audit(s.guest ? 'screen_share.guest_join' : 'screen_share.start', {
    userId: s.userId, workspaceId: s.workspaceId, deviceId: s.deviceId, ip: s.ip,
    details: { session_id: s.id, share_id: s.shareId, shared_by: s.sharedBy, guest: s.guest, audio: s.audio },
  });
  // The badge on the screen must not offer a code while it is busy.
  /*
   * A code must never outlive a share it could have been seen next to. A share on the display drops
   * the code for the display and all its mirrors (currentCode: busy -> none) and a NEW one is minted
   * when it ends. A share on one MIRROR alone leaves the display free, so the family keeps offering a
   * code — but a fresh one, minted now, and again when that share ends (endSession).
   */
  const src = codeSource(device.id);
  s.onMirrorAlone = src !== device.id && !byDevice.has(src) && !(shareDisplays.get(s.shareId) || new Set()).has(src);
  if (s.onMirrorAlone) dropCode(src);
  if (s.guest || codes.has(src) || src !== device.id) pushCode(device.id);
  return { session: s, ticket };
}

// Lazy, like every other cross-module require here: keeps the load order free of cycles.
function mirrorsLib() { return require('./mirrors'); }

function unrefTimer(t) { try { if (t && t.unref) t.unref(); } catch (_) {} }

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(msg)); } catch (_) {} }
}

/*
 * End a session for any reason. Idempotent. Tells both sides, closes both legs, tells the screen
 * over Socket.IO as well (its WebSocket may already be gone, and the player must put its content
 * back either way), audits, and re-publishes the meeting-room code so the badge returns.
 */
function endSession(s, reason, by) {
  if (!s || s.ended) return;
  s.ended = true;
  for (const t of Object.values(s.timers)) { try { clearTimeout(t); clearInterval(t); } catch (_) {} }
  send(s.sharer, { type: 'ended', reason });
  send(s.device, { type: 'ended', reason });
  try { if (s.sharer) s.sharer.close(1000, 'ended'); } catch (_) {}
  try { if (s.device) s.device.close(1000, 'ended'); } catch (_) {}
  sessions.delete(s.id);
  if (!sessionsForShare(s.shareId).length) shareDisplays.delete(s.shareId);
  if (byDevice.get(s.deviceId) === s) byDevice.delete(s.deviceId);
  if (deviceNs) { try { deviceNs.to(s.deviceId).emit('device:screenshare-stop', { session_id: s.id, reason }); } catch (_) {} }
  audit('screen_share.stop', {
    userId: (by && by.userId) || null, workspaceId: s.workspaceId, deviceId: s.deviceId, ip: (by && by.ip) || null,
    details: {
      session_id: s.id, reason, shared_by: s.sharedBy, guest: s.guest,
      seconds: s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0,
    },
  });
  const src = codeSource(s.deviceId);
  // A share that ran on a mirror alone (the display free, so it kept a code): fresh code now too.
  if (s.onMirrorAlone && !byDevice.has(src)) dropCode(src);
  if (codes.has(src) || guestEnabled(src)) pushCode(s.deviceId);
}

function sessionForDevice(deviceId) { return byDevice.get(deviceId) || null; }

// What the dashboard may know about a running share. Never the ticket, the IP or the code.
function publicSession(s) {
  if (!s) return null;
  return {
    session_id: s.id, shared_by: s.sharedBy, guest: s.guest, audio: s.audio, live: s.live,
    started_at: s.startedAt || s.createdAt, max_seconds: maxSeconds(),
    // Multi share: which share this screen is part of, and how many screens it is on right now.
    // A display's mirrors (the same display link open somewhere else) ride along with it and are
    // counted apart, so a one-display share with its mirrors still reads as one screen to stop.
    share_id: s.shareId, ...shareCounts(s.shareId),
  };
}

// { screens, mirrors }: legs of a share, with mirrors of a display that is itself in the share
// counted apart.
function shareCounts(shareId) {
  const legs = sessionsForShare(shareId);
  const ids = new Set(legs.map((l) => l.deviceId));
  let mirrorLegs = 0;
  for (const l of legs) { const src = mirrorsLib().sourceOf(l.deviceId); if (src && ids.has(src)) mirrorLegs++; }
  return { screens: Math.max(1, legs.length - mirrorLegs), mirrors: mirrorLegs };
}

function stopForDevice(deviceId, reason, by) {
  const s = byDevice.get(deviceId);
  if (!s) return false;
  endSession(s, reason, by);
  return true;
}

/*
 * The owner's "stop" on a display: its own session AND its mirrors' legs of the same share. The
 * mirrors are that display shown somewhere else, so a share kicked off the display must not keep
 * playing on them. A different share running on a mirror alone is left alone. On a mirror (which
 * has no mirrors) this is stopForDevice.
 */
function stopForDisplay(deviceId, reason, by) {
  const s = byDevice.get(deviceId);
  if (!s) return false;
  const shareId = s.shareId;
  endSession(s, reason, by);
  for (const m of mirrorsLib().mirrorsOf(deviceId)) {
    const ms = byDevice.get(m.id);
    if (ms && ms.shareId === shareId) endSession(ms, reason, by);
  }
  return true;
}

// ------------------------------------------------------------------------------------------------
// Multi share: one person's screen on several screens at once
// ------------------------------------------------------------------------------------------------
/*
 * A multi share is N ordinary sessions — one per screen, each with its own single-use ticket, its
 * own sharer WebSocket and its own screen leg — that carry the same shareId. Nothing in the relay
 * changes: a screen authenticates exactly as before, and a leg can only ever talk to the one screen
 * its ticket was minted for (per-leg isolation is the relay's existing ticket ↔ session binding).
 * The sharer's browser keeps one capture and one RTCPeerConnection per screen.
 *
 * What the shareId adds: the owner can stop ALL screens of a share at once, the dashboard can say
 * "on 4 screens", and a screen that drops out ends only its own session — the others keep going.
 *
 * WHY A LIMIT (SCREEN_SHARE_MAX_TARGETS, default 6): every screen is a separate upload from the
 * sharer's computer, ~1-3 Mbit/s each for a screen. Beyond a handful a laptop on office Wi-Fi
 * cannot keep up and every screen degrades together. A whole floor of screens wants ONE upload to a
 * restreamer that fans out (the go2rtc sidecar live video uses) — not implemented here; see
 * docs/screen-share.md, "Sharing to many screens".
 */
function maxTargets() { return Math.max(1, Math.min(50, Number(config.screenShareMaxTargets) || 6)); }

function sessionsForShare(shareId) {
  if (!shareId) return [];
  return [...sessions.values()].filter((s) => s.shareId === shareId && !s.ended);
}

/*
 * The screens a share to `deviceIds` must reach, in order, without duplicates. Returns
 * [{ id, via }] where via is null for a screen that was asked for and 'mirror' for one added because
 * it mirrors one that was.
 *
 * Each requested screen's MIRRORS (lib/mirrors.js: the same display link open somewhere else) are
 * added after it, so sharing to a display also reaches the places it is showing. Every caller
 * treats a 'mirror' entry as best-effort (skipped, not refused, when the sharer cannot reach it).
 */
function expandShareTargets(deviceIds) {
  const out = [];
  const seen = new Set();
  const add = (id, via) => { const k = String(id || ''); if (k && !seen.has(k)) { seen.add(k); out.push({ id: k, via }); } };
  for (const id of deviceIds || []) {
    add(id, null);
    const mirrors = mirrorsLib().mirrorsOf(id);
    for (const m of mirrors) add(m && m.id ? m.id : m, 'mirror');
  }
  return out;
}

/*
 * A share to ONE display (the dashboard's "Share my screen", a guest's meeting-room code): the
 * display itself, then each of its mirrors that can take it. The caller has already checked access
 * to and availability of the display. A mirror is best-effort: one in another workspace (cannot
 * happen through the socket, but a row could say so) or one `reachable(row)` refuses is left out
 * silently; one that cannot show a share right now (offline, no receiver, busy, past the target
 * limit) is listed in `skipped`. Neither ever refuses the share to the display.
 * returns { targets: [{ device, workspace }], skipped: [{ id, name, ok, reason, platform, mirror }] }
 */
function withMirrors(device, workspace, { reachable } = {}) {
  const targets = [{ device, workspace }];
  const skipped = [];
  for (const t of expandShareTargets([device.id])) {
    if (!t.via) continue;
    const m = db.prepare('SELECT * FROM devices WHERE id = ?').get(t.id);
    if (!m || m.workspace_id !== device.workspace_id) continue;
    if (reachable && !reachable(m)) continue;
    let a = availability(m, workspace);
    if (a.ok && targets.length >= maxTargets()) a = { ok: false, reason: 'too_many_targets' };
    if (!a.ok) {
      skipped.push({ id: m.id, name: m.name || '', ok: false, reason: a.reason, platform: playerCapabilities.platformFamily(m), mirror: true });
      continue;
    }
    targets.push({ device: m, workspace });
  }
  return { targets, skipped };
}

/*
 * The answer to a one-display start (POST /api/screen-share/devices/:id and the guest join): the
 * display's own leg in the top-level fields every caller has always read, plus (additive) the share
 * id, every leg (the display first, then its mirrors) and the mirrors left out. A caller that only
 * knows the top-level ticket still shares to the display exactly as before; the mirror legs it never
 * opens expire unused after TICKET_TTL_MS.
 */
/*
 * Mint the share for a withMirrors() plan. A mirror that turned busy between the plan and now (a
 * race with someone else's start) costs only that mirror: the share goes ahead on the display alone.
 * returns { out: createShare's result, skipped }
 */
function createDisplayShare(plan, opts) {
  const out = createShare({ ...opts, targets: plan.targets });
  const display = plan.targets[0].device;
  if (!out.error || !out.device_id || out.device_id === display.id || plan.targets.length < 2) return { out, skipped: plan.skipped };
  const rest = plan.targets.slice(1).map((t) => ({ id: t.device.id, name: t.device.name || '', ok: false, reason: 'busy', platform: playerCapabilities.platformFamily(t.device), mirror: true }));
  return { out: createShare({ ...opts, targets: [plan.targets[0]] }), skipped: plan.skipped.concat(rest) };
}

function displayShareBody(out, skipped) {
  const legs = out.legs.map((l) => ({
    device_id: l.device.id, screen_name: l.device.name || '', session_id: l.session.id,
    ticket: l.ticket, ice_servers: iceServersFor(l.device.id),
  }));
  const main = legs[0];
  return {
    session_id: main.session_id,
    ticket: main.ticket,
    ws_path: '/api/screen-share/ws',
    ice_servers: main.ice_servers,
    max_seconds: maxSeconds(),
    screen_name: main.screen_name,
    share_id: out.shareId,
    legs,
    skipped: skipped || [],
  };
}

/*
 * Mint one share across targets [{ device, workspace }] (already access-checked and available).
 * All or nothing: if any screen turned busy in between, nothing is left behind.
 * returns { shareId, legs: [{ session, ticket, device }] } or { error }
 */
function createShare(opts) {
  const targets = opts.targets || [];
  if (!targets.length) return { error: 'none_available' };
  if (targets.length > maxTargets()) return { error: 'too_many_targets' };
  const busy = targets.find((t) => byDevice.has(t.device.id));
  if (busy) return { error: 'busy', device_id: busy.device.id };
  // The share id is its FIRST leg's session id, so a share that reached one screen has the shape a
  // one-screen share always had (share_id === session_id), whether or not mirrors joined it.
  let shareId = null;
  const legs = [];
  for (const t of targets) {
    const out = createSession({ ...opts, device: t.device, workspace: t.workspace, shareId: shareId || undefined });
    if (!out.error && !shareId) shareId = out.session.id;
    if (out.error) {
      for (const l of legs) endSession(l.session, 'not_connected');
      return { error: out.error, device_id: t.device.id };
    }
    legs.push({ session: out.session, ticket: out.ticket, device: t.device });
  }
  return { shareId, legs };
}

// Stop every screen of a share (the owner's "stop on all screens"). Returns how many were running.
function stopShare(shareId, reason, by) {
  const all = sessionsForShare(shareId);
  for (const s of all) endSession(s, reason, by);
  return all.length;
}

// The screen dropped off Socket.IO: its share cannot continue and its code means nothing now.
function deviceGone(deviceId) {
  stopForDevice(deviceId, 'screen_offline');
  if (codes.has(deviceId)) {
    dropCode(deviceId);
    // The code was this display's: its mirrors stop offering one nobody can use now.
    emitCode(mirrorsLib().mirrorsOf(deviceId).map((m) => m.id), { code: null });
  }
}

// A workspace switched the feature off: end everything running in it.
function stopWorkspace(workspaceId, reason, by) {
  for (const s of [...sessions.values()]) if (s.workspaceId === workspaceId) endSession(s, reason, by);
  try {
    for (const d of db.prepare('SELECT id FROM devices WHERE workspace_id = ?').all(workspaceId)) {
      if (codes.has(d.id)) { dropCode(d.id); pushCode(d.id); }
    }
  } catch (_) { /* best effort */ }
}

// ------------------------------------------------------------------------------------------------
// Meeting-room codes
// ------------------------------------------------------------------------------------------------

// Should this screen show a meeting-room code? The code switch, the workspace switch, and a player
// that can actually show a share — a code on a screen that would then refuse every guest is a trap.
function guestEnabled(deviceId) {
  if (!featureOn()) return false;
  try {
    const d = db.prepare(`SELECT d.*, w.screen_share_enabled AS ws_share
                          FROM devices d LEFT JOIN workspaces w ON w.id = d.workspace_id WHERE d.id = ?`).get(deviceId);
    return !!(d && d.screen_share_guest && d.ws_share !== 0 && playerCapabilities.supports(d, CAP));
  } catch (_) { return false; }
}

function newCode() {
  let c = '';
  for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return c;
}

// What a person typed -> canonical form. Case, spaces and dashes forgiven; Crockford look-alikes
// mapped (O->0, I/L->1). Anything else that is not in the alphabet makes it not a code.
function normaliseCode(raw) {
  const s = String(raw == null ? '' : raw).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

function dropCode(deviceId) {
  const c = codes.get(deviceId);
  if (c) { codeIndex.delete(c.code); codes.delete(deviceId); }
}

function rotateCode(deviceId) {
  dropCode(deviceId);
  let code;
  do { code = newCode(); } while (codeIndex.has(code));
  const entry = { code, expiresAt: Date.now() + CODE_TTL_MS };
  codes.set(deviceId, entry);
  codeIndex.set(code, deviceId);
  return entry;
}

// The current code for a screen that should show one, minting or rotating as needed; null when the
// screen should show none (feature off, guest sharing off, offline, or a share is running).
function currentCode(deviceId) {
  if (!guestEnabled(deviceId) || !isOnline(deviceId) || byDevice.has(deviceId)) { dropCode(deviceId); return null; }
  const c = codes.get(deviceId);
  if (c && c.expiresAt > Date.now()) return c;
  return rotateCode(deviceId);
}

/*
 * Redeem a typed code. Returns the device id, or null. A redeemed code is spent: the screen gets a
 * fresh one immediately (pushCode), so a code photographed in a meeting is useless afterwards.
 */
function redeemCode(raw) {
  const code = normaliseCode(raw);
  if (!code) return null;
  const deviceId = codeIndex.get(code);
  if (!deviceId) return null;
  const c = codes.get(deviceId);
  if (!c || c.code !== code || c.expiresAt <= Date.now()) { dropCode(deviceId); return null; }
  dropCode(deviceId);
  return deviceId;
}

function formatCode(code) { return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null; }

function emitCode(ids, payload) {
  if (!deviceNs) return;
  for (const id of ids) { try { deviceNs.to(id).emit('device:screenshare-code', payload); } catch (_) {} }
}

// Whose code a screen shows: a mirror shows its display's (lib/mirrors.js); codes are keyed by
// the display only.
function codeSource(deviceId) { return mirrorsLib().sourceOf(deviceId) || deviceId; }

// A mirror shows its display's code unless it is busy with a share of its own, its player cannot
// show a share, or it is (impossibly) in another workspace than the display.
function mirrorShowsCode(mirrorId, srcWorkspaceId) {
  if (byDevice.has(mirrorId)) return false;
  try {
    const m = db.prepare('SELECT * FROM devices WHERE id = ?').get(mirrorId);
    return !!(m && m.workspace_id && m.workspace_id === srcWorkspaceId && playerCapabilities.supports(m, CAP));
  } catch (_) { return false; }
}

/*
 * Tell a display AND every mirror of it what to show in the corner: the code, the address, and a QR
 * for the address with the code in the FRAGMENT (never sent to any server, so it stays out of access
 * logs). `deviceId` may be the display or one of its mirrors; either way the whole family is told.
 * The code is the display's: a guest standing at a mirror who types it presents to the display and
 * all its mirrors (routes/screen-share-guest.js), exactly as from the display itself.
 */
async function pushCode(deviceId) {
  if (!deviceNs) return;
  const src = codeSource(deviceId);
  const family = [src, ...mirrorsLib().mirrorsOf(src).map((m) => m.id)];
  const c = currentCode(src);
  if (!c) { emitCode(family, { code: null }); return; }
  let srcWs = null;
  try { const r = db.prepare('SELECT workspace_id FROM devices WHERE id = ?').get(src); srcWs = r ? r.workspace_id : null; } catch (_) { /* no mirror shows it */ }
  if (!c.qrs) c.qrs = new Map();
  for (const id of family) {
    if (id !== src && !mirrorShowsCode(id, srcWs)) { emitCode([id], { code: null }); continue; }
    // Each screen's own address (the one people in ITS room are most likely to reach), else the display's.
    const origin = origins.get(id) || origins.get(src) || '';
    const url = origin ? `${origin}/share` : '/share';
    // Cached on the code entry per address: a web player re-registers every minute or so, and the
    // image only changes when the code (or the address) does.
    let qr = c.qrs.get(url) || null;
    if (origin && !qr) {
      try { qr = await require('qrcode').toDataURL(`${url}#${c.code}`, { margin: 1, width: 220, errorCorrectionLevel: 'M' }); } catch (_) { qr = null; }
      if (qr && c.qrs.size < 16) c.qrs.set(url, qr);
    }
    // Re-check after the await: the code may have rotated or been redeemed meanwhile.
    const now = codes.get(src);
    if (!now || now.code !== c.code) return;
    emitCode([id], { code: formatCode(c.code), url, qr, expires_at: c.expiresAt });
  }
}

/*
 * A player finished registering. Remember the origin it reached us on (the address people in the
 * same room are most likely to reach too) and tell it its code, if it should show one.
 */
function onDeviceRegistered(deviceId, handshake) {
  try {
    const { publicOrigin } = require('./public-origin');
    const h = (handshake && handshake.headers) || {};
    const fwd = String(h['x-forwarded-proto'] || '').split(',')[0].trim();
    const fakeReq = { get: (n) => h[String(n).toLowerCase()], protocol: (handshake && handshake.secure) || fwd === 'https' ? 'https' : 'http' };
    origins.set(deviceId, publicOrigin(fakeReq));
  } catch (_) { /* the badge can show the path alone */ }
  // A mirror that connects while its display is being shared to joins that share (before the code:
  // a screen in a share shows none).
  try { joinLiveShare(deviceId); } catch (_) { /* never block register */ }
  // A mirror shows its display's code from the moment it connects, not from the next rotation.
  const src = codeSource(deviceId);
  if (guestEnabled(src) || codes.has(src)) pushCode(deviceId);
}

/*
 * A MIRROR that connects (is created, or comes back after a drop) while a share to its display is
 * live joins that share: one more leg, minted here, and handed to the sharer over a signalling
 * socket the sharer already has open for this share ({type:'add_leg', leg}). The sharer's page
 * (MultiShareSender) opens one more peer connection from the same capture, and the new leg goes
 * through the ordinary ticket handshake: nothing about the relay changes.
 *
 * Who may be added is decided HERE and nowhere else: a screen whose lib/mirrors.js original is a
 * display the share was started for (shareDisplays), in that display's workspace, that can take a
 * share right now. The sharer never names a screen — nothing it sends can add one. The target limit
 * holds: a full share skips the mirror and tells the sharer ({type:'leg_skipped'}).
 * Returns the new session, or null.
 */
function joinLiveShare(deviceId) {
  const src = mirrorsLib().sourceOf(deviceId);
  if (!src || byDevice.has(deviceId)) return null;
  let shareId = null;
  const own = byDevice.get(src);
  if (own && (shareDisplays.get(own.shareId) || new Set()).has(src)) shareId = own.shareId;
  else for (const [id, set] of shareDisplays) { if (set.has(src) && sessionsForShare(id).length) { shareId = id; break; } }
  if (!shareId) return null;
  const legs = sessionsForShare(shareId);
  // Someone to tell: a leg whose sharer socket is open. Without one the leg could never be used.
  const via = legs.find((l) => l.deviceId === src && l.sharer && l.sharer.readyState === WebSocket.OPEN)
    || legs.find((l) => l.sharer && l.sharer.readyState === WebSocket.OPEN);
  if (!via) return null;
  const mirror = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  const display = db.prepare('SELECT workspace_id FROM devices WHERE id = ?').get(src);
  if (!mirror || !display || !mirror.workspace_id || mirror.workspace_id !== display.workspace_id) return null;
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(mirror.workspace_id);
  if (!ws) return null;
  const name = mirror.name || '';
  const a = availability(mirror, ws);
  if (!a.ok) {
    // Offline is a register that raced its own disconnect; busy is its own share. Neither is news.
    if (a.reason !== 'offline' && a.reason !== 'busy') send(via.sharer, { type: 'leg_skipped', screen_name: name, reason: a.reason });
    return null;
  }
  if (legs.length >= maxTargets()) {
    send(via.sharer, { type: 'leg_skipped', screen_name: name, reason: 'too_many_targets', max_targets: maxTargets() });
    return null;
  }
  const out = createSession({
    device: mirror, workspace: ws, shareId, sharedBy: via.sharedBy, userId: via.userId,
    guest: via.guest, ip: via.ip, audio: via.audio,
  });
  if (out.error) return null;
  const leg = { session_id: out.session.id, ticket: out.ticket, screen_name: name, ice_servers: iceServersFor(mirror.id) };
  if (!via.guest) leg.device_id = mirror.id;   // a guest is told no device ids (routes/screen-share-guest.js)
  send(via.sharer, { type: 'add_leg', share_id: shareId, leg });
  return out.session;
}

/*
 * Every 30s: rotate codes about to expire, so the TV never shows a dead one, and catch any screen
 * with the code switched on that is online here but holds none (it registered through a path that
 * did not call onDeviceRegistered, or an admin turned the workspace back on).
 */
function sweep() {
  if (!featureOn()) return;
  const now = Date.now();
  for (const [deviceId, c] of [...codes.entries()]) {
    if (c.expiresAt <= now + 1000) { rotateCode(deviceId); pushCode(deviceId); }
  }
  try {
    for (const d of db.prepare('SELECT id FROM devices WHERE screen_share_guest = 1').all()) {
      if (!codes.has(d.id) && !byDevice.has(d.id) && isOnline(d.id)) pushCode(d.id);
    }
  } catch (_) { /* the next sweep tries again */ }
}

// ------------------------------------------------------------------------------------------------
// The relay
// ------------------------------------------------------------------------------------------------

const SHARER_STATES = new Set(['connecting', 'connected', 'failed', 'disconnected']);
const DEVICE_STATES = new Set(['connecting', 'connected', 'playing', 'failed', 'disconnected', 'unsupported']);

function parse(data) {
  if (data == null) return null;
  const s = data.toString();
  if (s.length > MAX_SDP + 1024) return null;
  try { const m = JSON.parse(s); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch (_) { return null; }
}

// Rebuild a candidate from its validated fields. Returns null if it is not a plausible candidate.
function candidateMsg(m) {
  const value = m.value;
  if (typeof value !== 'string' || !value || value.length > MAX_CANDIDATE) return null;
  if (!/^(a=)?candidate:/.test(value)) return null;
  const out = { type: 'webrtc/candidate', value };
  if (typeof m.mid === 'string' && m.mid.length <= 32) out.mid = m.mid;
  if (Number.isInteger(m.mline) && m.mline >= 0 && m.mline < 16) out.mline = m.mline;
  return out;
}

function sdpOk(v) { return typeof v === 'string' && v.length > 0 && v.length <= MAX_SDP && v.startsWith('v=0'); }

function keepAlive(ws, onDead) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const iv = setInterval(() => {
    if (!ws.isAlive) { clearInterval(iv); try { ws.terminate(); } catch (_) {} onDead(); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }, PING_MS);
  unrefTimer(iv);
  return iv;
}

// The sharer's leg. First message must be {type:'auth', ticket}.
function onSharer(ws) {
  let s = null;
  const authTimer = setTimeout(() => { if (!s) { try { ws.close(4001, 'auth timeout'); } catch (_) {} } }, AUTH_MS);
  unrefTimer(authTimer);
  ws.on('message', (data) => {
    const m = parse(data);
    if (!m) return;
    if (!s) {
      if (m.type !== 'auth' || typeof m.ticket !== 'string' || m.ticket.length > 128) { try { ws.close(4001, 'unauthorized'); } catch (_) {} return; }
      const h = sha256(m.ticket);
      const found = [...sessions.values()].find((x) => !x.ended && !x.ticketUsed && crypto.timingSafeEqual(x.ticketHash, h));
      if (!found) { send(ws, { type: 'ended', reason: 'invalid_ticket' }); try { ws.close(4001, 'unauthorized'); } catch (_) {} return; }
      clearTimeout(authTimer);
      s = found;
      s.ticketUsed = true;
      s.sharer = ws;
      s.startedAt = Date.now();
      clearTimeout(s.timers.ticket);
      s.timers.max = setTimeout(() => endSession(s, 'max_duration'), maxSeconds() * 1000);
      unrefTimer(s.timers.max);
      s.timers.join = setTimeout(() => { if (!s.device) endSession(s, 'screen_unreachable'); }, DEVICE_JOIN_MS);
      unrefTimer(s.timers.join);
      s.timers.sharerPing = keepAlive(ws, () => endSession(s, 'sharer_left'));
      send(ws, { type: 'ready', session_id: s.id, max_seconds: maxSeconds() });
      if (!deviceNs || !isOnline(s.deviceId)) { endSession(s, 'screen_unreachable'); return; }
      deviceNs.to(s.deviceId).emit('device:screenshare-start', {
        session_id: s.id, shared_by: s.sharedBy, guest: s.guest, audio: s.audio,
        max_seconds: maxSeconds(), ice_servers: iceServersFor(s.deviceId),
      });
      return;
    }
    if (s.ended) return;
    if (m.type === 'webrtc/answer') {
      if (s.answerSeen || !s.offerSeen || !sdpOk(m.value)) return;
      s.answerSeen = true;
      send(s.device, { type: 'webrtc/answer', value: m.value });
    } else if (m.type === 'webrtc/candidate') {
      if (++s.sharerCandidates > MAX_CANDIDATES_PER_LEG) return;
      const c = candidateMsg(m);
      if (!c) return;
      if (s.device) send(s.device, c); else if (s.pendingToDevice.length < MAX_CANDIDATES_PER_LEG) s.pendingToDevice.push(c);
    } else if (m.type === 'state') {
      if (!SHARER_STATES.has(m.value)) return;
      if (m.value === 'connected') s.live = true;
      if (m.value === 'failed') endSession(s, 'connection_failed');
    } else if (m.type === 'stop') {
      endSession(s, 'stopped_by_sharer');
    }
  });
  ws.on('close', () => { clearTimeout(authTimer); if (s) endSession(s, 'sharer_left'); });
  ws.on('error', () => { try { ws.close(); } catch (_) {} });
}

// The screen's leg. First message must be {type:'auth', device_token, session_id}; the device id
// comes from the URL and must match both the token and the session.
function onDevice(ws, deviceId) {
  let s = null;
  const authTimer = setTimeout(() => { if (!s) { try { ws.close(4001, 'auth timeout'); } catch (_) {} } }, AUTH_MS);
  unrefTimer(authTimer);
  ws.on('message', (data) => {
    const m = parse(data);
    if (!m) return;
    if (!s) {
      if (m.type !== 'auth' || typeof m.device_token !== 'string' || typeof m.session_id !== 'string') { try { ws.close(4001, 'unauthorized'); } catch (_) {} return; }
      let valid = false;
      try { valid = require('../ws/deviceSocket').validateDeviceToken(deviceId, m.device_token); } catch (_) { valid = false; }
      const found = sessions.get(m.session_id);
      if (!valid || !found || found.ended || found.deviceId !== deviceId || !found.sharer || found.device) {
        send(ws, { type: 'ended', reason: 'invalid_session' });
        try { ws.close(4001, 'unauthorized'); } catch (_) {}
        return;
      }
      clearTimeout(authTimer);
      s = found;
      s.device = ws;
      clearTimeout(s.timers.join);
      s.timers.devicePing = keepAlive(ws, () => endSession(s, 'screen_left'));
      send(ws, { type: 'ready', session_id: s.id });
      send(s.sharer, { type: 'screen_joined' });
      return;
    }
    if (s.ended) return;
    if (m.type === 'webrtc/offer') {
      if (s.offerSeen || !sdpOk(m.value)) return;
      s.offerSeen = true;
      send(s.sharer, { type: 'webrtc/offer', value: m.value });
      for (const c of s.pendingToDevice.splice(0)) send(ws, c);
    } else if (m.type === 'webrtc/candidate') {
      if (++s.deviceCandidates > MAX_CANDIDATES_PER_LEG) return;
      const c = candidateMsg(m);
      if (c) send(s.sharer, c);
    } else if (m.type === 'state') {
      if (!DEVICE_STATES.has(m.value)) return;
      if (m.value === 'playing') { s.live = true; send(s.sharer, { type: 'screen_playing' }); }
      if (m.value === 'failed' || m.value === 'unsupported') endSession(s, m.value === 'unsupported' ? 'screen_unsupported' : 'connection_failed');
    }
  });
  ws.on('close', () => { clearTimeout(authTimer); if (s) endSession(s, 'screen_left'); });
  ws.on('error', () => { try { ws.close(); } catch (_) {} });
}

const SHARER_PATH = '/api/screen-share/ws';
const DEVICE_PATH_RE = /^\/api\/devices\/([0-9A-Za-z_-]{1,64})\/screen-share\/ws$/;

function reject(socket, code, text) {
  try { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); } catch (_) {}
  try { socket.destroy(); } catch (_) {}
}

// Claim our two upgrade paths on the shared HTTP server; every other upgrade is left untouched.
function attach(server) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_SDP + 4096 });
  server.on('upgrade', (req, socket, head) => {
    let u;
    try { u = new URL(req.url, 'http://localhost'); } catch (_) { return; }
    const isSharer = u.pathname === SHARER_PATH;
    const dm = isSharer ? null : DEVICE_PATH_RE.exec(u.pathname);
    if (!isSharer && !dm) return;
    if (!featureOn()) return reject(socket, 404, 'Not Found');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (isSharer) onSharer(ws);
      else onDevice(ws, dm[1]);
    });
  });
  return wss;
}

function init(io) {
  deviceNs = io ? io.of('/device') : null;
  if (!sweepTimer) { sweepTimer = setInterval(sweep, 30 * 1000); unrefTimer(sweepTimer); }
}

function _reset() {
  for (const s of [...sessions.values()]) { s.ended = true; for (const t of Object.values(s.timers)) { try { clearTimeout(t); clearInterval(t); } catch (_) {} } }
  sessions.clear(); byDevice.clear(); codes.clear(); codeIndex.clear(); origins.clear(); shareDisplays.clear();
}

module.exports = {
  CAP, CODE_TTL_MS, TICKET_TTL_MS,
  init, attach,
  featureOn, workspaceOn, availability, isOnline, maxSeconds, iceServersFor, cleanName,
  createSession, endSession, stopForDevice, stopForDisplay, stopWorkspace, sessionForDevice, publicSession, deviceGone,
  maxTargets, expandShareTargets, withMirrors, createDisplayShare, displayShareBody, createShare, stopShare, sessionsForShare,
  guestEnabled, currentCode, rotateCode, redeemCode, normaliseCode, formatCode, pushCode, dropCode, onDeviceRegistered, codeSource, joinLiveShare,
  _reset, _sessions: sessions, _codes: codes, _sweep: sweep,
};
