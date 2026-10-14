'use strict';

/*
 * 3.0 screen share — END TO END in a real browser, with real media.
 *
 * A real server, a real web player page (/player, paired by seeding its storage) and a real sharer
 * page in headless Chrome with fake capture (--use-fake-ui-for-media-stream
 * --use-fake-device-for-media-stream: getDisplayMedia returns Chrome's synthetic "screen"). Asserts
 * what a person in the room would see:
 *
 *   1. the screen shows a meeting-room code; a guest types it on /share and presents;
 *   2. the screen plays the stream fullscreen in a <video> (frames decoded, time advancing) with a
 *      "Shared by <name> · guest" badge, and the sharer's page says it is live;
 *   3. Stop on the sharer's page takes the overlay off the screen and a NEW code comes back;
 *   4. an editor's dashboard-style share (API start + the same client module) also plays, and the
 *      owner's stop (DELETE) ends it on the screen.
 *
 * SKIPS cleanly when no Chrome/Chromium or puppeteer-core is available, so CI without a browser stays
 * green. Peer-to-peer over loopback: no STUN/TURN involved (ICE servers are cleared for the test).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { freePort } = require('./helpers/free-port');

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return null;
}
function findPuppeteer() {
  try { return require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core')); } catch { return null; }
}
const CHROME = process.env.SBX_NO_BROWSER ? null : findChromium();
const puppeteer = findPuppeteer();
const SKIP = !CHROME || !puppeteer ? (!puppeteer ? 'puppeteer-core not installed' : 'no chromium binary found') : false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, BASE, DATA_DIR, LOG, browser;
let owner;
const DEV = crypto.randomUUID();
const TOK = 'devtok_' + crypto.randomBytes(16).toString('hex');

const run = (sql, ...a) => { const r = new (require('better-sqlite3'))(path.join(DATA_DIR, 'db', 'remote_display.db')); try { return r.prepare(sql).run(...a); } finally { r.close(); } };

async function waitFor(fn, ms = 20000, what = 'condition') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
    await sleep(150);
  }
}

before(async () => {
  if (SKIP) return;
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-share-e2e-'));
  LOG = path.join(DATA_DIR, 'server.log');
  const PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  const logFd = fs.openSync(LOG, 'a');
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    // No STUN: two peers on loopback need only host candidates, and a test must not phone out.
    env: { ...process.env, DATA_DIR, SELF_HOSTED: 'true', PORT: String(PORT), NODE_ENV: 'test', GO2RTC_STUN_URLS: ' ' },
    stdio: ['ignore', logFd, logFd],
  });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    try { up = (await fetch(BASE + '/api/status')).ok; } catch { /* booting */ }
    if (!up) await sleep(250);
  }
  if (!up) throw new Error('server did not boot: ' + fs.readFileSync(LOG, 'utf8').slice(-2000));
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `owner-${Date.now()}@e2e.test`, password: 'Passw0rd123', name: 'Olive Owner' }),
  });
  const b = await r.json();
  owner = { token: b.token, id: b.user.id, ws: b.current_workspace_id };
  run("INSERT INTO devices (id, user_id, workspace_id, name, pairing_code, status, device_token, screen_share_guest) VALUES (?, ?, ?, 'Boardroom TV', ?, 'offline', ?, 1)",
    DEV, owner.id, owner.ws, crypto.randomUUID().slice(0, 6), TOK);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--autoplay-policy=no-user-gesture-required',
      // Both pages share one browser; keep the background one running at full speed.
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ],
  });
});

