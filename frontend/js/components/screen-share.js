/*
 * 3.0 screen share — the dashboard side (docs/screen-share.md).
 *
 *   startScreenShare(device)        "Share my screen": picker -> start -> live bar at the bottom
 *   stopScreenShare()               end your own share
 *   renderScreenShareCard(host, d)  the card on a screen's page: who is sharing, stop it, the
 *                                   meeting-room code switch (admins)
 *   renderScreenShareSettings(...)  the workspace switch, on the members page (admins)
 *
 * The share belongs to the PAGE, not to a view: it survives moving around the dashboard (the bar is
 * on document.body) and ends when the tab closes, because its signalling socket closes with it.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { esc } from '../utils.js';
import { showToast } from './toast.js';
import { ScreenShareSender, MultiShareSender, pickScreen, shareUnsupportedReason, stopStream } from '../lib/screen-share-client.js';

// { deviceIds, deviceName, state, sender, shareId, live, screens } — screens > 1 for a multi share.
let active = null;
const listeners = new Set();

export function onScreenShareChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(activeScreenShare()); } catch (_) { /* a listener's problem */ } } }

export function activeScreenShare() {
  return active ? {
    deviceId: active.deviceIds[0], deviceIds: active.deviceIds.slice(), deviceName: active.deviceName,
    state: active.state, screens: active.screens, live: active.live, shareId: active.shareId,
  } : null;
}

/*
 * The kind of player a screen runs, as people know it — for "This screen can't show a screen share
 * (Roku)". Brand names, so not translated. platformFamily() names (lib/player-capabilities.js).
 */
const PLAYER_NAMES = {
  android: 'Android', tizen: 'Samsung Tizen', brightsign: 'BrightSign', vega: 'Amazon Fire TV (Vega)',
  linux: 'Raspberry Pi', windows: 'Windows', macos: 'macOS', ios: 'iPad / iPhone', roku: 'Roku',
  embedded: 'e-ink', web: 'web player',
};
// Players that have a receiver in a current release: a screen of that kind that cannot show one is
// running an older app (update it), not a platform that never will.
const CAN_UPDATE = new Set(['android', 'linux', 'windows', 'macos', 'ios']);

/** Why a screen cannot show a share, in words, from its platform family. */
export function screenShareUnsupportedNote(platform) {
  const player = PLAYER_NAMES[platform] || PLAYER_NAMES.web;
  if (platform === 'tizen') return t('screen_share.card.unsupported_tizen');
  if (!platform) return t('screen_share.card.unsupported');
  if (platform === 'web') return t('screen_share.card.unsupported_browser');
  if (CAN_UPDATE.has(platform)) return t('screen_share.card.unsupported_update', { player });
  return t('screen_share.card.unsupported_platform', { player });
}

const REASONS = new Set([
  'stopped_by_sharer', 'stopped_by_owner', 'max_duration', 'connection_failed', 'screen_unreachable',
  'screen_offline', 'screen_left', 'screen_unsupported', 'signalling_closed', 'signalling_failed',
  'invalid_ticket', 'not_connected', 'disabled_by_admin', 'sharer_left',
  'disabled', 'workspace_disabled', 'unsupported', 'offline', 'busy', 'invalid_code', 'none_available',
]);
/** Words for an end reason or a refusal reason from the server. */
export function screenShareReasonText(reason) {
  return t(REASONS.has(reason) ? `screen_share.reason.${reason}` : 'screen_share.reason.generic');
}
const BENIGN = new Set(['stopped_by_sharer', 'stopped_by_owner', 'max_duration']);

export function screenShareUnsupportedText() {
  const why = shareUnsupportedReason();
  return why ? t(`screen_share.unsupported.${why}`) : null;
}

/**
 * Start sharing to `device` ({ id, name }). Call it straight from a click: the screen picker needs
 * the gesture. Resolves true when a share started.
 */
