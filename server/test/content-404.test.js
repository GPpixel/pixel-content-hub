'use strict';
/*
 * Unknown content-page URLs must 404, not answer 200 with the dashboard.
 *
 * /guides/, /integrations/ and /solutions/ held upstream's marketing pages, which Pixel Content Hub
 * does not ship. An old link to one must 404, not answer 200 with the dashboard (a soft-404).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('the catch-all refuses content prefixes instead of serving the SPA', () => {
  const m = SRC.match(/const CONTENT_PREFIXES = \[([^\]]*)\]/);
  assert.ok(m, 'CONTENT_PREFIXES must exist');
  assert.match(m[1], /'\/guides\/'/);
  assert.match(m[1], /'\/integrations\/'/);
  assert.match(m[1], /'\/solutions\/'/);

  // The guard has to run BEFORE the sendFile, or it never fires.
  const guard = SRC.indexOf('CONTENT_PREFIXES.some');
  const fallback = SRC.indexOf("res.sendFile(path.join(config.frontendDir, 'index.html'))");
  assert.ok(guard > 0 && fallback > guard, 'the 404 guard must precede the SPA fallback');
});

test('the 404 body is noindex, so a crawler cannot bank it as a page', () => {
  const m = SRC.match(/const NOT_FOUND_PAGE = ([\s\S]*?);\n\n/);
  assert.ok(m, 'NOT_FOUND_PAGE must exist');
  assert.match(m[1], /noindex/, 'a 404 body that omits noindex can still be indexed on a soft serve');
  assert.match(m[1], /Page not found/);
});

