'use strict';

// Pixel: "Reset or replace player" on a screen's page.
//
// Resetting lets the screen's player go and keeps everything else, so the screen can wait for a new
// player while its playlists and schedules are prepared. Attaching hands the screen to whichever
// player is showing a pairing code. Replacing a working player has to be confirmed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-player-reset-'));
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = 'test-secret-player-reset';

const express = require('express');
const { db } = require('../db/database');
const { requireAuth, generateToken } = require('../middleware/auth');

const U = 'u-px', O = 'o-px', WS = 'ws-px';
db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, 'px@test.local', 'x', 'user')").run(U);
db.prepare('INSERT INTO organizations (id, name, owner_user_id) VALUES (?, ?, ?)').run(O, 'org', U);
db.prepare('INSERT INTO workspaces (id, organization_id, name) VALUES (?, ?, ?)').run(WS, O, 'ws');
db.prepare("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'org_owner')").run(O, U);

function screen(id, { token = 'tok-' + id, fingerprint = 'fp-' + id } = {}) {
  db.prepare(`INSERT INTO devices (id, name, workspace_id, user_id, status, device_token, settings_pin, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'online', ?, '123456', strftime('%s','now'), strftime('%s','now'))`).run(id, 'Reception ' + id, WS, U, token);
  if (fingerprint) db.prepare('INSERT INTO device_fingerprints (fingerprint, device_id, user_id) VALUES (?, ?, ?)').run(fingerprint, id, U);
  db.prepare(`INSERT INTO schedules (id, user_id, device_id, title, start_time, end_time) VALUES (?, ?, ?, 'Mornings', '2026-01-01T08:00', '2026-01-01T12:00')`)
    .run('sch-' + id, U, id);
}

// A player showing a pairing code: an unclaimed row, as every app and the web player make one.
function waitingPlayer(id, code) {
  db.prepare(`INSERT INTO devices (id, pairing_code, device_token, status, last_heartbeat, created_at)
              VALUES (?, ?, ?, 'provisioning', strftime('%s','now'), strftime('%s','now'))`).run(id, code, 'tok-' + id);
  db.prepare('INSERT INTO device_fingerprints (fingerprint, device_id) VALUES (?, ?)').run('fp-' + id, id);
}

const sent = [];
const connected = new Set();   // device rooms with a player socket in them
const io = {
  of: (ns) => ({
    to: (room) => ({ emit: (event, payload) => sent.push({ ns, room, event, payload }) }),
    in: () => ({ disconnectSockets: () => {} }),
    adapter: { rooms: { get: (room) => (ns === '/device' && connected.has(room) ? new Set(['sock']) : undefined) } },
  }),
};

// The device socket publishes its playlist builder when the server sets it up; this test has no server.
require('../ws/deviceSocket').buildPlaylistPayload = (id) => ({ device_id: id });

const app = express();
app.use(express.json());
app.set('io', io);
app.use('/api/devices', requireAuth, require('../routes/devices'));
const server = app.listen(0);
const token = generateToken(db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(U), WS);

