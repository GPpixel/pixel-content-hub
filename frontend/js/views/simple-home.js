/*
 * 3.0 Simple view: everything is a guided task, in the style of the setup guide.
 *
 *   #/                       "What would you like to do?" — four big tasks and the list of screens
 *   #/simple/change[?device] Change what a screen shows: pick the screen → choose content → it's live
 *   #/simple/upload          Upload photos: choose files → choose screens → done
 *   (#/add-screen is the setup guide's add mode, views/onboarding.js)
 *
 * No sidebar here: a small top bar carries the Simple | Advanced switch and an account menu. Every
 * other page still opens normally (with the full shell) from a link or bookmark, and Advanced view
 * restores the full dashboard. Nothing here writes anything the full product cannot already write:
 * uploads go through api.uploadContent, screens are changed through the same assignment, playlist
 * and publish endpoints the screen page uses, so the release gate (review) and plan limits apply.
 *
 * Values from the server reach the page through esc() or textContent only.
 */
import { api } from '../api.js';
import { t, tn } from '../i18n.js';
import { esc, screenshotUrl, hydrateAuthImages } from '../utils.js';
import { showToast } from '../components/toast.js';
import { setUiMode } from '../components/ui-mode.js';
import { plansVisible } from '../components/plan-nudges.js';

const SAMPLE_URL = '/assets/samples/welcome-screen.jpg';
const ACCEPT = 'image/*,video/*,audio/*';
let cleanupFns = [];

function cachedUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}
function brandName() {
  return (document.getElementById('brandName')?.textContent || 'ScreenTinker').trim();
}
function online(d) { return d && d.status === 'online'; }

// ---------------------------------------------------------------------------------------------
// Shell: top bar + a centred column, the same proportions as the setup guide
// ---------------------------------------------------------------------------------------------

function shell(container, inner) {
  const u = cachedUser() || {};
  const showPlan = plansVisible(u);
  container.innerHTML = `
    <div class="simple-topbar">
      <a href="#/" class="simple-brand">${esc(brandName())}</a>
      <div class="simple-topbar-right">
        <div class="ui-mode-switch simple-switch" role="radiogroup" aria-label="${esc(t('simple.view_label'))}">
          <button type="button" role="radio" aria-checked="true" data-simple-mode="simple">${esc(t('nav.view_simple'))}</button>
          <button type="button" role="radio" aria-checked="false" data-simple-mode="advanced">${esc(t('nav.view_advanced'))}</button>
        </div>
        <details class="simple-account">
          <summary>${esc(u.name || u.email || '')}</summary>
          <div class="simple-account-menu">
            ${showPlan ? `<a href="#/billing">${esc(t('simple.menu.plan'))}</a>` : ''}
            <a href="#/settings">${esc(t('simple.menu.settings'))}</a>
            <a href="#/help">${esc(t('simple.menu.help'))}</a>
            <button type="button" data-simple-signout>${esc(t('auth.sign_out'))}</button>
          </div>
        </details>
      </div>
    </div>
    <div class="simple-page">${inner}</div>`;
  container.querySelector('[data-simple-mode="advanced"]').addEventListener('click', () => setUiMode('advanced'));
  container.querySelector('[data-simple-signout]').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.hash = '#/login';
    window.location.reload();
  });
}

