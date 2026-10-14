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
import { isPlatformAdmin, inManagerApp, openOutsideApp } from '../utils.js';
import { renderStatsPrompt } from './dashboard.js';
import { publishOrSubmit } from '../components/release.js';

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
            ${isPlatformAdmin(u) ? (inManagerApp()
              ? `<button type="button" data-outside="/app#/platform/overview">${esc(t('simple.menu.admin'))} &#8599;</button>`
              : `<a href="#/platform/overview">${esc(t('simple.menu.admin'))}</a>`) : ''}
            ${showPlan ? `<a href="#/billing">${esc(t('simple.menu.plan'))}</a>` : ''}
            ${inManagerApp()
              ? `<button type="button" data-outside="/app#/settings">${esc(t('simple.menu.settings'))} &#8599;</button>`
              : `<a href="#/settings">${esc(t('simple.menu.settings'))}</a>`}
            ${inManagerApp() && window.STManager ? `<button type="button" data-change-server>${esc(t('simple.menu.change_server'))}</button>` : ''}
            <a href="#/simple/help">${esc(t('simple.menu.help'))}</a>
            <button type="button" data-simple-signout>${esc(t('auth.sign_out'))}</button>
          </div>
        </details>
      </div>
    </div>
    <div class="simple-page">${inner}</div>`;
  container.querySelector('[data-simple-mode="advanced"]').addEventListener('click', () => setUiMode('advanced'));
  container.querySelectorAll('[data-outside]').forEach((b) => b.addEventListener('click', () => openOutsideApp(b.dataset.outside)));
  container.querySelector('[data-change-server]')?.addEventListener('click', () => window.STManager.changeServer());
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
    <div id="simpleAdminNotices"></div>
    <h1 class="simple-h1">${esc(t('simple.home.title'))}</h1>
    <div class="simple-tasks">
      <a class="simple-task" href="#/add-screen"><span class="simple-task-icon">&#10133;</span><span><strong>${esc(t('simple.task.add'))}</strong><small>${esc(t('simple.task.add_desc'))}</small></span></a>
      <a class="simple-task" href="#/simple/change"><span class="simple-task-icon">&#9998;</span><span><strong>${esc(t('simple.task.change'))}</strong><small>${esc(t('simple.task.change_desc'))}</small></span></a>
      <a class="simple-task" href="#/simple/upload"><span class="simple-task-icon">&#128247;</span><span><strong>${esc(t('simple.task.upload'))}</strong><small>${esc(t('simple.task.upload_desc'))}</small></span></a>
      ${canManageTeam() ? `<a class="simple-task" href="#/simple/team"><span class="simple-task-icon">&#128101;</span><span><strong>${esc(t('simple.task.team'))}</strong><small>${esc(t('simple.task.team_desc'))}</small></span></a>` : ''}
      <a class="simple-task" href="#/simple/help"><span class="simple-task-icon">&#10067;</span><span><strong>${esc(t('simple.task.help'))}</strong><small>${esc(t('simple.task.help_desc'))}</small></span></a>
    </div>
    <h2 class="simple-h2">${esc(t('simple.home.your_screens'))}</h2>
    <div id="simpleScreens" class="simple-screens"><p class="simple-muted">${esc(t('common.loading'))}</p></div>`);

  adminNotices(document.getElementById('simpleAdminNotices'));
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

/*
 * For the person who runs the server (platform admins only): the two things the Advanced shell
 * would have told them — a new version is out (the sidebar's Update badge), and the one-time
 * "share install statistics?" question (the Advanced dashboard's prompt, reused as is: it asks once
 * and only while the decision is unmade).
 */
async function adminNotices(host) {
  const u = cachedUser();
  if (!host || !isPlatformAdmin(u)) return;
  try {
    const v = await (await fetch('/api/version')).json();
    if (v && v.update_available && document.contains(host)) {
      const card = document.createElement('div');
      card.className = 'simple-notice';
      const text = document.createElement('span');
      text.textContent = t('simple.admin.update', { latest: v.latest_version || '', current: v.version || '' });
      const link = document.createElement('a');
      link.className = 'btn btn-primary btn-sm';
      link.href = '#/platform/system';
      link.textContent = t('simple.admin.update_how');
      card.append(text, link);
      host.appendChild(card);
    }
  } catch { /* the version check is a courtesy */ }
  try { await renderStatsPrompt(host); } catch { /* likewise */ }
}

// ---------------------------------------------------------------------------------------------
// Task: your team — invite someone to this workspace, see who is in it.
// Uses the workspace member/invite API the Advanced Members page uses (admin-only server-side).
// ---------------------------------------------------------------------------------------------

function currentWorkspace() {
  const u = cachedUser() || {};
  return (u.accessible_workspaces || []).find((w) => w.id === u.current_workspace_id) || null;
}
function canManageTeam() { const w = currentWorkspace(); return !!(w && w.can_admin); }

const ROLE_KEYS = {
  workspace_admin: 'simple.team.role_admin', workspace_editor: 'simple.team.role_editor', workspace_viewer: 'simple.team.role_viewer',
  org_owner: 'simple.team.role_owner', org_admin: 'simple.team.role_org_admin',
};

/** Pass an invite link on: Android's share sheet in the app, the browser's, or the clipboard. */
async function passOn(text) {
  if (inManagerApp() && window.STManager && typeof window.STManager.shareText === 'function') { window.STManager.shareText(text); return 'shared'; }
  if (navigator.share) { try { await navigator.share({ text }); return 'shared'; } catch { /* cancelled: fall through */ } }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}

async function renderTeam(container) {
  const ws = currentWorkspace();
  if (!ws || !ws.can_admin) { window.location.hash = '#/'; return; }
  shell(container, `
    <div class="simple-help-top"><a href="#/" class="btn btn-secondary btn-sm">&larr; ${esc(t('simple.done.home'))}</a></div>
    <h1 class="simple-h1">${esc(t('simple.team.title'))}</h1>
    <div class="simple-card">
      <h3 class="simple-card-title">${esc(t('simple.team.invite_title'))}</h3>
      <label class="simple-label" for="teamEmail">${esc(t('simple.team.email'))}</label>
      <input id="teamEmail" class="input" type="email" autocomplete="off" inputmode="email" placeholder="name@example.com">
      <div class="simple-choice" role="radiogroup" aria-label="${esc(t('simple.team.can'))}" style="margin-top:12px">
        ${['workspace_editor', 'workspace_viewer', 'workspace_admin'].map((r, i) => `
          <label><input type="radio" name="teamRole" value="${r}" ${i === 0 ? 'checked' : ''}> <span><strong>${esc(t(ROLE_KEYS[r]))}</strong><small>${esc(t(ROLE_KEYS[r] + '_desc'))}</small></span></label>`).join('')}
      </div>
      <button type="button" class="btn btn-primary" data-invite>${esc(t('simple.team.invite_btn'))}</button>
      <div class="simple-status" data-status></div>
    </div>
    <h2 class="simple-h2">${esc(t('simple.team.people'))}</h2>
    <div class="simple-card simple-people" data-people><p class="simple-muted">${esc(t('common.loading'))}</p></div>`);

  const status = container.querySelector('[data-status]');
  const people = container.querySelector('[data-people]');
  const me = (cachedUser() || {}).id;

  async function loadPeople() {
    let members = [], invites = [];
    try { [members, invites] = await Promise.all([api.getWorkspaceMembers(ws.id), api.getWorkspaceInvites(ws.id)]); } catch { /* shown empty */ }
    const rows = [
      ...members.map((m) => `
        <div class="simple-person">
          <span><strong>${esc(m.name || m.email)}</strong><small>${esc(m.email)}${m.user_id === me ? ` · ${esc(t('simple.team.you'))}` : ''}</small></span>
          <span class="simple-person-role">${esc(t(ROLE_KEYS[m.role] || 'simple.team.role_viewer'))}</span>
          ${!m.via_org && m.user_id !== me ? `<button type="button" class="btn btn-secondary btn-sm" data-remove="${esc(m.user_id)}" data-name="${esc(m.name || m.email)}">${esc(t('simple.team.remove'))}</button>` : '<span></span>'}
        </div>`),
      ...(invites || []).map((i) => `
        <div class="simple-person is-pending">
          <span><strong>${esc(i.email)}</strong><small>${esc(t('simple.team.invited'))}</small></span>
          <span class="simple-person-role">${esc(t(ROLE_KEYS[i.role] || 'simple.team.role_viewer'))}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-cancel="${esc(i.id)}">${esc(t('simple.team.cancel_invite'))}</button>
        </div>`),
    ];
    people.innerHTML = rows.join('') || `<p class="simple-muted">${esc(t('simple.team.nobody'))}</p>`;
    people.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.cancelWorkspaceInvite(ws.id, b.dataset.cancel); loadPeople(); } catch (err) { showToast(err.message, 'error'); }
    }));
    people.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm(t('simple.team.remove_confirm', { name: b.dataset.name }))) return;
      try { await api.removeWorkspaceMember(ws.id, b.dataset.remove); loadPeople(); } catch (err) { showToast(err.message, 'error'); }
    }));
  }

  container.querySelector('[data-invite]').addEventListener('click', async (e) => {
    const email = container.querySelector('#teamEmail').value.trim();
    const role = container.querySelector('input[name="teamRole"]:checked').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = t('simple.team.bad_email'); return; }
    e.target.disabled = true;
    status.textContent = t('simple.working_invite');
    try {
      const r = await api.inviteWorkspaceMember(ws.id, { email, role });
      container.querySelector('#teamEmail').value = '';
      status.innerHTML = '';
      const msg = document.createElement('p');
      msg.textContent = r.email_sent ? t('simple.team.sent', { email }) : t('simple.team.not_emailed', { email });
      status.appendChild(msg);
      if (r.accept_url) {
        const share = document.createElement('button');
        share.type = 'button';
        share.className = 'btn btn-secondary btn-sm';
        share.style.marginTop = '8px';
        share.textContent = t(inManagerApp() || navigator.share ? 'simple.team.share_link' : 'simple.team.copy_link');
        share.addEventListener('click', async () => {
          const res = await passOn(t('simple.team.share_text', { name: ws.name, url: r.accept_url }));
          if (res === 'copied') showToast(t('simple.team.copied'), 'success');
        });
        status.appendChild(share);
      }
      loadPeople();
    } catch (err) {
      status.textContent = err.message || t('simple.team.failed');
    } finally { e.target.disabled = false; }
  });
  loadPeople();
}

// ---------------------------------------------------------------------------------------------
// Shared: put content on a screen
// ---------------------------------------------------------------------------------------------

/**
 * Show `contentIds` on `device`, published through the normal endpoint (so a workspace that reviews
 * changes keeps them as a draft for review).
 *
 * 'add': appended to the list the screen plays now.
 * 'replace': the screen ends up playing exactly these items, WITHOUT minting a new playlist each
 * time (Replace used to detach the screen and let the server create "<Screen> playlist" afresh on
 * every use, so the Playlists page filled up with copies):
 *   1. the screen's own auto-generated list, used by no other screen → emptied and refilled in place;
 *   2. otherwise (it follows a shared or hand-made list) → its earlier own list is re-attached if one
 *      exists that no screen uses ("<Screen> playlist", auto-generated), then refilled — so a screen
 *      that went "same as" and back reuses its list;
 *   3. only when neither exists is a list created, once per screen.
 * A shared or hand-made list is never edited by Replace: another screen or a schedule may use it.
 */
async function showOnScreen(device, contentIds, how, ctx = {}) {
  const devices = ctx.devices || [];
  const playlists = ctx.playlists || [];
  const usedByOthers = (pid) => devices.some((d) => d.id !== device.id && d.playlist_id === pid);
  const current = playlists.find((p) => p.id === device.playlist_id);

  if (how === 'replace') {
    const ownAuto = current && current.is_auto_generated && !usedByOthers(current.id);
    if (!ownAuto) {
      const spare = playlists.find((p) => p.is_auto_generated && p.name === `${device.name} playlist`
        && p.id !== device.playlist_id && !devices.some((d) => d.playlist_id === p.id));
      if (spare) {
        await api.assignPlaylistToDevice(spare.id, device.id);
        device.playlist_id = spare.id;
      } else if (device.playlist_id) {
        await api.clearDevicePlaylist(device.id); // the next add creates this screen's own list, once
        device.playlist_id = null;
      }
    }
    if (device.playlist_id) {
      const existing = await api.getAssignments(device.id).catch(() => []);
      for (const item of existing || []) await api.deleteAssignment(item.id, device.id);
    }
  }

  let playlistId = device.playlist_id || null;
  for (const id of contentIds) {
    const r = await api.addAssignment(device.id, { content_id: id });
    if (r && r.playlist_id) playlistId = r.playlist_id;
  }
  if (!playlistId) return { ok: true };
  device.playlist_id = playlistId;
  const state = await publishOrSubmit(playlistId, { note: `From the Simple view: ${device.name}` });
  return { ok: true, review: state === 'review' };
}

async function useSameAs(device, playlist) {
  await api.assignPlaylistToDevice(playlist.id, device.id);
  if (!playlist.published_snapshot) return (await publishOrSubmit(playlist.id)) === 'review';
  return false;
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
        const r = await showOnScreen(device, items.map((c) => c.id), how, { devices, playlists });
        doneStep(r.review ? t('simple.done.review', { name: device.name }) : tn('simple.done.shown', items.length, { name: device.name }), r.review);
      } catch (err) { fail(err); }
    };
    wireDrop(container.querySelector('[data-drop]'), container.querySelector('[data-file]'), go);
    loadLibrary(container, async (ids) => {
      busy(t('simple.working'));
      try {
        const r = await showOnScreen(device, ids, how, { devices, playlists });
        doneStep(r.review ? t('simple.done.review', { name: device.name }) : tn('simple.done.shown', ids.length, { name: device.name }), r.review);
      } catch (err) { fail(err); }
    });
    container.querySelector('[data-sample]').addEventListener('click', async () => {
      try { go([await sampleFile()]); } catch { fail(new Error(t('onboarding.toast.sample_failed'))); }
    });
    container.querySelector('[data-sameas]')?.addEventListener('click', async () => {
      const p = others.find((x) => x.id === container.querySelector('#simpleSameAs').value);
      if (!p) return;
      busy(t('simple.working'));
      try {
        const review = await useSameAs(device, p);
        doneStep(review ? t('simple.done.review', { name: device.name }) : t('simple.done.same_as', { name: device.name, playlist: p.name }), review);
      } catch (err) { fail(err); }
    });
  }

  // Live: "It's live!". In review: "Sent for review" — nothing claims to be showing until approved.
  function doneStep(line, review = false) {
    shell(container, guideFrame({ step: total - 1, total, icon: review ? '&#9203;' : '&#127881;',
      title: t(review ? 'simple.done.review_title' : 'onboarding.step.done.title'), back: false,
      body: doneBody([line, t(review ? 'simple.done.review_hint' : 'simple.done.seconds')]) }));
    if (!review) api.trackEvent('first_publish', { from: 'simple_change' });
  }

  if (device) contentStep(); else pickStep();
}

// ---------------------------------------------------------------------------------------------
// Task: upload photos (then choose screens)
// ---------------------------------------------------------------------------------------------

async function renderUpload(container, presetIds = []) {
  let devices = [];
  let playlists = [];
  try { [devices, playlists] = await Promise.all([api.getDevices(), api.getPlaylists()]); } catch { devices = devices || []; }
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
          const r = await showOnScreen(d, uploaded.map((c) => c.id), how, { devices, playlists });
          review = review || !!r.review;
        }
        shell(container, guideFrame({ step: total - 1, total, icon: review ? '&#9203;' : '&#127881;',
          title: t(review ? 'simple.done.review_title' : 'onboarding.step.done.title'), back: false,
          body: doneBody([review ? tn('simple.upload.review_on', ids.length) : tn('simple.upload.shown_on', ids.length),
            t(review ? 'simple.done.review_hint' : 'simple.done.seconds')]) }));
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

  // Shared from the phone's Gallery (Manager app): the files are already uploaded; go straight to
  // "which screens?".
  if (presetIds.length) {
    uploaded = presetIds.map((id) => ({ id }));
    if (devices.length) screensStep(); else doneOnly(tn('simple.upload.saved', uploaded.length));
    return;
  }
  filesStep();
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Help, inside Simple view. The full Help page is about the whole product (widgets, layouts,
// kiosks, video walls) and opens in the full shell; this one answers what Simple view does, keeps
// the top bar, and always has a way home. Guide text is English like views/help.js (see its note);
// the page chrome is translated.
// ---------------------------------------------------------------------------------------------

const SIMPLE_GUIDES = [
  { icon: '&#10133;', title: 'Connect a screen', steps: [
    'On the TV, tablet or computer you want to use, open the player: install the Android app, or open this site\'s /player page in its web browser.',
    'No TV handy? Open the player in another browser tab to try it.',
    'The player shows a 6-digit code. Here, choose "Add a screen" and type it in.',
    'Give the screen a name you will recognise, like "Front window".',
  ] },
  { icon: '&#9998;', title: 'Change what a screen shows', steps: [
    'Choose "Change what a screen shows", or tap the screen under "Your screens".',
    'Pick "Replace" to show only the new things, or "Add" to keep what is already playing.',
    'Upload photos or videos, pick ones you uploaded before, or show the same as another screen.',
    'The screen updates within a few seconds.',
  ] },
  { icon: '&#128247;', title: 'Upload photos and videos', steps: [
    'Choose "Upload photos" and pick as many files as you like, or drag them in.',
    'Tick the screens that should show them, or untick them all to keep them for later.',
    'Photos show for 10 seconds each; videos play to the end.',
  ] },
];

const SIMPLE_FAQ = [
  { q: 'What can I use as a screen?', a: 'Android TVs, TV boxes and tablets, Fire TV, LG and Samsung smart TVs, Raspberry Pi, Windows and ChromeOS — or any device with a web browser.' },
  { q: 'My screen is not changing. What should I check?', a: 'Make sure the screen shows "Playing" on the home page. If it says "Offline", check that the device is on and connected to the internet; it picks up your changes as soon as it reconnects.' },
  { q: 'What happens if the internet goes down?', a: 'Screens keep the content locally and carry on playing it. New changes arrive when the connection comes back.' },
  { q: 'Which files can I upload?', a: 'Photos (JPEG, PNG, GIF, WebP) and videos (MP4 works best), plus audio. PDFs can be uploaded from the Content page in Advanced view.' },
  { q: 'How do I rename or remove a screen?', a: 'Switch to Advanced (top right), open Screens, click the screen, then use Rename or Remove at the top of its page.' },
  { q: 'Can I show different things at different times of day?', a: 'Yes — that is Schedule, in Advanced view. Simple view always shows the same content on a screen until you change it.' },
];

function renderHelp(container) {
  const u = cachedUser() || {};
  const trial = plansVisible(u)
    ? [{ q: 'How does the free trial work?', a: 'You get 14 days of the Pro plan with every feature unlocked and no card required. When it ends you move to the Free plan: nothing is deleted, and screens beyond the Free plan pause until you choose a plan.' }]
    : [];
  shell(container, `
    <div class="simple-help-top"><a href="#/" class="btn btn-secondary btn-sm">&larr; ${esc(t('simple.done.home'))}</a></div>
    <h1 class="simple-h1">${esc(t('simple.help.title'))}</h1>
    <div class="simple-help-guides">${SIMPLE_GUIDES.map((g) => `
      <div class="simple-card">
        <h3>${g.icon} ${esc(g.title)}</h3>
        <ol>${g.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
      </div>`).join('')}
    </div>
    <h2 class="simple-h2">${esc(t('simple.help.faq'))}</h2>
    <div class="simple-card simple-faq">${[...SIMPLE_FAQ, ...trial].map((f) => `
      <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
    </div>
    <div class="simple-card simple-help-more">
      <p>${esc(t('simple.help.more'))}</p>
      <button type="button" class="btn btn-secondary" data-help-advanced>${esc(t('simple.help.more_btn'))}</button>
    </div>`);
  container.querySelector('[data-help-advanced]').addEventListener('click', async () => {
    if (inManagerApp()) { openOutsideApp('/app#/switch-advanced?next=help'); return; }
    await setUiMode('advanced');
    window.location.hash = '#/help';
  });
}