export async function startScreenShare(device, { audio = false, also = [] } = {}) {
  // "Also show on…": the same share on more screens is a multi share.
  const extra = (also || []).filter((id) => id && id !== device.id);
  if (extra.length) return startScreenShareTo({ deviceIds: [device.id, ...extra], label: device.name }, { audio });
  if (active) { showToast(t('screen_share.already_sharing', { name: active.deviceName }), 'warning'); return false; }
  const why = screenShareUnsupportedText();
  if (why) { showToast(why, 'error', 8000); return false; }
  let stream;
  try { stream = await pickScreen({ audio }); }
  catch (e) {
    if (!(e && e.name === 'NotAllowedError')) showToast(t('screen_share.pick_failed'), 'error');
    return false;   // cancelling the picker is not an error
  }
  let start;
  try {
    start = await api.startScreenShare(device.id, { audio: !!audio && stream.getAudioTracks().length > 0 });
  } catch (e) {
    stopStream(stream);
    showToast((e && e.body && e.body.reason) ? screenShareReasonText(e.body.reason) : (e.message || t('screen_share.reason.generic')), 'error', 7000);
    return false;
  }
  // The display's mirrors (its link open somewhere else) come back as extra legs: the same one
  // capture goes to each, exactly like a multi share. Mirrors left out (offline, say) are not
  // worth a warning here: the person asked for this display, and it is getting the share.
  if (Array.isArray(start.legs) && start.legs.length > 1) {
    runMulti(start, stream, device.name || start.screen_name || '');
    return true;
  }
  const me = { deviceIds: [device.id], deviceName: device.name || start.screen_name || '', state: 'connecting', sender: null, shareId: start.share_id || start.session_id, screens: 1, live: 0 };
  active = me;
  me.sender = new ScreenShareSender({
    ticket: start.ticket, wsPath: start.ws_path, iceServers: start.ice_servers, stream,
    onState: (st) => { if (active !== me) return; me.state = st; paintBar(); notify(); },
    onEnded: (reason) => {
      if (active === me) { active = null; removeBar(); notify(); }
      if (reason === 'stopped_by_sharer') showToast(t('screen_share.stopped'), 'success');
      else showToast(screenShareReasonText(reason), BENIGN.has(reason) ? 'info' : 'error', 7000);
    },
  });
  paintBar();
  me.sender.start();
  notify();
  return true;
}

/**
 * Multi share: one capture on several screens — { deviceIds } and/or { groupId } (a device group).
 * label names the share in messages when there is one screen. Call it straight from a click (the
 * picker needs the gesture: it is asked for FIRST, before any network call). Resolves true when a
 * share started. Screens that cannot take it (no receiver, offline, busy) are skipped and named.
 */
export async function startScreenShareTo({ deviceIds = [], groupId = null, label = '' } = {}, { audio = false } = {}) {
  if (active) { showToast(t('screen_share.already_sharing', { name: active.deviceName }), 'warning'); return false; }
  const why = screenShareUnsupportedText();
  if (why) { showToast(why, 'error', 8000); return false; }
  let stream;
  try { stream = await pickScreen({ audio }); }
  catch (e) {
    if (!(e && e.name === 'NotAllowedError')) showToast(t('screen_share.pick_failed'), 'error');
    return false;
  }
  let start;
  try {
    start = await api.startScreenShareMulti({
      device_ids: deviceIds, group_id: groupId || undefined,
      audio: !!audio && stream.getAudioTracks().length > 0,
    });
  } catch (e) {
    stopStream(stream);
    const b = (e && e.body) || {};
    let msg;
    if (b.reason === 'too_many_targets') msg = t('screen_share.reason.too_many_targets', { max: b.max_targets, count: b.screens });
    else if (b.reason === 'none_available' && Array.isArray(b.skipped) && b.skipped.length) msg = t('screen_share.reason.none_available');
    else msg = b.reason ? screenShareReasonText(b.reason) : (e.message || t('screen_share.reason.generic'));
    showToast(msg, 'error', 9000);
    return false;
  }
  if (Array.isArray(start.skipped) && start.skipped.length) {
    showToast(t('screen_share.multi.skipped', { names: start.skipped.map((s) => s.name).filter(Boolean).join(', ') }), 'warning', 9000);
  }
  const legs = Array.isArray(start.legs) ? start.legs : [];
  runMulti(start, stream, legs.length === 1 ? (legs[0].screen_name || label) : label);
  return true;
}

// One capture on every leg the server handed back ({ share_id, ws_path, legs }): the live bar,
// per-screen drop-outs, and the end.
function runMulti(start, stream, name) {
  const legs = Array.isArray(start.legs) ? start.legs : [];
  const me = { deviceIds: legs.map((l) => l.device_id), deviceName: name, state: 'connecting', sender: null, shareId: start.share_id, screens: legs.length, live: 0 };
  active = me;
  me.sender = new MultiShareSender({
    legs, wsPath: start.ws_path, stream,
    onState: (sum) => {
      if (active !== me) return;
      me.state = sum.state; me.live = sum.live; me.screens = sum.active;
      paintBar(); notify();
    },
    onLegEnded: (leg, reason) => {
      if (active !== me) return;
      me.deviceIds = me.deviceIds.filter((id) => id !== leg.deviceId);
      showToast(t('screen_share.multi.dropped', { name: leg.name || '' }) + ' ' + screenShareReasonText(reason), 'warning', 7000);
    },
    onEnded: (reason) => {
      if (active === me) { active = null; removeBar(); notify(); }
      if (reason === 'stopped_by_sharer') showToast(t('screen_share.stopped'), 'success');
      else showToast(screenShareReasonText(reason), BENIGN.has(reason) ? 'info' : 'error', 7000);
    },
  });
  paintBar();
  me.sender.start();
  notify();
  return true;
}

