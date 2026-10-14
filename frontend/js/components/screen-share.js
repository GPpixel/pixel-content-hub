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
import { ScreenShareSender, pickScreen, shareUnsupportedReason, stopStream } from '../lib/screen-share-client.js';

let active = null;   // { deviceId, deviceName, state, sender }
const listeners = new Set();

export function onScreenShareChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(activeScreenShare()); } catch (_) { /* a listener's problem */ } } }

export function activeScreenShare() {
  return active ? { deviceId: active.deviceId, deviceName: active.deviceName, state: active.state } : null;
}

const REASONS = new Set([
  'stopped_by_sharer', 'stopped_by_owner', 'max_duration', 'connection_failed', 'screen_unreachable',
  'screen_offline', 'screen_left', 'screen_unsupported', 'signalling_closed', 'signalling_failed',
  'invalid_ticket', 'not_connected', 'disabled_by_admin', 'sharer_left',
  'disabled', 'workspace_disabled', 'unsupported', 'offline', 'busy', 'invalid_code',
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
export async function startScreenShare(device, { audio = false } = {}) {
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
  const me = { deviceId: device.id, deviceName: device.name || start.screen_name || '', state: 'connecting', sender: null };
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

export function stopScreenShare() { if (active && active.sender) active.sender.stop(); }

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
  bar.innerHTML = `
    <span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;flex:0 0 auto;background:${live ? 'var(--danger, #ef4444)' : 'var(--warning, #f59e0b)'}"></span>
    <span style="display:grid;line-height:1.3;min-width:0">
      <strong style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t('screen_share.bar.sharing_to', { name: active.deviceName }))}</strong>
      <small style="color:var(--text-muted);font-size:12px">${esc(stateText(active.state))}</small>
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
  const offChange = onScreenShareChange(() => load());

  async function load() {
    if (disposed) return;
    try { status = await api.getScreenShare(device.id); } catch (_) { status = null; }
    if (disposed || !document.contains(host)) { dispose(); return; }
    paint();
  }

  function paint() {
    if (!status || !status.feature) { host.innerHTML = ''; opts.onAvailable && opts.onAvailable(false); return; }
    const mine = active && active.deviceId === device.id;
    const s = status.session;
    const canStart = status.can_share && status.supported && status.workspace_enabled && !s && !mine;
    opts.onAvailable && opts.onAvailable(!!(status.can_share && status.supported && status.workspace_enabled));
    let note = '';
    if (!status.supported) note = t('screen_share.card.unsupported');
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
            <span>&#9679; ${esc(t(s.guest ? 'screen_share.card.now_guest' : 'screen_share.card.now', { name: s.shared_by, time: since }))}</span>
            ${status.can_share && !mine ? `<button type="button" class="btn btn-danger btn-sm" data-share-kick>${esc(t('screen_share.card.kick'))}</button>` : ''}
            ${mine ? `<button type="button" class="btn btn-danger btn-sm" data-share-mine-stop>${esc(t('screen_share.stop'))}</button>` : ''}
          </div>` : ''}
        ${canStart ? `
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" data-share-start ${status.reason === 'offline' ? 'disabled' : ''}>&#128421;&#65039; ${esc(t('screen_share.start'))}</button>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" data-share-audio> ${esc(t('screen_share.include_audio'))}</label>
          </div>` : ''}
        ${note ? `<p style="font-size:13px;margin:10px 0 0;color:var(--text-muted)">${esc(note)}</p>` : ''}
        ${status.can_admin && status.supported ? `
          <label style="display:flex;align-items:flex-start;gap:10px;margin-top:14px;cursor:pointer">
            <input type="checkbox" data-share-guest ${status.guest_enabled ? 'checked' : ''} ${status.workspace_enabled ? '' : 'disabled'} style="margin-top:3px">
            <span><strong style="font-size:14px">${esc(t('screen_share.guest.toggle'))}</strong><br>
            <small style="color:var(--text-muted);font-size:12px">${esc(t('screen_share.guest.explain'))}</small></span>
          </label>` : ''}
      </div>`;
    host.querySelector('[data-share-start]')?.addEventListener('click', async (e) => {
      const audio = !!host.querySelector('[data-share-audio]')?.checked;
      e.currentTarget.disabled = true;
      await startScreenShare(device, { audio });
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
