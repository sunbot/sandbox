// Grocery list: any item (also ones generated from planned meals) can be removed with Undo, and restored from "removed items".
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, phone, serve } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const item = (name, key) => ({ name, key, display: '200 g', inPantry: false, usedIn: ['Stew'], unconvertedAmounts: [], totalGrams: 200 });

test('removing a grocery item sends its key, offers Undo, and a removed item can be restored', async () => {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  let hidden = [];
  const calls = await mockApi(p, {
    'GET /api/plan/grocery': () => ({ from: '2026-11-23', to: '2026-11-29', itemCount: hidden.length ? 1 : 2,
      aisles: [{ aisle: 'Produce', items: [item('Carrots', 'food:c'), item('Onions', 'food:o')].filter((i) => !hidden.includes(i.key)) }],
      hiddenItems: hidden.map((k) => item(k === 'food:c' ? 'Carrots' : 'Onions', k)) }),
    'POST /api/plan/grocery/exclusions': (c) => { hidden = [...hidden, JSON.parse(c.body).key]; return [204]; },
    'DELETE /api/plan/grocery/exclusions': (c) => { const k = c.query.get('key'); hidden = k ? hidden.filter((x) => x !== k) : []; return [204]; },
  });
  await p.goto(`${server.url}/grocery?from=2026-11-23&to=2026-11-29`);
  await p.getByRole('button', { name: 'Remove Carrots from the list' }).click({ timeout: 15000 });
  await p.getByText('Removed Carrots from the list').waitFor();
  assert.deepEqual(JSON.parse(calls.find((c) => c.method === 'POST').body), { key: 'food:c', name: 'Carrots' });
  await p.getByRole('button', { name: /Show removed items \(1\)/ }).click({ timeout: 15000 });
  await p.getByRole('button', { name: 'Restore Carrots to the list' }).click();
  await p.waitForTimeout(400);
  assert.equal(calls.filter((c) => c.method === 'DELETE' && c.query.get('key') === 'food:c').length, 1);
  await p.getByRole('button', { name: 'Remove Carrots from the list' }).waitFor({ timeout: 15000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a grocery list from an older server (no hiddenItems, no keys) still opens instead of crashing (#68)', async () => {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await mockApi(p, {
    'GET /api/plan/grocery': () => ({ from: '2026-11-23', to: '2026-11-29', itemCount: 1,
      aisles: [{ aisle: 'Produce', items: [{ name: 'Carrots', display: '200 g', inPantry: false }] }] }),
  });
  await p.goto(`${server.url}/grocery?from=2026-11-23&to=2026-11-29`);
  await p.getByText('Carrots', { exact: true }).waitFor({ timeout: 15000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});
