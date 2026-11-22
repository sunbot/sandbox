// Shared helpers for the browser regression tests (see README.md in this folder).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = process.env.E2E_DIST ?? path.join(here, '..', 'dist-e2e');

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };

/** Serves the web export with a single-page-app fallback (any unknown path gets index.html), on a free port. */
export async function serve(dir = DIST) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`No web export at ${dir}. Run: npm run e2e:build`);
  const server = http.createServer((q, r) => {
    let f = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html');
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}

/** Playwright from the project (CI: `npm i --no-save playwright`) or a global install found through NODE_PATH. */
export async function browser() {
  const { chromium } = createRequire(import.meta.url)('playwright');
  return chromium.launch();
}

/** A phone-sized touch context (the app is used on phones). */
export const phone = (b, opts = {}) => b.newContext({ viewport: { width: 393, height: 860 }, hasTouch: true, isMobile: true, ...opts });

export const N = (calories, protein = 0, carbs = 0, fat = 0, fiber = 0) => ({ calories, protein, carbs, fat, fiber, nutrients: {} });

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const TARGETS = { calories: 2000, proteinGrams: 120, carbGrams: 220, fatGrams: 70, budgetMode: 'Daily', weekStartsOn: 'Monday', maxDailyAdjustment: 0.1, nutrients: [] };

/** A day with entries (by meal); totals default to the sum of the entries. */
export function day(entries, totals) {
  const sum = (list) => list.reduce((t, e) => N(t.calories + e.item.nutrition.calories, t.protein + e.item.nutrition.protein, t.carbs + e.item.nutrition.carbs, t.fat + e.item.nutrition.fat), N(0));
  const meals = ['Breakfast', 'Lunch', 'Dinner', 'Snack'].map((meal) => {
    const es = entries.filter((e) => e.meal === meal);
    return { meal, totals: sum(es), entries: es };
  });
  return { date: today(), totals: totals ?? sum(entries), meals, progress: [] };
}

/** Routes every /api call: handlers by "METHOD /path-prefix" (first match), everything else 404. Records calls. */
export async function mockApi(page, handlers) {
  const calls = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const call = { method: req.method(), path: u.pathname, query: u.searchParams, body: req.postData() };
    calls.push(call);
    for (const [key, handle] of Object.entries(handlers)) {
      const [method, prefix] = key.split(' ');
      if ((method === '*' || method === req.method()) && u.pathname.startsWith(prefix)) {
        const out = await handle(call);
        if (out === 'abort') return route.abort('failed');
        const [status, body] = Array.isArray(out) ? out : [200, out];
        return status === 204 ? route.fulfill({ status }) : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      }
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return calls;
}

/** A real touch swipe (mouse drags don't count as touch): from the right edge of `box`, leftwards by `distance` px. */
export async function swipeLeft(page, box, distance = 150, steps = 30) {
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2, x0 = box.x + box.width - 30;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - (distance * i) / steps, y: y - 0 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}

/** A touch drag along a list of points. */
export async function drag(page, points) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
  for (const p of points.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}

/** Whether a row (or one of its parents) is slid open by the Delete button's width. */
export const isOpen = (locator) => locator.evaluate((el) => {
  for (let n = el, i = 0; n && i < 6; i++, n = n.parentElement) { const tr = getComputedStyle(n).transform; if (tr && tr !== 'none' && tr.includes('-96')) return true; }
  return false;
});

export const visible = (locator) => locator.isVisible().catch(() => false);
