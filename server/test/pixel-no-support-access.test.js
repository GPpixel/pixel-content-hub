'use strict';

// Pixel Content Hub has no vendor support access: the sign-in page and Settings don't offer it,
// and the server answers every /api/auth/support endpoint with a 404.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const { freePort } = require('./helpers/free-port');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'js', 'views');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-no-support-'));
let proc; let base; let adminToken;

before(async () => {
  const port = await freePort();
  const logFd = fs.openSync(path.join(TMP, 'server.log'), 'w');
  proc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: path.join(TMP, 'data'), SELF_HOSTED: 'true', PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', logFd, logFd],
  });
  base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/status'); if (r.ok) { up = true; break; } } catch { /* */ } await new Promise((r) => setTimeout(r, 250)); }
  if (!up) throw new Error('server did not boot');
  const res = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@pixel.local', password: 'Passw0rd123' }) });
  adminToken = (await res.json()).token;
  assert.ok(adminToken);
});

after(() => { if (proc) proc.kill(); });

test('every support endpoint is a 404, for an admin and for a stranger', async () => {
  const admin = { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' };
  const calls = [
    ['POST', '/api/auth/support', {}, JSON.stringify({ token: 'STSUP1.x.y' })],
    ['POST', '/api/auth/support/request', admin, '{}'],
    ['GET', '/api/auth/support/status', admin],
    ['POST', '/api/auth/support/generate', admin, '{}'],
    ['DELETE', '/api/auth/support/request/ABCD-EFGH-JKLM-NPQR', admin],
    ['DELETE', '/api/auth/support/grant/deadbeef', admin],
  ];
  for (const [method, url, headers, body] of calls) {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal(r.status, 404, `${method} ${url}`);
  }
});

test('the sign-in page and Settings offer no support access', () => {
  const login = fs.readFileSync(path.join(FRONTEND, 'login.js'), 'utf8');
  const settings = fs.readFileSync(path.join(FRONTEND, 'settings.js'), 'utf8');
  assert.doesNotMatch(login, /supportDetails|supportToken|\/api\/auth\/support/);
  assert.doesNotMatch(settings, /supportAccessSection|\/auth\/support/);
});
