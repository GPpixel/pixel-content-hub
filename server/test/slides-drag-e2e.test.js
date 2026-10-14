'use strict';

/*
 * Slides editor: dragging an element moves THAT element — in a real headless Chrome, with real
 * mouse events, against a real server.
 *
 * Reported from daily use: "when moving an item around, another item is shown moving instead of the
 * one I selected." The canvas drew the background photo (and its dim scrim) as the first children
 * of the stage, and the drag picked its live node with `stage.children[i]` — so on any slide with a
 * background photo the node under the pointer was a DIFFERENT element (or the photo itself), which
 * slid around while the selected element's numbers changed invisibly and jumped on release.
 *
 * Every scenario snapshots every element's box before, mid-drag (the moment the bug is visible),
 * after release, and in the saved deck, and asserts only the pressed element changed.
 *
 * Skips cleanly when there is no Chrome or no puppeteer-core, like the other browser suites.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SKIP, sleep, waitFor, startServer, launch } = require('./helpers/web-player-e2e');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser, page;
const errors = [];

before(async () => {
  if (SKIP) return;
  srv = await startServer('slides-drag');
  browser = await launch();
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${srv.base}/app#/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((tok) => {
    localStorage.setItem('token', tok);
    localStorage.setItem('rd_onboarded', '1');
  }, srv.token);
});
after(async () => {
  try { if (browser) await browser.close(); } catch { /* */ }
  if (srv) srv.stop();
});

/* ------------------------------------------------------------------ deck builders */

const text = (slot, kind, x, y, w) => ({ slot, kind, box: { x, y, w },
  style: { color: '#ffffff', size_cqw: 4, weight: 700 }, motion: { animation: 'none', delay: 0, duration: 0.6 } });
const block = (slot, x, y, w, h, color) => ({ slot, kind: 'box', box: { x, y, w, h },
  style: { color }, motion: { animation: 'none', delay: 0, duration: 0.6 } });

/** Three elements, two of them overlapping, on a plain background. */
function handMadeSlide(extra = {}) {
  return {
    name: 'Hand made', dwell_sec: 10,
    template: { background: '#101820', elements: [
      text('title', 'head', 8, 10, 40),
      block('card', 30, 18, 30, 30, '#3366ff'),
      text('detail', 'body', 55, 70, 35),
    ], ...extra },
    fields: { title: 'Headline here', detail: 'A line of detail' },
  };
}

async function makeDeck(name, slides) {
  const d = await srv.api('POST', '/slide-decks', { name, doc: { aspect: '16:9', slides } });
  return d.id;
}

/** The community lobby-welcome template, with its params filled from the manifest defaults. */
function lobbyWelcomeSlide() {
  const dir = path.join(ROOT, 'catalog', 'templates', 'lobby-welcome');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const defaults = Object.fromEntries(manifest.params.map((p) => [p.name, p.type === 'image' ? null : p.default]));
  const raw = fs.readFileSync(path.join(dir, 'template.json'), 'utf8');
  const filled = JSON.parse(raw, (k, v) => {
    if (typeof v !== 'string') return v;
    const m = /^\{\{param:([a-z_]+)\}\}$/.exec(v);
    return m ? (defaults[m[1]] == null ? null : defaults[m[1]]) : v;
  });
  return { name: 'Lobby', dwell_sec: 15, template: filled.template, fields: filled.fields };
}

/* ------------------------------------------------------------------ page driving */