async function post(url, body = {}) {
  await new Promise(r => (server.listening ? r() : server.once('listening', r)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/devices${url}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const row = (id) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id);

test('reset lets the player go and keeps the screen, its schedules and its settings', async () => {
  screen('a');
  sent.length = 0;
  const r = await post('/a/detach-player');
  assert.equal(r.status, 200);
  assert.equal(r.body.player_attached, false);
  assert.equal(r.body.device_token, undefined);
  const d = row('a');
  assert.equal(d.device_token, null);
  assert.equal(d.status, 'offline');
  assert.equal(d.name, 'Reception a');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM device_fingerprints WHERE device_id = ?').get('a').n, 0, 'old hardware cannot reclaim it');
  assert.ok(db.prepare('SELECT 1 FROM schedules WHERE id = ?').get('sch-a'), 'schedule kept');
  assert.ok(sent.some(s => s.ns === '/device' && s.room === 'a' && s.event === 'device:unpaired' && s.payload.reason === 'deleted'));
});

test('a reset screen takes the player showing a pairing code, with no confirmation', async () => {
  waitingPlayer('p1', '482913');
  connected.add('p1');
  sent.length = 0;
  const r = await post('/a/attach-player', { pairing_code: '482913' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, 'p1', 'the screen moves to the player\'s id');
  assert.equal(r.body.player_attached, true);
  assert.equal(row('a'), undefined);
  const d = row('p1');
  assert.equal(d.name, 'Reception a');
  assert.equal(d.workspace_id, WS);
  assert.equal(d.pairing_code, null);
  assert.notEqual(d.status, 'provisioning', 'not swept as an unclaimed screen');
  assert.equal(db.prepare('SELECT device_id FROM schedules WHERE id = ?').get('sch-a').device_id, 'p1', 'schedule follows the screen');
  assert.ok(sent.some(s => s.room === 'p1' && s.event === 'device:paired'));
  assert.ok(sent.some(s => s.room === 'p1' && s.event === 'device:playlist-update'), 'the new player gets the screen\'s content without a reload');
});

test('replacing a working player has to be confirmed, then the old player is let go', async () => {
  screen('b');
  waitingPlayer('p2', '771204');
  const refused = await post('/b/attach-player', { pairing_code: '771204' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'has_player');
  assert.ok(row('b'), 'nothing changed');

  sent.length = 0;
  const r = await post('/b/attach-player', { pairing_code: '771204', replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, 'p2');
  assert.equal(row('p2').name, 'Reception b');
  assert.equal(db.prepare('SELECT device_id FROM device_fingerprints WHERE fingerprint = ?').get('fp-b'), undefined, 'old hardware cannot reclaim it');
  assert.equal(db.prepare('SELECT device_id FROM device_fingerprints WHERE fingerprint = ?').get('fp-p2').device_id, 'p2');
  assert.ok(sent.some(s => s.room === 'b' && s.event === 'device:unpaired'));
});

test('an unknown pairing code changes nothing', async () => {
  screen('c');
  const r = await post('/c/attach-player', { pairing_code: '000001', replace: true });
  assert.equal(r.status, 404);
  assert.equal(row('c').device_token, 'tok-c');
  assert.equal(db.prepare('SELECT device_id FROM device_fingerprints WHERE fingerprint = ?').get('fp-c').device_id, 'c');
});

test('a code from a screen already in use is refused', async () => {
  screen('d');
  db.prepare("UPDATE devices SET pairing_code = '555123' WHERE id = 'c'").run();
  const r = await post('/d/attach-player', { pairing_code: '555123', replace: true });
  assert.equal(r.status, 409);
  assert.ok(row('c') && row('d'));
});

test('the layout, its zone content, orientation, playlist and video wall place survive a reset and a new player', async () => {
  screen('l');
  db.prepare("INSERT INTO layouts (id, user_id, name) VALUES ('lay-1', ?, 'Split')").run(U);
  db.prepare("INSERT INTO layout_zones (id, layout_id, name) VALUES ('zone-1', 'lay-1', 'Left')").run();
  db.prepare("INSERT INTO playlists (id, user_id, workspace_id, name) VALUES ('pl-1', ?, ?, 'Menu')").run(U, WS);
  db.prepare("UPDATE devices SET layout_id = 'lay-1', orientation = 'portrait', playlist_id = 'pl-1' WHERE id = 'l'").run();
  db.prepare("INSERT INTO video_walls (id, user_id, name, grid_cols, grid_rows, bezel_h_mm, bezel_v_mm, screen_w_mm, screen_h_mm, sync_mode, workspace_id) VALUES ('wall-1', ?, 'Foyer', 2, 1, 0, 0, 1000, 560, 'leader', ?)").run(U, WS);
  db.prepare("INSERT INTO video_wall_devices (wall_id, device_id, grid_col, grid_row, rotation) VALUES ('wall-1', 'l', 1, 0, 0)").run();
  const asId = db.prepare("INSERT INTO assignments (device_id, zone_id, sort_order) VALUES ('l', 'zone-1', 0)").run().lastInsertRowid;

  assert.equal((await post('/l/detach-player')).status, 200);
  let d = row('l');
  assert.deepEqual([d.layout_id, d.orientation, d.playlist_id], ['lay-1', 'portrait', 'pl-1'], 'kept while it waits');

  waitingPlayer('p3', '310457');
  const r = await post('/l/attach-player', { pairing_code: '310457' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  d = row('p3');
  assert.deepEqual([d.layout_id, d.orientation, d.playlist_id], ['lay-1', 'portrait', 'pl-1'], 'kept on the new player');
  assert.equal(db.prepare('SELECT device_id FROM assignments WHERE id = ?').get(asId).device_id, 'p3', 'zone content follows the screen');
  assert.deepEqual(db.prepare("SELECT device_id, grid_col FROM video_wall_devices WHERE wall_id = 'wall-1'").get(), { device_id: 'p3', grid_col: 1 }, 'wall place follows the screen');
});

test.after(() => server.close());