/*
 * Simple view, on any OTHER page (Plan & billing, Account settings, a bookmark): no sidebar, and a
 * slim bar with the way home and the view switch, so Simple never strands someone in the full shell.
 * Mounted above #app by app.js; removed in Advanced view and on Simple's own pages (which have a
 * top bar of their own).
 */
export function mountBackBar() {
  if (document.getElementById('simpleBackBar')) return;
  const app = document.getElementById('app');
  if (!app || !app.parentNode) return;
  const bar = document.createElement('div');
  bar.id = 'simpleBackBar';
  bar.className = 'simple-backbar';
  bar.innerHTML = `
    <a href="#/" class="btn btn-secondary btn-sm">&larr; ${esc(t('simple.done.home'))}</a>
    <div class="ui-mode-switch simple-switch" role="radiogroup" aria-label="${esc(t('simple.view_label'))}">
      <button type="button" role="radio" aria-checked="true">${esc(t('nav.view_simple'))}</button>
      <button type="button" role="radio" aria-checked="false" data-simple-mode="advanced">${esc(t('nav.view_advanced'))}</button>
    </div>`;
  bar.querySelector('[data-simple-mode="advanced"]').addEventListener('click', () => setUiMode('advanced'));
  app.parentNode.insertBefore(bar, app);
}

export function removeBackBar() {
  document.getElementById('simpleBackBar')?.remove();
}

export function isSimpleRoute(hash) {
  return hash === '#/' || hash === '#' || hash === '' || hash.startsWith('#/simple/');
}

export function render(container, hash = window.location.hash || '#/') {
  cleanup();
  removeBackBar();
  container.classList.add('simple-mode-app');
  document.documentElement.classList.add('simple-shell');
  const q = new URLSearchParams(hash.split('?')[1] || '');
  if (hash.startsWith('#/simple/change')) return renderChange(container, q.get('device'));
  if (hash.startsWith('#/simple/upload')) return renderUpload(container, (q.get('ids') || '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)));
  if (hash.startsWith('#/simple/help')) return renderHelp(container);
  if (hash.startsWith('#/simple/team')) return renderTeam(container);
  return renderHome(container);
}

export function cleanup() {
  cleanupFns.forEach((fn) => { try { fn(); } catch { /* */ } });
  cleanupFns = [];
  document.getElementById('app')?.classList.remove('simple-mode-app');
  document.documentElement.classList.remove('simple-shell');
}