async function openDeck(id) {
  await page.goto(`${srv.base}/app#/slides`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  const opened = await waitFor(() => page.evaluate((deckId) => {
    const b = [...document.querySelectorAll('[data-open]')].find((x) => x.dataset.open === deckId);
    if (b) { b.click(); return true; }
    return false;
  }, id), 15000, 150);
  assert.ok(opened, 'the deck appeared in the list');
  const deck = await srv.api('GET', `/slide-decks/${id}`);
  const n = deck.doc.slides[0].template.elements.length;
  assert.ok(await waitFor(() => page.evaluate((count) => {
    const st = document.getElementById('stage');
    return !!st && st.children.length >= count;
  }, n), 15000, 150), 'the stage painted');
  await sleep(300);
}

/** Every element node on the stage, in element order: the stage's last `n` children. */
function boxes(n) {
  return page.evaluate((count) => {
    const st = document.getElementById('stage');
    const kids = [...st.children].slice(-count);
    return kids.map((k) => { const r = k.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  }, n);
}

/** A viewport point where element `i` is the thing the pointer actually hits. */
function hitPoint(n, i) {
  return page.evaluate((count, idx) => {
    const st = document.getElementById('stage');
    const node = [...st.children].slice(-count)[idx];
    const r = node.getBoundingClientRect();
    for (let fy = 0.5; fy < 1; fy += 0.1) {
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        for (const sy of [fy, 1 - fy]) {
          const x = r.left + r.width * fx; const y = r.top + r.height * sy;
          const hit = document.elementFromPoint(x, y);
          if (hit && node.contains(hit)) return { x, y };
        }
      }
    }
    return null;
  }, n, i);
}

const near = (a, b) => Math.abs(a - b) < 0.75;
const sameBox = (a, b) => near(a.l, b.l) && near(a.t, b.t) && near(a.w, b.w) && near(a.h, b.h);
const savedBoxes = async (id) => (await srv.api('GET', `/slide-decks/${id}`)).doc.slides[0].template.elements.map((e) => e.box);

function assertOnlyMoved(beforeB, afterB, i, dx, dy, when) {
  for (let k = 0; k < beforeB.length; k++) {
    if (k === i) {
      assert.ok(Math.abs((afterB[k].l - beforeB[k].l) - dx) < 3 && Math.abs((afterB[k].t - beforeB[k].t) - dy) < 3,
        `${when}: the dragged element #${i} should follow the pointer by (${dx},${dy}); moved by (${
          (afterB[k].l - beforeB[k].l).toFixed(1)},${(afterB[k].t - beforeB[k].t).toFixed(1)})`);
    } else {
      assert.ok(sameBox(beforeB[k], afterB[k]),
        `${when}: element #${k} must not move while #${i} is dragged (${JSON.stringify(beforeB[k])} -> ${JSON.stringify(afterB[k])})`);
    }
  }
}

/**
 * Press on element `i`, drag it by (dx,dy) with real mouse events, release, save; assert at every
 * stage that only element `i` changed, on the canvas and in the stored deck.
 */
async function dragAndCheck(deckId, i, dx = 40, dy = 25) {
  const deck = await srv.api('GET', `/slide-decks/${deckId}`);
  const n = deck.doc.slides[0].template.elements.length;
  const storedBefore = deck.doc.slides[0].template.elements.map((e) => e.box);
  const pt = await hitPoint(n, i);
  assert.ok(pt, `element #${i} can be pressed somewhere`);
  const before0 = await boxes(n);

  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  for (let s = 1; s <= 6; s++) { await page.mouse.move(pt.x + (dx * s) / 6, pt.y + (dy * s) / 6); await sleep(20); }
  // Pointer moves are delivered on the next frame; measure after they land.
  await sleep(120);
  const mid = await boxes(n);
  // The pressed element is the selected one.
  const selected = await page.evaluate((count) => [...document.getElementById('stage').children].slice(-count)
    .map((k) => /solid/.test(k.style.outline || '')), n);
  await page.mouse.up();
  await sleep(150);
  const done = await boxes(n);

  assert.deepEqual(selected.map((v, k) => (v ? k : -1)).filter((k) => k >= 0), [i], 'the pressed element is selected');
  assertOnlyMoved(before0, mid, i, dx, dy, 'mid-drag');
  assertOnlyMoved(before0, done, i, dx, dy, 'after release');

  await page.click('#saveBtn');
  const stored = await waitFor(async () => {
    const b = await savedBoxes(deckId);
    return (b[i].x !== storedBefore[i].x || b[i].y !== storedBefore[i].y) ? b : null;
  }, 10000, 150);
  assert.ok(stored, 'the save reached the server');
  await sleep(500);   // and its response reached the editor, which repaints from the saved deck
  for (let k = 0; k < n; k++) {
    if (k === i) continue;
    assert.deepEqual(stored[k], storedBefore[k], `saved: element #${k} must be untouched when #${i} was dragged`);
  }
  assert.ok(stored[i].x > storedBefore[i].x && stored[i].y > storedBefore[i].y, `saved: element #${i} moved right and down`);
}

/* ------------------------------------------------------------------ scenarios */

describe('Slides editor: drag moves the selected element and nothing else', { skip: SKIP }, () => {
  test('a hand-made deck with overlapping elements', async () => {
    const id = await makeDeck('Drag plain', [handMadeSlide()]);
    await openDeck(id);
    for (const i of [1, 0, 2]) await dragAndCheck(id, i);
  });

  test('a slide with a background photo and dim — the reported bug', async () => {
    const photo = await srv.upload(path.join(ROOT, 'catalog', 'templates', 'lobby-welcome', 'thumbnail.png'), 'image/png');
    assert.ok(photo && photo.id, 'uploaded a background photo');
    const id = await makeDeck('Drag photo', [handMadeSlide({ background_content_id: photo.id, background_dim: 0.3 })]);
    await openDeck(id);
    const hasPhoto = await page.evaluate(() => document.getElementById('stage').children.length);
    assert.ok(hasPhoto > 3, 'precondition: the photo and scrim are on the stage');
    for (const i of [0, 1, 2]) await dragAndCheck(id, i);
  });

  test('after reordering layers and after adding an element', async () => {
    const id = await makeDeck('Drag reorder', [handMadeSlide()]);
    await openDeck(id);
    // Select the headline from the layers list and bring it forward (it becomes element #1).
    await page.evaluate(() => document.querySelector('[data-el="0"]').click());
    await page.evaluate(() => document.querySelector('.tabBtn[data-tab="content"]').click());
    await page.evaluate(() => document.getElementById('pFwd').click());
    await page.click('#saveBtn');
    await waitFor(async () => (await savedBoxes(id))[1].x === 8, 10000, 150);
    await sleep(500);
    for (const i of [1, 0]) await dragAndCheck(id, i);
    // Add a box from the tool rail; it lands on top of the others.
    await page.evaluate(() => document.querySelector('[data-add="box"]').click());
    await page.click('#saveBtn');
    await waitFor(async () => (await savedBoxes(id)).length === 4, 10000, 150);
    await sleep(500);
    for (const i of [3, 2]) await dragAndCheck(id, i, 30, 20);
  });

  test('a deck made with Make a sign', async () => {
    const made = await srv.api('POST', '/signs', { template: 'celebration', values: { title: 'Happy birthday', name: 'Sam' } });
    await openDeck(made.deck_id);
    const n = (await savedBoxes(made.deck_id)).length;
    assert.ok(n >= 3, 'the sign has several elements');
    let dragged = 0;
    for (let i = n - 1; i >= 0 && dragged < 3; i--) {
      if (!(await hitPoint(n, i))) continue;      // fully covered by something above it
      await dragAndCheck(made.deck_id, i, 20, 15);
      dragged++;
    }
    assert.ok(dragged >= 2, 'at least two sign elements were dragged');
  });

  test('a deck shaped like the community lobby-welcome template', async () => {
    const id = await makeDeck('Drag lobby', [lobbyWelcomeSlide()]);
    await openDeck(id);
    const n = (await savedBoxes(id)).length;
    let dragged = 0;
    for (let i = n - 1; i >= 0 && dragged < 3; i--) {
      if (!(await hitPoint(n, i))) continue;
      await dragAndCheck(id, i, 20, 15);
      dragged++;
    }
    assert.ok(dragged >= 2, 'at least two template elements were dragged');
  });

  test('no uncaught errors', () => {
    assert.deepEqual(errors, []);
  });
});
