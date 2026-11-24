// Recipes import: website links and Paprika files are separate sections with their own help and errors; a blocked site (403)
// is explained plainly with a fallback; old errors don't survive a tab switch, an edit or a new attempt.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, N, phone, serve } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const imported = { summary: { id: 'new1', name: 'Imported soup', servings: 2, origin: 'Url', categories: [], isFavorite: false, hasPhoto: false, perServing: N(300, 10, 30, 10), coverage: 1 }, ingredients: [], warnings: [], measures: [], usedIn: [] };
const BLOCKED = 'The site returned 403 Forbidden.';

async function open(extra = {}) {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/recipes': () => [200, []],
    'GET /api/foods/search': () => [200, []],
    ...extra,
  });
  await p.goto(server.url + '/recipes');
  await p.getByText('Import from website', { exact: true }).waitFor({ timeout: 15000 });
  return { ctx, p, calls, errors };
}

const link = (p) => p.getByRole('textbox', { name: 'Recipe link' });

test('Paprika instructions belong to the file import only; a website 403 is explained with a manual fallback', async () => {
  const { ctx, p, errors } = await open({ 'POST /api/recipes/import/url': () => [400, { title: 'Invalid request', detail: BLOCKED }] });
  await p.getByText('Import Paprika file', { exact: true }).first().waitFor();
  assert.equal(await p.getByText(/In Paprika: select recipes/).count(), 1);
  await link(p).fill('https://example.com/soup');
  await p.getByRole('button', { name: 'Import', exact: true }).click();
  await p.getByText('This website blocked automated recipe imports').waitFor();
  assert.equal(await p.getByText(/Forbidden|Import failed/).count(), 0, 'no raw status text');
  await p.getByRole('button', { name: 'Enter recipe manually' }).waitFor();
  assert.equal(await p.getByText('Paprika import failed').count(), 0, 'error stays by the website import');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the 403 notice clears when the link is edited, on retry, after success, and when returning to the tab', async () => {
  let ok = false;
  const { ctx, p, calls, errors } = await open({ 'POST /api/recipes/import/url': () => ok ? imported : [400, { title: 'Invalid request', detail: BLOCKED }], 'GET /api/recipes/new1': () => imported });
  const blocked = p.getByText('This website blocked automated recipe imports');
  const go = () => p.getByRole('button', { name: 'Import', exact: true }).click();

  await link(p).fill('https://example.com/a');
  await go();
  await blocked.waitFor();
  await link(p).fill('https://example.com/b');
  await blocked.waitFor({ state: 'detached' });

  await go();
  await blocked.waitFor();
  await p.getByRole('tab', { name: /Week/ }).click();
  await p.getByRole('tab', { name: /Recipes/ }).click();
  await p.getByText('Import from website', { exact: true }).waitFor();
  assert.equal(await blocked.count(), 0, 'stale error gone after tab switch');

  ok = true;
  await go();
  await p.waitForURL(/\/recipe\/new1/, { timeout: 15000 });
  assert.equal(calls.filter((c) => c.path === '/api/recipes/import/url').length, 3);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a failed Paprika import is shown by the file import, with its own wording', async () => {
  const { ctx, p, errors } = await open({ 'POST /api/recipes/import/paprika': () => [400, { title: 'Invalid request', detail: 'That file is not a Paprika export.' }] });
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByRole('button', { name: 'Import Paprika file' }).click(),
  ]);
  await chooser.setFiles({ name: 'x.paprikarecipes', mimeType: 'application/octet-stream', buffer: Buffer.from('nope') });
  await p.getByText('Paprika import failed').waitFor({ timeout: 15000 });
  await p.getByText('That file is not a Paprika export.').waitFor();
  assert.equal(await p.getByText('This website blocked automated recipe imports').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
