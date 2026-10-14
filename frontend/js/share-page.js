/*
 * 3.0 screen share — the meeting-room page at /share (frontend/share.html). No account: a guest
 * types the code the screen shows (or scans its QR, which carries the code in the URL fragment) and
 * presents their screen. The order matters: the screen picker opens FIRST (it needs the click), and
 * only then is the code spent on POST /api/share/join — cancelling the picker leaves the code usable.
 *
 * All text goes in with textContent; nothing from the server or the URL is parsed as HTML.
 */
import { t } from './i18n.js';
import { ScreenShareSender, pickScreen, shareUnsupportedReason, stopStream } from './lib/screen-share-client.js';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'st_share_name';

const KNOWN_REASONS = new Set([
  'stopped_by_sharer', 'stopped_by_owner', 'max_duration', 'connection_failed', 'screen_unreachable',
  'screen_offline', 'screen_left', 'screen_unsupported', 'signalling_closed', 'signalling_failed',
  'invalid_ticket', 'not_connected', 'disabled_by_admin', 'sharer_left',
  'disabled', 'workspace_disabled', 'unsupported', 'offline', 'busy', 'invalid_code',
]);
const reasonText = (r) => t(KNOWN_REASONS.has(r) ? `screen_share.reason.${r}` : 'screen_share.reason.generic');

document.title = t('screen_share.guest_page.title');
document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.getAttribute('data-t')); });

// The QR puts the code in the fragment. Take it, then drop it from the address bar and history.
const fromHash = decodeURIComponent((location.hash || '').replace(/^#/, '')).replace(/[^0-9A-Za-z-]/g, '').slice(0, 12);
if (fromHash) {
  $('shareCode').value = fromHash.length === 8 ? `${fromHash.slice(0, 4)}-${fromHash.slice(4)}` : fromHash;
  try { history.replaceState(null, '', location.pathname); } catch (_) { /* cosmetic */ }
}
try { $('shareName').value = localStorage.getItem(NAME_KEY) || ''; } catch (_) { /* private mode */ }

function say(msg, isError) {
  const el = $('shareMsg');
  el.textContent = msg || '';
  el.classList.toggle('error', !!isError);
}

const unsupported = shareUnsupportedReason();
if (unsupported) {
  say(t(`screen_share.unsupported.${unsupported}`), true);
  $('shareGo').disabled = true;
}

let sender = null;

function showLive(screenName, state) {
  $('shareForm').hidden = true;
  $('shareLive').hidden = false;
  $('shareLive').classList.toggle('on', state === 'live');
  $('shareLiveTitle').textContent = t('screen_share.bar.sharing_to', { name: screenName });
  $('shareLiveState').textContent = t(state === 'live' ? 'screen_share.state.live'
    : state === 'negotiating' ? 'screen_share.state.negotiating' : 'screen_share.state.connecting');
}

function showForm(msg, isError) {
  $('shareLive').hidden = true;
  $('shareForm').hidden = false;
  $('shareGo').disabled = !!unsupported;
  // A code is good for one share: the screen is already showing a new one.
  $('shareCode').value = '';
  say(msg, isError);
}

$('shareJoin').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sender || unsupported) return;
  const code = $('shareCode').value.trim();
  const name = $('shareName').value.trim();
  const audio = $('shareAudio').checked;
  if (!code) { say(t('screen_share.guest_page.need_code'), true); return; }
  try { localStorage.setItem(NAME_KEY, name); } catch (_) { /* private mode */ }
  $('shareGo').disabled = true;
  say('');
  let stream;
  try { stream = await pickScreen({ audio }); }
  catch (err) {
    $('shareGo').disabled = false;
    if (!(err && err.name === 'NotAllowedError')) say(t('screen_share.pick_failed'), true);
    return;
  }
  let join;
  try {
    const res = await fetch('/api/share/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, audio: audio && stream.getAudioTracks().length > 0 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      stopStream(stream);
      $('shareGo').disabled = false;
      say(res.status === 429 ? t('screen_share.guest_page.slow_down') : reasonText(body.reason), true);
      return;
    }
    join = body;
  } catch (_) {
    stopStream(stream);
    $('shareGo').disabled = false;
    say(t('screen_share.reason.generic'), true);
    return;
  }
  const screenName = join.screen_name || '';
  showLive(screenName, 'connecting');
  sender = new ScreenShareSender({
    ticket: join.ticket, wsPath: join.ws_path, iceServers: join.ice_servers, stream,
    onState: (st) => showLive(screenName, st),
    onEnded: (reason) => {
      sender = null;
      showForm(reason === 'stopped_by_sharer' ? t('screen_share.stopped') : reasonText(reason),
        !['stopped_by_sharer', 'stopped_by_owner', 'max_duration'].includes(reason));
    },
  });
  sender.start();
});

$('shareStop').addEventListener('click', () => { if (sender) sender.stop(); });
window.addEventListener('pagehide', () => { if (sender) sender.stop(); });