/** Guide frame: progress, icon, title, card, footer. Same look as views/onboarding.js. */
function guideFrame({ step, total, icon, title, body, back = true, next = null, nextLabel = '' }) {
  return `
    <div class="simple-guide">
      <div class="simple-progress">${Array.from({ length: total }, (_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
      <div class="simple-guide-head"><div class="simple-guide-icon">${icon}</div><h2>${esc(title)}</h2></div>
      <div class="simple-card">${body}</div>
      <div class="simple-guide-foot">
        ${back ? `<button type="button" class="btn btn-secondary" data-guide-back>${esc(t('onboarding.back'))}</button>` : '<span></span>'}
        <div style="display:flex;gap:8px">
          <a href="#/" class="btn btn-secondary" style="color:var(--text-muted)">${esc(t('common.cancel'))}</a>
          ${next ? `<button type="button" class="btn btn-primary" data-guide-next>${esc(nextLabel)}</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

async function renderHome(container) {
  shell(container, `
    <h1 class="simple-h1">${esc(t('simple.home.title'))}</h1>
    <div class="simple-tasks">
      <a class="simple-task" href="#/add-screen"><span class="simple-task-icon">&#10133;</span><span><strong>${esc(t('simple.task.add'))}</strong><small>${esc(t('simple.task.add_desc'))}</small></span></a>
      <a class="simple-task" href="#/simple/change"><span class="simple-task-icon">&#9998;</span><span><strong>${esc(t('simple.task.change'))}</strong><small>${esc(t('simple.task.change_desc'))}</small></span></a>
      <a class="simple-task" href="#/simple/upload"><span class="simple-task-icon">&#128247;</span><span><strong>${esc(t('simple.task.upload'))}</strong><small>${esc(t('simple.task.upload_desc'))}</small></span></a>
      <a class="simple-task" href="#/help"><span class="simple-task-icon">&#10067;</span><span><strong>${esc(t('simple.task.help'))}</strong><small>${esc(t('simple.task.help_desc'))}</small></span></a>
    </div>
    <h2 class="simple-h2">${esc(t('simple.home.your_screens'))}</h2>
    <div id="simpleScreens" class="simple-screens"><p class="simple-muted">${esc(t('common.loading'))}</p></div>`);

  const host = document.getElementById('simpleScreens');
  let devices = [];
  try { devices = await api.getDevices(); } catch { devices = []; }
  if (!document.contains(host)) return;
  if (!devices.length) {
    host.innerHTML = `<div class="simple-empty"><p>${esc(t('simple.home.no_screens'))}</p>
      <a class="btn btn-primary" href="#/add-screen">${esc(t('simple.task.add'))}</a></div>`;
    return;
  }
  host.innerHTML = devices.map((d) => `
    <a class="simple-screen" href="#/simple/change?device=${encodeURIComponent(d.id)}" title="${esc(t('simple.task.change'))}">
      <span class="simple-screen-shot">${d.screenshot_path ? `<img src="${screenshotUrl(d.id, d.screenshot_at || '')}" alt="">` : '&#128250;'}</span>
      <span class="simple-screen-name">${esc(d.name)}</span>
      <span class="simple-screen-status ${online(d) ? 'on' : 'off'}">${esc(d.plan_paused ? t('simple.status.paused') : online(d) ? t('simple.status.online') : t('simple.status.offline'))}</span>
    </a>`).join('');
}

// ---------------------------------------------------------------------------------------------
// Shared: put content on a screen
// ---------------------------------------------------------------------------------------------

/**
 * Show `contentIds` on `device`. 'replace': the screen stops following whatever list it had and gets
 * a fresh one of its own with only these items (the old list is left untouched for any other screen
 * using it). 'add': appended to the list the screen plays now. Published either way, through the
 * normal endpoint, so a workspace that reviews changes keeps them as a draft for review.
 */
async function showOnScreen(device, contentIds, how) {
  if (how === 'replace' && device.playlist_id) await api.clearDevicePlaylist(device.id);
  let playlistId = null;
  for (const id of contentIds) {
    const r = await api.addAssignment(device.id, { content_id: id });
    if (r && r.playlist_id) playlistId = r.playlist_id;
  }
  if (!playlistId) return { ok: true };
  try {
    await api.publishPlaylist(playlistId);
    return { ok: true };
  } catch (err) {
    if (err && /approval|review|changes_requested|deps_changed/.test(String(err.code || ''))) return { ok: true, review: true };
    throw err;
  }
}

async function useSameAs(device, playlist) {
  await api.assignPlaylistToDevice(playlist.id, device.id);
  if (!playlist.published_snapshot) await api.publishPlaylist(playlist.id);
}

function wireDrop(area, input, onFiles) {
  area.addEventListener('click', (e) => { if (!e.target.closest('button')) input.click(); });
  input.addEventListener('change', () => { const f = [...(input.files || [])]; input.value = ''; if (f.length) onFiles(f); });
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('is-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('is-over'));
  area.addEventListener('drop', (e) => { e.preventDefault(); area.classList.remove('is-over'); const f = [...(e.dataTransfer?.files || [])]; if (f.length) onFiles(f); });
}

async function sampleFile() {
  const res = await fetch(SAMPLE_URL);
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  return new File([blob], 'Welcome screen.jpg', { type: blob.type || 'image/jpeg' });
}

/*
 * The workspace's own photos and videos, newest first, as a tap-to-select grid. Capped at
 * LIBRARY_MAX so a large library stays a quick choice here; everything is still in Advanced view's
 * Content page. Hidden when the library has nothing playable yet.
 */
const LIBRARY_MAX = 60;
async function loadLibrary(container, onUse) {
  const block = container.querySelector('[data-library]');
  const grid = container.querySelector('[data-library-grid]');
  const useBtn = container.querySelector('[data-library-use]');
  if (!block || !grid || !useBtn) return;
  let items = [];
  try { items = (await api.getAllContent({ maxItems: 500 })).items || []; } catch { return; }
  items = items
    .filter((c) => /^(image|video)\//.test(c.mime_type || '') && !c.remote_url)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, LIBRARY_MAX);
  if (!items.length || !document.contains(block)) return;
  const picked = [];
  grid.innerHTML = items.map((c) => `
    <button type="button" class="simple-lib-item" data-lib-id="${esc(c.id)}" aria-pressed="false" title="${esc(c.filename || '')}">
      ${c.thumbnail_path ? `<img data-auth-src="/api/content/${esc(c.id)}/thumbnail" alt="">` : `<span class="simple-lib-icon">${String(c.mime_type).startsWith('video/') ? '&#127909;' : '&#128444;'}</span>`}
      <span class="simple-lib-check" aria-hidden="true">&#10003;</span>
      <span class="simple-lib-name">${esc(c.filename || '')}</span>
    </button>`).join('');
  block.hidden = false;
  hydrateAuthImages(grid, { eager: true });
  const paint = () => {
    useBtn.disabled = picked.length === 0;
    useBtn.textContent = picked.length ? tn('simple.library.use_n', picked.length) : t('simple.library.use', { n: 0 });
  };
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lib-id]');
    if (!b) return;
    const id = b.dataset.libId;
    const i = picked.indexOf(id);
    // Order of picking is the order they play in.
    if (i === -1) picked.push(id); else picked.splice(i, 1);
    b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
    paint();
  });
  useBtn.addEventListener('click', () => { if (picked.length) onUse(picked.slice()); });
  paint();
}