after(async () => {
  try { if (browser) await browser.close(); } catch { /* */ }
  if (proc) await new Promise((r) => { proc.once('exit', r); proc.kill('SIGKILL'); });
  if (DATA_DIR) fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function openPlayer() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument((cfg) => {
    try { localStorage.setItem('rd_web_player', JSON.stringify(cfg)); } catch (_) { /* */ }
  }, { serverUrl: BASE, deviceId: DEV, deviceToken: TOK, paired: true });
  await page.goto(BASE + '/player', { waitUntil: 'domcontentloaded' });
  return page;
}

/** What the player's share <video> is doing right now. */
function videoState(page) {
  return page.evaluate(() => {
    const v = document.getElementById('st-share-video');
    const o = document.getElementById('st-share-overlay');
    if (!v || !o) return null;
    const r = o.getBoundingClientRect();
    return {
      readyState: v.readyState, paused: v.paused, w: v.videoWidth, h: v.videoHeight, t: v.currentTime,
      overlayW: r.width, overlayH: r.height,
      badge: (document.getElementById('st-share-badge') || {}).textContent || '',
    };
  });
}

async function assertPlaying(page, label) {
  const s1 = await waitFor(async () => {
    const s = await videoState(page);
    return s && s.readyState >= 2 && s.w > 0 && !s.paused ? s : null;
  }, 25000, label + ': a playing <video> on the screen');
  await sleep(1200);
  const s2 = await videoState(page);
  assert.ok(s2.t > s1.t, `${label}: video time advances (${s1.t} -> ${s2.t})`);
  assert.equal(s2.overlayW, 1280, 'fullscreen overlay');
  assert.equal(s2.overlayH, 720);
  return s2;
}

test('a guest presents with the code on the screen; the screen plays it; Stop puts the content back', { skip: SKIP, timeout: 120000 }, async () => {
  const player = await openPlayer();
  const codeText = () => player.evaluate(() => {
    const el = document.getElementById('st-share-code');
    const c = el && el.querySelector('[data-share-code]');
    return el && el.style.display !== 'none' && c ? c.textContent : null;
  });
  const code = await waitFor(codeText, 30000, 'the meeting-room code on the screen');
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const qr = await player.evaluate(() => document.querySelector('#st-share-code img').src);
  assert.match(qr, /^data:image\/png;base64,/);

  const guest = await browser.newPage();
  await guest.goto(BASE + '/share', { waitUntil: 'domcontentloaded' });
  await guest.waitForSelector('#shareCode');
  await guest.type('#shareCode', code.toLowerCase());
  await guest.type('#shareName', 'Erin');
  await guest.click('#shareGo');

  const st = await assertPlaying(player, 'guest share');
  assert.match(st.badge, /Erin/);
  assert.match(st.badge, /guest/);
  await waitFor(() => guest.evaluate(() => !document.getElementById('shareLive').hidden
    && document.getElementById('shareLive').classList.contains('on')), 15000, 'the sharer page says live');
  // While someone is sharing, the screen offers no code.
  assert.equal(await codeText(), null);

  await guest.click('#shareStop');
  await waitFor(async () => (await videoState(player)) === null, 10000, 'the overlay to leave the screen');
  const next = await waitFor(codeText, 10000, 'a fresh code after the share');
  assert.notEqual(next, code, 'the used code is never shown again');
  await waitFor(() => guest.evaluate(() => !document.getElementById('shareForm').hidden), 5000, 'the guest page back on its form');
  await guest.close();
  await player.close();
});

test('an editor\'s share (API start + the dashboard client) plays; the owner\'s stop ends it on the screen', { skip: SKIP, timeout: 120000 }, async () => {
  const player = await openPlayer();
  await waitFor(() => player.evaluate(() => !!document.getElementById('st-share-code') && document.getElementById('st-share-code').style.display !== 'none'), 30000, 'player registered');
  const start = await fetch(`${BASE}/api/screen-share/devices/${DEV}`, {
    method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'X-Workspace-Id': owner.ws, 'Content-Type': 'application/json' }, body: '{}',
  });
  const body = await start.json();
  assert.equal(start.status, 201, JSON.stringify(body));

  const sharer = await browser.newPage();
  await sharer.goto(BASE + '/share', { waitUntil: 'domcontentloaded' });
  await sharer.evaluate(async (b) => {
    const m = await import('/js/lib/screen-share-client.js');
    const stream = await m.pickScreen({ audio: false });
    window.__ended = null;
    window.__states = [];
    window.__sender = new m.ScreenShareSender({
      ticket: b.ticket, wsPath: b.ws_path, iceServers: b.ice_servers, stream,
      onState: (s) => window.__states.push(s), onEnded: (r) => { window.__ended = r; },
    });
    window.__sender.start();
  }, body);

  const st = await assertPlaying(player, 'editor share');
  assert.match(st.badge, /Olive Owner/);
  assert.doesNotMatch(st.badge, /guest/);
  await waitFor(() => sharer.evaluate(() => window.__states.includes('live')), 10000, 'sender state live');

  const del = await fetch(`${BASE}/api/screen-share/devices/${DEV}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'X-Workspace-Id': owner.ws },
  });
  assert.deepEqual(await del.json(), { stopped: true });
  await waitFor(async () => (await videoState(player)) === null, 10000, 'the overlay to leave the screen');
  assert.equal(await waitFor(() => sharer.evaluate(() => window.__ended), 5000, 'sender ended'), 'stopped_by_owner');
  const tracksLive = await sharer.evaluate(() => window.__sender.stream.getTracks().some((t) => t.readyState === 'live'));
  assert.equal(tracksLive, false, 'the capture is stopped when the share ends');
  await sharer.close();
  await player.close();
});
