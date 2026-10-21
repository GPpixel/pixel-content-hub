'use strict';

/*
 * Pixel Content Hub never offers a ScreenTinker release: installing one would replace the Pixel
 * changes. The server doesn't poll for them, /api/admin/check-update reports no update, and the
 * dashboard shows no Update badge, Simple home notice or Update Now. See CLAUDE.md.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('the server does not poll GHCR for ScreenTinker releases', () => {
  const src = read('server', 'server.js');
  assert.doesNotMatch(src, /^\s*ghcrCheck\.startPolling\(/m);
});

test('check-update reports no update without asking GHCR', () => {
  const src = read('server', 'routes', 'admin.js');
  assert.match(src, /const PIXEL_NO_UPSTREAM_UPDATES = true;/);
  const at = src.indexOf("router.post('/check-update'");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('ghcrCheck.checkNow', at));
  assert.match(body, /if \(PIXEL_NO_UPSTREAM_UPDATES\) return res\.json\(\{ current: VERSION, latest: null, update_available: false \}\)/);
});

test('the System page hides the latest-version card and the update buttons', () => {
  const src = read('frontend', 'js', 'views', 'admin.js');
  assert.match(src, /const PIXEL_NO_UPSTREAM_UPDATES = true;/);
  assert.match(src, /const versionComparison = PIXEL_NO_UPSTREAM_UPDATES \? '' :/);
  assert.match(src, /\$\{PIXEL_NO_UPSTREAM_UPDATES \? '' : `<button class="btn btn-secondary btn-sm" id="checkUpdateBtn">/);
});

test('the Simple top bar shows the Pixel lockup, not a plain product name', () => {
  const src = read('frontend', 'js', 'views', 'simple-home.js');
  assert.match(src, /class="simple-brand pixel-lockup"/);
  assert.match(src, /pixel-inspiration-logo-white\.svg/);
  assert.doesNotMatch(src, /\|\| 'ScreenTinker'\)/);
});