function doneBody(lines) {
  return `<p class="simple-lead">${esc(lines[0])}</p>${lines[1] ? `<p class="simple-muted">${esc(lines[1])}</p>` : ''}
    <div class="simple-done-actions">
      <a class="btn btn-primary" href="#/">${esc(t('simple.done.home'))}</a>
      <a class="btn btn-secondary" href="#/simple/change">${esc(t('simple.task.change'))}</a>
    </div>`;
}

// ---------------------------------------------------------------------------------------------
// Task: change what a screen shows
// ---------------------------------------------------------------------------------------------

async function renderChange(container, presetId) {
  let devices = [];
  let playlists = [];
  try { [devices, playlists] = await Promise.all([api.getDevices(), api.getPlaylists()]); } catch { /* shown below */ }
  if (!devices.length) {
    shell(container, guideFrame({ step: 0, total: 1, icon: '&#128250;', title: t('simple.change.no_screens_title'), back: false,
      body: `<p class="simple-lead">${esc(t('simple.home.no_screens'))}</p><div class="simple-done-actions"><a class="btn btn-primary" href="#/add-screen">${esc(t('simple.task.add'))}</a></div>` }));
    return;
  }
  let device = devices.find((d) => d.id === presetId) || (devices.length === 1 ? devices[0] : null);
  const skipPick = !!device;
  const total = skipPick ? 2 : 3;
  let how = 'replace';

  const wireBack = (fn) => container.querySelector('[data-guide-back]')?.addEventListener('click', fn);

  function pickStep() {
    shell(container, guideFrame({ step: 0, total, icon: '&#128250;', title: t('simple.change.pick_title'), back: false,
      body: `<div class="simple-pick">${devices.map((d) => `
        <button type="button" class="simple-screen" data-pick="${esc(d.id)}">
          <span class="simple-screen-shot">${d.screenshot_path ? `<img src="${screenshotUrl(d.id, d.screenshot_at || '')}" alt="">` : '&#128250;'}</span>
          <span class="simple-screen-name">${esc(d.name)}</span>
          <span class="simple-screen-status ${online(d) ? 'on' : 'off'}">${esc(online(d) ? t('simple.status.online') : t('simple.status.offline'))}</span>
        </button>`).join('')}</div>` }));
    container.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      device = devices.find((d) => d.id === b.dataset.pick);
      contentStep();
    }));
  }

  function contentStep() {
    const step = skipPick ? 0 : 1;
    const sharedWith = device.playlist_id ? devices.filter((d) => d.id !== device.id && d.playlist_id === device.playlist_id).map((d) => d.name) : [];
    const others = playlists.filter((p) => (p.item_count || 0) > 0 && p.id !== device.playlist_id);
    shell(container, guideFrame({ step, total, icon: '&#127912;', title: t('simple.change.what_title', { name: device.name }), back: !skipPick,
      body: `
        <div class="simple-choice" role="radiogroup" aria-label="${esc(t('simple.change.how_label'))}">
          <label><input type="radio" name="simpleHow" value="replace" ${how === 'replace' ? 'checked' : ''}> <span><strong>${esc(t('simple.change.replace'))}</strong><small>${esc(t('simple.change.replace_desc'))}</small></span></label>
          <label><input type="radio" name="simpleHow" value="add" ${how === 'add' ? 'checked' : ''}> <span><strong>${esc(t('simple.change.add'))}</strong><small>${esc(sharedWith.length ? t('simple.change.add_shared', { names: sharedWith.join(', ') }) : t('simple.change.add_desc'))}</small></span></label>
        </div>
        <div class="simple-drop" data-drop>
          <div class="simple-drop-icon">&#128193;</div>
          <p>${esc(t('onboarding.step.upload.click_to_select'))}</p>
          <input type="file" data-file multiple accept="${ACCEPT}" hidden>
        </div>
        <div class="simple-or"><span>${esc(t('onboarding.step.upload.or'))}</span> <button type="button" class="btn btn-secondary btn-sm" data-sample>${esc(t('onboarding.step.upload.use_sample'))}</button></div>
        <!-- Photos and videos already in this workspace's library: pick instead of uploading again. -->
        <div class="simple-library" data-library hidden>
          <div class="simple-library-head">
            <span>${esc(t('simple.library.title'))}</span>
            <button type="button" class="btn btn-primary btn-sm" data-library-use disabled>${esc(t('simple.library.use', { n: 0 }))}</button>
          </div>
          <div class="simple-library-grid" data-library-grid></div>
        </div>
        ${others.length ? `
        <div class="simple-sameas">
          <label for="simpleSameAs">${esc(t('onboarding.step.upload.same_as_label'))}</label>
          <div><select id="simpleSameAs" class="input">${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.item_count || 0})</option>`).join('')}</select>
          <button type="button" class="btn btn-primary btn-sm" data-sameas>${esc(t('onboarding.step.upload.same_as_btn'))}</button></div>
        </div>` : ''}
        <p class="simple-status" data-status></p>` }));
    wireBack(pickStep);
    container.querySelectorAll('input[name="simpleHow"]').forEach((r) => r.addEventListener('change', () => { how = r.value; }));
    const status = container.querySelector('[data-status]');
    const busy = (msg) => { status.textContent = msg; container.querySelectorAll('button, input').forEach((e) => { e.disabled = true; }); };
    const fail = (err) => { status.textContent = (err && err.message) || t('onboarding.toast.upload_failed'); container.querySelectorAll('button, input').forEach((e) => { e.disabled = false; }); };

    const go = async (files) => {
      busy(tn('simple.uploading', files.length));
      try {
        const up = await api.uploadContent(files, (pct) => { status.textContent = `${tn('simple.uploading', files.length)} ${pct}%`; });
        const items = (Array.isArray(up) ? up : [up]).filter((c) => c && c.id);
        const r = await showOnScreen(device, items.map((c) => c.id), how);
        doneStep(r.review ? t('simple.done.review') : tn('simple.done.shown', items.length, { name: device.name }));
      } catch (err) { fail(err); }
    };
    wireDrop(container.querySelector('[data-drop]'), container.querySelector('[data-file]'), go);
    loadLibrary(container, async (ids) => {
      busy(t('simple.working'));
      try {
        const r = await showOnScreen(device, ids, how);
        doneStep(r.review ? t('simple.done.review') : tn('simple.done.shown', ids.length, { name: device.name }));
      } catch (err) { fail(err); }
    });
    container.querySelector('[data-sample]').addEventListener('click', async () => {
      try { go([await sampleFile()]); } catch { fail(new Error(t('onboarding.toast.sample_failed'))); }
    });
    container.querySelector('[data-sameas]')?.addEventListener('click', async () => {
      const p = others.find((x) => x.id === container.querySelector('#simpleSameAs').value);
      if (!p) return;
      busy(t('simple.working'));
      try { await useSameAs(device, p); doneStep(t('simple.done.same_as', { name: device.name, playlist: p.name })); } catch (err) { fail(err); }
    });
  }

  function doneStep(line) {
    shell(container, guideFrame({ step: total - 1, total, icon: '&#127881;', title: t('onboarding.step.done.title'), back: false,
      body: doneBody([line, t('simple.done.seconds')]) }));
    api.trackEvent('first_publish', { from: 'simple_change' });
  }

  if (device) contentStep(); else pickStep();
}

// ---------------------------------------------------------------------------------------------
// Task: upload photos (then choose screens)
// ---------------------------------------------------------------------------------------------

async function renderUpload(container) {
  let devices = [];
  try { devices = await api.getDevices(); } catch { devices = []; }
  const total = devices.length ? 3 : 2;
  let uploaded = [];
  let how = 'add';

  function filesStep() {
    shell(container, guideFrame({ step: 0, total, icon: '&#128247;', title: t('simple.upload.title'), back: false,
      body: `
        <div class="simple-drop" data-drop>
          <div class="simple-drop-icon">&#128193;</div>
          <p>${esc(t('onboarding.step.upload.click_to_select'))}</p>
          <input type="file" data-file multiple accept="${ACCEPT}" hidden>
        </div>
        <p class="simple-status" data-status></p>` }));
    const status = container.querySelector('[data-status]');
    wireDrop(container.querySelector('[data-drop]'), container.querySelector('[data-file]'), async (files) => {
      status.textContent = tn('simple.uploading', files.length);
      try {
        const up = await api.uploadContent(files, (pct) => { status.textContent = `${tn('simple.uploading', files.length)} ${pct}%`; });
        uploaded = (Array.isArray(up) ? up : [up]).filter((c) => c && c.id);
        if (devices.length) screensStep();
        else doneOnly(tn('simple.upload.saved', uploaded.length));
      } catch (err) { status.textContent = err.message || t('onboarding.toast.upload_failed'); }
    });
  }

  function screensStep() {
    shell(container, guideFrame({ step: 1, total, icon: '&#128250;', title: tn('simple.upload.where_title', uploaded.length), back: false,
      next: true, nextLabel: t('simple.upload.show_btn'),
      body: `
        <div class="simple-checks">${devices.map((d) => `
          <label><input type="checkbox" value="${esc(d.id)}" checked> <span>${esc(d.name)}</span>
          <small class="simple-screen-status ${online(d) ? 'on' : 'off'}">${esc(online(d) ? t('simple.status.online') : t('simple.status.offline'))}</small></label>`).join('')}</div>
        <div class="simple-choice" role="radiogroup" aria-label="${esc(t('simple.change.how_label'))}">
          <label><input type="radio" name="simpleHow" value="add" checked> <span><strong>${esc(t('simple.change.add'))}</strong><small>${esc(t('simple.change.add_desc'))}</small></span></label>
          <label><input type="radio" name="simpleHow" value="replace"> <span><strong>${esc(t('simple.change.replace'))}</strong><small>${esc(t('simple.change.replace_desc'))}</small></span></label>
        </div>
        <p class="simple-muted">${esc(t('simple.upload.later_hint'))}</p>
        <p class="simple-status" data-status></p>` }));
    container.querySelectorAll('input[name="simpleHow"]').forEach((r) => r.addEventListener('change', () => { how = r.value; }));
    container.querySelector('[data-guide-next]').addEventListener('click', async (e) => {
      const ids = [...container.querySelectorAll('.simple-checks input:checked')].map((i) => i.value);
      const status = container.querySelector('[data-status]');
      if (!ids.length) { doneOnly(tn('simple.upload.saved', uploaded.length)); return; }
      e.target.disabled = true;
      status.textContent = t('simple.working');
      let review = false;
      try {
        // Screens that share one list are updated once, not once per screen.
        const seen = new Set();
        for (const id of ids) {
          const d = devices.find((x) => x.id === id);
          if (!d) continue;
          if (how === 'add' && d.playlist_id && seen.has(d.playlist_id)) continue;
          if (d.playlist_id) seen.add(d.playlist_id);
          const r = await showOnScreen(d, uploaded.map((c) => c.id), how);
          review = review || !!r.review;
        }
        shell(container, guideFrame({ step: total - 1, total, icon: '&#127881;', title: t('onboarding.step.done.title'), back: false,
          body: doneBody([review ? t('simple.done.review') : tn('simple.upload.shown_on', ids.length), t('simple.done.seconds')]) }));
      } catch (err) {
        status.textContent = err.message || t('onboarding.toast.assign_failed');
        e.target.disabled = false;
      }
    });
  }

  function doneOnly(line) {
    shell(container, guideFrame({ step: total - 1, total, icon: '&#9989;', title: t('simple.upload.saved_title'), back: false,
      body: `<p class="simple-lead">${esc(line)}</p><div class="simple-done-actions">
        <a class="btn btn-primary" href="#/">${esc(t('simple.done.home'))}</a>
        ${devices.length ? '' : `<a class="btn btn-secondary" href="#/add-screen">${esc(t('simple.task.add'))}</a>`}</div>` }));
  }

  filesStep();
}

// ---------------------------------------------------------------------------------------------

export function isSimpleRoute(hash) {
  return hash === '#/' || hash === '#' || hash === '' || hash.startsWith('#/simple/');
}

export function render(container, hash = window.location.hash || '#/') {
  cleanup();
  container.classList.add('simple-mode-app');
  document.documentElement.classList.add('simple-shell');
  const q = new URLSearchParams(hash.split('?')[1] || '');
  if (hash.startsWith('#/simple/change')) return renderChange(container, q.get('device'));
  if (hash.startsWith('#/simple/upload')) return renderUpload(container);
  return renderHome(container);
}

export function cleanup() {
  cleanupFns.forEach((fn) => { try { fn(); } catch { /* */ } });
  cleanupFns = [];
  document.getElementById('app')?.classList.remove('simple-mode-app');
  document.documentElement.classList.remove('simple-shell');
}