export function stopScreenShare() { if (active && active.sender) active.sender.stop(); }

/*
 * Multi share: wire every "Share my screen to this group" button under `root` ([data-group-share]).
 * Revealed only when the server has the feature on and the group has a member that can show a share
 * (data-share-capable). The server decides the real member list; screens that cannot take it are
 * named in a toast after the picker.
 */
export async function wireGroupShareButtons(root = document) {
  const btns = [...root.querySelectorAll('[data-group-share]')];
  if (!btns.length) return;
  let on = false;
  try { const st = await api.getServerStatus(); on = !!(st && st.features && st.features.screen_share); } catch (_) { on = false; }
  if (!on) return;
  // A view-only member cannot start a share (the server refuses it): don't offer the button.
  let viewer = false;
  try { const u = JSON.parse(localStorage.getItem('user') || 'null'); viewer = !!(u && u.current_workspace_role === 'workspace_viewer' && !u.acting_as); } catch (_) { viewer = false; }
  if (viewer) return;
  for (const b of btns) {
    if (!document.contains(b) || b.dataset.shareWired) continue;
    b.dataset.shareWired = '1';
    if (Number(b.dataset.shareCapable || 0) > 0) b.style.display = '';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      startScreenShareTo({ groupId: b.dataset.groupShare, label: b.dataset.groupName || '' });
    });
  }
}

// ------------------------------------------------------------------ the live bar
function stateText(st) {
  if (st === 'live') return t('screen_share.state.live');
  if (st === 'negotiating') return t('screen_share.state.negotiating');
  return t('screen_share.state.connecting');
}

function paintBar() {
  if (!active) return;
  let bar = document.getElementById('screenShareBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'screenShareBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-radius:999px;background:var(--bg-card);border:1px solid var(--border);box-shadow:0 8px 28px rgba(0,0,0,.28);max-width:calc(100vw - 24px)';
    document.body.appendChild(bar);
  }
  const live = active.state === 'live';
  const many = active.screens > 1;
  const title = many ? t('screen_share.bar.sharing_to_n', { count: active.screens }) : t('screen_share.bar.sharing_to', { name: active.deviceName });
  const detail = many && live ? t('screen_share.state.live_n', { live: active.live, total: active.screens }) : stateText(active.state);
  bar.innerHTML = `
    <span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;flex:0 0 auto;background:${live ? 'var(--danger, #ef4444)' : 'var(--warning, #f59e0b)'}"></span>
    <span style="display:grid;line-height:1.3;min-width:0">
      <strong style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</strong>
      <small style="color:var(--text-muted);font-size:12px">${esc(detail)}</small>
    </span>
    <button type="button" class="btn btn-danger btn-sm" data-share-stop>${esc(t('screen_share.stop'))}</button>`;
  bar.querySelector('[data-share-stop]').addEventListener('click', () => stopScreenShare());
}

function removeBar() { document.getElementById('screenShareBar')?.remove(); }

if (typeof window !== 'undefined') {
  // Closing or leaving the tab ends the share cleanly (the socket would drop anyway; this is faster).
  window.addEventListener('pagehide', () => { try { stopScreenShare(); } catch (_) { /* leaving */ } });
}

// ------------------------------------------------------------------ the card on a screen's page
/*
 * host: the mount element. device: { id, name }. opts.onAvailable(bool) lets the page show or hide
 * its own header button from the same answer. Polls while mounted, so a guest joining or an owner
 * stopping shows up without a reload.
 */
