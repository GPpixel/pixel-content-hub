'use strict';
/*
 * 3.0: screen share — the signed-in side (docs/screen-share.md). JWT only (config/api-surface.js):
 * sharing a screen is a person at a browser, never an API token.
 *
 *   GET    /devices/:id         what the dashboard shows: can this screen be shared to, who is sharing
 *   POST   /devices/:id         start a share (editor+) -> a single-use ticket for the signalling socket
 *   DELETE /devices/:id         stop whoever is sharing (editor+) — the owner's "kick"
 *   PUT    /devices/:id/guest   the meeting-room code on this screen, on/off (workspace admin)
 *   GET    /workspace/:wsId     the workspace switch, for the settings card
 *   PUT    /workspace/:wsId     turn the feature on/off for the workspace (workspace admin)
 *
 * The media never comes here: the browser and the screen connect peer to peer, and this server only
 * relays their signalling (lib/screen-share.js). Every route resolves the device's OWN workspace
 * and checks the caller's access to it, exactly like routes/devices.js, so a device id from another
 * tenant is a 403 whatever workspace the caller has switched into.
 */
const express = require('express');
const router = express.Router();
router.use(require('../lib/backstop-limiter'));
const { db } = require('../db/database');
const { resourceAccess } = require('../lib/tenancy');
const { canAdminWorkspace } = require('../lib/permissions');
const { auditFromReq, audit } = require('../lib/audit');
const share = require('../lib/screen-share');

// Device + its workspace + the caller's access, or null after answering.
function loadDevice(req, res) {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(String(req.params.id || ''));
  if (!device) { res.status(404).json({ error: 'Device not found' }); return null; }
  if (!device.workspace_id) { res.status(403).json({ error: 'Device not assigned to a workspace' }); return null; }
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(device.workspace_id);
  const ctx = ws && resourceAccess(req, ws);
  if (!ctx) { res.status(403).json({ error: 'Access denied' }); return null; }
  const readOnly = !ctx.actingAs && ctx.workspaceRole === 'workspace_viewer';
  return { device, ws, ctx, readOnly };
}

function denyIfReadOnly(r, res) {
  if (r.readOnly) { res.status(403).json({ error: 'Read-only access' }); return true; }
  return false;
}

router.get('/devices/:id', (req, res) => {
  const r = loadDevice(req, res);
  if (!r) return;
  const avail = share.availability(r.device, r.ws);
  const session = share.sessionForDevice(r.device.id);
  res.json({
    feature: share.featureOn(),
    workspace_enabled: share.workspaceOn(r.ws),
    supported: require('../lib/player-capabilities').supports(r.device, share.CAP),
    available: avail.ok,
    reason: avail.ok ? null : avail.reason,
    can_share: !r.readOnly,
    can_admin: canAdminWorkspace(db, req.user, r.ws),
    guest_enabled: !!r.device.screen_share_guest,
    max_seconds: share.maxSeconds(),
    session: share.publicSession(session),
  });
});

router.post('/devices/:id', (req, res) => {
  const r = loadDevice(req, res);
  if (!r) return;
  if (denyIfReadOnly(r, res)) return;
  const avail = share.availability(r.device, r.ws);
  if (!avail.ok) return res.status(409).json({ error: 'Screen sharing is not available on this screen', reason: avail.reason });
  const name = (req.user && (req.user.name || req.user.email)) || 'Someone';
  const out = share.createSession({
    device: r.device, workspace: r.ws, sharedBy: name, userId: req.user.id,
    guest: false, ip: req.ip, audio: !!(req.body && req.body.audio),
  });
  if (out.error) return res.status(409).json({ error: 'Someone is already sharing to this screen', reason: out.error });
  res.status(201).json({
    session_id: out.session.id,
    ticket: out.ticket,
    ws_path: '/api/screen-share/ws',
    ice_servers: share.iceServersFor(r.device.id),
    max_seconds: share.maxSeconds(),
    screen_name: r.device.name || '',
  });
});

router.delete('/devices/:id', (req, res) => {
  const r = loadDevice(req, res);
  if (!r) return;
  if (denyIfReadOnly(r, res)) return;
  const stopped = share.stopForDevice(r.device.id, 'stopped_by_owner', { userId: req.user.id, ip: req.ip });
  res.json({ stopped });
});

router.put('/devices/:id/guest', (req, res) => {
  const r = loadDevice(req, res);
  if (!r) return;
  if (denyIfReadOnly(r, res)) return;
  if (!canAdminWorkspace(db, req.user, r.ws)) return res.status(403).json({ error: 'Only workspace admins can change meeting-room sharing' });
  const enabled = !!(req.body && req.body.enabled);
  db.prepare('UPDATE devices SET screen_share_guest = ? WHERE id = ?').run(enabled ? 1 : 0, r.device.id);
  audit('screen_share.guest_toggle', {
    userId: req.user.id, workspaceId: r.ws.id, deviceId: r.device.id, ip: req.ip, details: { enabled },
  });
  if (!enabled) share.dropCode(r.device.id);
  else share.rotateCode(r.device.id);   // turning it on is a fresh code, never one from before
  share.pushCode(r.device.id);
  res.json({ guest_enabled: enabled });
});

// The workspace switch, for a workspace named in the URL (the members page can show any workspace
// the caller administers, not only the one they are switched into).
function loadWorkspace(req, res) {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(String(req.params.wsId || ''));
  const ctx = ws && resourceAccess(req, ws);
  if (!ctx) { res.status(ws ? 403 : 404).json({ error: ws ? 'Access denied' : 'Workspace not found' }); return null; }
  return ws;
}

router.get('/workspace/:wsId', (req, res) => {
  const ws = loadWorkspace(req, res);
  if (!ws) return;
  res.json({ feature: share.featureOn(), enabled: share.workspaceOn(ws), can_admin: canAdminWorkspace(db, req.user, ws), max_seconds: share.maxSeconds() });
});

router.put('/workspace/:wsId', (req, res) => {
  const ws = loadWorkspace(req, res);
  if (!ws) return;
  if (!canAdminWorkspace(db, req.user, ws)) return res.status(403).json({ error: 'Only workspace admins can change screen sharing' });
  const enabled = !!(req.body && req.body.enabled);
  db.prepare('UPDATE workspaces SET screen_share_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, ws.id);
  auditFromReq(req, 'screen_share.workspace_toggle', { workspace_id: ws.id, enabled });
  if (!enabled) share.stopWorkspace(ws.id, 'disabled_by_admin', { userId: req.user.id, ip: req.ip });
  else {
    // Back on: screens that had the meeting-room code on show a fresh one again.
    for (const d of db.prepare('SELECT id FROM devices WHERE workspace_id = ? AND screen_share_guest = 1').all(ws.id)) share.pushCode(d.id);
  }
  res.json({ enabled });
});

module.exports = router;
