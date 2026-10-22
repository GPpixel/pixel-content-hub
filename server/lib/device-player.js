'use strict';

/*
 * Pixel: reset a screen or swap its player without losing its setup.
 *
 * A screen (a devices row) keeps its name, groups, tags, playlist, layout, schedules, wall place and
 * history. Only the player behind it changes:
 *
 *   detach  The current player is let go: its token, enrolment key and fingerprints are dropped, so
 *           it can't come back as this screen, and it is told it was removed so it shows a new
 *           pairing code. The screen stays, with no player, until one is attached. Everything can
 *           still be edited while it waits.
 *   attach  A player showing a pairing code (any app or the web player) takes the screen over. This
 *           is the org-import "pair into" merge (lib/trust/import-screens.js): the player keeps the
 *           row it made when it asked for a code, receives the screen's settings, every reference to
 *           the screen moves to it, and the old row goes. The screen's id changes; nothing else does.
 */

const { pairInto } = require('./trust/import-screens');

/** True when a player holds this screen's identity. A reset or imported screen has none. */
function hasPlayer(device) {
  return !!(device && device.device_token);
}

/** Let the current player go. The row and everything that points at it stay. */
function detach(db, deviceId) {
  db.transaction(() => {
    db.prepare('DELETE FROM device_fingerprints WHERE device_id = ?').run(deviceId);
    db.prepare(`UPDATE devices SET device_token = NULL, enrol_key = NULL, pairing_code = NULL, status = 'offline',
                  offline_reason = NULL, offline_reason_at = NULL, offline_detail = NULL, updated_at = strftime('%s','now')
                WHERE id = ?`).run(deviceId);
  })();
}

/*
 * Tell the old player it no longer is this screen, then close its connection. 'deleted' is the reason
 * a player drops its credentials and cached media on and asks for a new pairing code. The close a
 * moment later stops a player that ignores the event from carrying on as the screen on its old socket.
 */
function releasePlayer(io, deviceId) {
  if (!io) return;
  const ns = io.of('/device');
  ns.to(deviceId).emit('device:unpaired', { reason: 'deleted' });
  const t = setTimeout(() => { try { ns.in(deviceId).disconnectSockets(true); } catch (_) { /* nothing connected */ } }, 3000);
  if (t.unref) t.unref();
}

/**
 * Attach the player showing `code` to `device`. `live(id)` says whether a player is connected.
 * Returns { device, previous_id } or { error, status, guess }.
 * The caller decides whether replacing a screen's current player is allowed and releases that player.
 */
function attach(db, device, code, { live = false } = {}) {
  const ws = db.prepare('SELECT organization_id FROM workspaces WHERE id = ?').get(device.workspace_id);
  if (!ws) return { error: 'Screen not found', status: 404 };
  const oldPrints = db.prepare('SELECT fingerprint FROM device_fingerprints WHERE device_id = ?').all(device.id).map((f) => f.fingerprint);
  const r = pairInto(db, { importedId: device.id, code, orgId: ws.organization_id });
  if (r.error) return r;
  // The old player's fingerprints moved to the new row with everything else. Left there, that
  // hardware could reclaim the screen.
  for (const fp of oldPrints) db.prepare('DELETE FROM device_fingerprints WHERE fingerprint = ?').run(fp);
  db.prepare('UPDATE device_fingerprints SET user_id = ? WHERE device_id = ?').run(r.device.user_id, r.device.id);
  // The player's row was 'provisioning', which the sweep deletes. It is a claimed screen now, online
  // when `live(id)` says the player is connected, as pairing does.
  db.prepare('UPDATE devices SET status = ? WHERE id = ?').run(live && live(r.device.id) ? 'online' : 'offline', r.device.id);
  return { device: db.prepare('SELECT * FROM devices WHERE id = ?').get(r.device.id), previous_id: r.previous_id };
}

module.exports = { hasPlayer, detach, releasePlayer, attach };