export function renderScreenShareCard(host, device, opts = {}) {
  if (!host || !device) return () => {};
  let status = null;
  let timer = null;
  let disposed = false;
  // Multi share, "Also show on…": the other screens that can take a share, picked across repaints.
  let others = null;            // [{ id, name, online }] once loaded
  const also = new Set();
  let alsoOpen = false;
  const offChange = onScreenShareChange(() => load());

  async function loadOthers() {
    if (others) return;
    try {
      const all = await api.getDevices();
      others = (Array.isArray(all) ? all : []).filter((d) => d.id !== device.id
        && Array.isArray(d.capabilities) && d.capabilities.includes('remote.screen_share'))
        .map((d) => ({ id: d.id, name: d.name || '', online: d.status === 'online' }));
    } catch (_) { others = []; }
    if (!disposed) paint();
  }

  function alsoHtml() {
    if (!others) return `<p style="font-size:13px;color:var(--text-muted);margin:8px 0 0">…</p>`;
    if (!others.length) return `<p style="font-size:13px;color:var(--text-muted);margin:8px 0 0">${esc(t('screen_share.card.also_none'))}</p>`;
    const more = Math.max(0, (status.max_targets || 6) - 1);
    return `<p style="font-size:12px;color:var(--text-muted);margin:8px 0 6px">${esc(t('screen_share.card.also_hint', { more }))}</p>
      <div style="display:grid;gap:4px;max-height:180px;overflow:auto">${others.map((o) => `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;${o.online ? '' : 'opacity:.55'}">
          <input type="checkbox" data-share-also="${esc(o.id)}" ${also.has(o.id) ? 'checked' : ''} ${o.online ? '' : 'disabled'}>
          ${esc(o.name)}${o.online ? '' : ` <small>(${esc(t('screen_share.reason.offline'))})</small>`}
        </label>`).join('')}</div>`;
  }

  async function load() {
    if (disposed) return;
    try { status = await api.getScreenShare(device.id); } catch (_) { status = null; }
    if (disposed || !document.contains(host)) { dispose(); return; }
    paint();
  }

  function paint() {
    if (!status || !status.feature) { host.innerHTML = ''; opts.onAvailable && opts.onAvailable(false); return; }
    const mine = !!(active && active.deviceIds.includes(device.id));
    const s = status.session;
    const canStart = status.can_share && status.supported && status.workspace_enabled && !s && !mine;
    opts.onAvailable && opts.onAvailable(!!(status.can_share && status.supported && status.workspace_enabled));
    let note = '';
    if (!status.supported) note = screenShareUnsupportedNote(status.platform);
    else if (!status.workspace_enabled) note = t('screen_share.card.workspace_off');
    else if (status.reason === 'offline') note = t('screen_share.card.offline');
    else if (!status.can_share) note = t('screen_share.card.view_only');
    const since = s && s.started_at ? new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    host.innerHTML = `
      <div class="settings-section" style="margin-top:16px;padding:16px 20px">
        <h3 style="margin:0 0 6px">${esc(t('screen_share.card.title'))}</h3>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">${esc(t('screen_share.card.explain', { minutes: Math.round((status.max_seconds || 3600) / 60) }))}</p>
        ${s ? `
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <span>&#9679; ${esc(s.screens > 1
              ? t('screen_share.card.now_multi', { name: s.shared_by, count: s.screens, time: since })
              : t(s.guest ? 'screen_share.card.now_guest' : 'screen_share.card.now', { name: s.shared_by, time: since }))}</span>
            ${status.can_share && !mine ? `<button type="button" class="btn btn-danger btn-sm" data-share-kick>${esc(t(s.screens > 1 ? 'screen_share.card.kick_one' : 'screen_share.card.kick'))}</button>` : ''}
            ${status.can_share && !mine && s.screens > 1 ? `<button type="button" class="btn btn-danger btn-sm" data-share-kick-all>${esc(t('screen_share.card.stop_all', { count: s.screens }))}</button>` : ''}
            ${mine ? `<button type="button" class="btn btn-danger btn-sm" data-share-mine-stop>${esc(t('screen_share.stop'))}</button>` : ''}
          </div>` : ''}
        ${canStart ? `
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" data-share-start ${status.reason === 'offline' ? 'disabled' : ''}>&#128421;&#65039; ${esc(t('screen_share.start'))}</button>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" data-share-audio> ${esc(t('screen_share.include_audio'))}</label>
          </div>
          ${(status.max_targets || 1) > 1 ? `
          <details data-share-also-box style="margin-top:10px" ${alsoOpen ? 'open' : ''}>
            <summary style="cursor:pointer;font-size:13px">${esc(t('screen_share.card.also'))}${also.size ? ` (${also.size})` : ''}</summary>
            ${alsoOpen ? alsoHtml() : ''}
          </details>` : ''}` : ''}
        ${note ? `<p style="font-size:13px;margin:10px 0 0;color:var(--text-muted)">${esc(note)}</p>` : ''}
        ${/* A mirror shows its display's code: the switch is on the display (the mirror banner links it). */
          status.can_admin && status.supported && !status.mirror_of ? `
          <label style="display:flex;align-items:flex-start;gap:10px;margin-top:14px;cursor:pointer">
            <input type="checkbox" data-share-guest ${status.guest_enabled ? 'checked' : ''} ${status.workspace_enabled ? '' : 'disabled'} style="margin-top:3px">
            <span><strong style="font-size:14px">${esc(t('screen_share.guest.toggle'))}</strong><br>
            <small style="color:var(--text-muted);font-size:12px">${esc(t('screen_share.guest.explain'))}</small></span>
          </label>` : ''}
      </div>`;
    host.querySelector('[data-share-start]')?.addEventListener('click', async (e) => {
      const audio = !!host.querySelector('[data-share-audio]')?.checked;
      e.currentTarget.disabled = true;
      await startScreenShare(device, { audio, also: [...also] });
      load();
    });
    host.querySelector('[data-share-also-box]')?.addEventListener('toggle', (e) => {
      if (e.currentTarget.open === alsoOpen) return;
      alsoOpen = e.currentTarget.open;
      if (alsoOpen && !others) loadOthers(); else paint();
    });
    host.querySelectorAll('[data-share-also]').forEach((cb) => cb.addEventListener('change', () => {
      const max = Math.max(0, (status.max_targets || 6) - 1);
      if (cb.checked && also.size >= max) { cb.checked = false; showToast(t('screen_share.reason.too_many_targets', { max: status.max_targets, count: also.size + 2 }), 'warning'); return; }
      if (cb.checked) also.add(cb.dataset.shareAlso); else also.delete(cb.dataset.shareAlso);
      const sum = host.querySelector('[data-share-also-box] summary');
      if (sum) sum.textContent = t('screen_share.card.also') + (also.size ? ` (${also.size})` : '');
    }));
    host.querySelector('[data-share-kick-all]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await api.stopScreenShareAll(status.session.share_id); showToast(t('screen_share.card.kicked'), 'success'); }
      catch (err) { showToast(err.message, 'error'); }
      load();
    });
    host.querySelector('[data-share-mine-stop]')?.addEventListener('click', () => stopScreenShare());
    host.querySelector('[data-share-kick]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { await api.stopScreenShare(device.id); showToast(t('screen_share.card.kicked'), 'success'); }
      catch (err) { showToast(err.message, 'error'); }
      load();
    });
    host.querySelector('[data-share-guest]')?.addEventListener('change', async (e) => {
      const want = !!e.target.checked;
      e.target.disabled = true;
      try {
        await api.setScreenShareGuest(device.id, want);
        showToast(t(want ? 'screen_share.guest.on_toast' : 'screen_share.guest.off_toast'), 'success');
      } catch (err) { e.target.checked = !want; showToast(err.message, 'error'); }
      load();
    });
  }

  function dispose() {
    disposed = true;
    if (timer) clearInterval(timer);
    offChange();
  }

  load();
  timer = setInterval(load, 10000);
  return dispose;
}

// ------------------------------------------------------------------ the workspace switch
export async function renderScreenShareSettings(host, { workspaceId } = {}) {
  if (!host || !workspaceId) return;
  let st;
  try { st = await api.getScreenShareWorkspace(workspaceId); } catch (_) { return; }
  if (!st || !st.feature || !st.can_admin) return;
  let enabled = !!st.enabled;
  function paint() {
    host.innerHTML = `
      <div class="settings-section" style="margin-top:24px;padding:16px 20px">
        <h3 style="margin:0 0 6px">${esc(t('screen_share.settings.title'))}</h3>
        <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">${esc(t('screen_share.settings.explain'))}</p>
        <label style="display:flex;align-items:center;gap:10px;font-weight:600;cursor:pointer">
          <input type="checkbox" id="wsScreenShareToggle" ${enabled ? 'checked' : ''}>
          ${esc(t('screen_share.settings.toggle'))}
        </label>
      </div>`;
    host.querySelector('#wsScreenShareToggle')?.addEventListener('change', async (e) => {
      const want = !!e.target.checked;
      e.target.disabled = true;
      try {
        await api.setScreenShareWorkspace(workspaceId, want);
        enabled = want;
        showToast(t(want ? 'screen_share.settings.on_toast' : 'screen_share.settings.off_toast'), 'success');
      } catch (err) { showToast(err.message, 'error'); }
      paint();
    });
  }
  paint();
}
