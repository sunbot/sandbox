// Recipe editor (Phase 2): add an ingredient from search, edit a food line's amount in its own measures, remove a line
// (two taps), and scale the whole recipe.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, N, phone, serve } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const oats = {
  id: 'oats', name: 'Oats', source: 'UsdaSrLegacy', quality: 'Standard', per100g: N(380, 13, 68, 7), portions: [{ description: 'cup', grams: 81 }], baseUnit: 'g',
  measures: [{ unit: 'cup', label: 'cup', plural: 'cups', base: 81, kind: 'Volume', source: 'cup', countable: false },
    { unit: 'g', label: 'g', plural: 'g', base: 1, kind: 'Mass', source: null, countable: false }],
};
const porridge = {
  summary: { id: 'porridge', name: 'Porridge', servings: 2, origin: 'Manual', categories: [], isFavorite: false, hasPhoto: false, perServing: N(154, 5, 28, 3), coverage: 1 },
  ingredients: [
    { position: 0, rawText: '1 cup oats', amount: 1, unit: 'cup', foodText: 'oats', foodId: 'oats', foodName: 'Oats', grams: 81, status: 'Confirmed', matchConfidence: 1, nutrition: N(308, 11, 55, 6), foodSource: 'UsdaSrLegacy' },
    { position: 1, rawText: 'pinch of magic', foodText: 'magic', status: 'Unmatched', matchConfidence: 0 },
  ],
  warnings: [], measures: [], usedIn: [],
};

async function open(path) {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/foods/search': () => [200, [oats]],
    'GET /api/foods/oats': () => oats,
    'POST /api/recipes/porridge/ingredients': () => porridge,
    'DELETE /api/recipes/porridge/ingredients/': () => porridge,
    'PUT /api/recipes/porridge/ingredients/': () => porridge,
    'POST /api/recipes/porridge/scale': () => ({ ...porridge, summary: { ...porridge.summary, servings: 4 } }),
    'GET /api/recipes/porridge': () => porridge,
    'GET /api/recipes': () => [200, []],
  });
  await p.goto(server.url + path);
  return { ctx, p, calls, errors };
}
const body = (calls, method, path) => { const c = calls.findLast((x) => x.method === method && x.path.startsWith(path)); return c && JSON.parse(c.body ?? 'null'); };

test('Add opens search for this recipe and the chosen food is added in the measure picked', async () => {
  const { ctx, p, calls, errors } = await open('/recipe/porridge');
  await p.getByRole('button', { name: 'Add', exact: true }).click({ timeout: 15000 });
  await p.getByRole('textbox', { name: 'Search foods and recipes' }).fill('oats');
  await p.getByRole('button', { name: /^Oats\./ }).click({ timeout: 15000 });
  await p.getByRole('textbox', { name: 'Amount' }).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: /Measure: g/ }).click();          // oats start at 100 g (no countable item)
  await p.getByRole('radio', { name: /^cup/ }).click();
  await p.getByRole('textbox', { name: 'Amount' }).fill('1.5');
  await p.getByRole('button', { name: 'Add to recipe' }).click();
  await p.waitForTimeout(500);
  const sent = body(calls, 'POST', '/api/recipes/porridge/ingredients');
  assert.ok(sent, 'added');
  assert.equal(sent.foodId, 'oats');
  assert.equal(sent.amount, 1.5);
  assert.equal(sent.unit, 'cup');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a food line\'s amount is edited in its own measures; Remove needs a second tap', async () => {
  const { ctx, p, calls, errors } = await open('/recipe/porridge');
  await p.getByRole('button', { name: /^1 cup oats\./ }).click({ timeout: 15000 });
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.waitFor();
  assert.equal(await amount.inputValue(), '1');                       // its own amount, in cups
  await p.getByRole('button', { name: /Measure: cup/ }).waitFor();
  await amount.fill('2');
  await p.getByRole('button', { name: 'Save amount' }).click();
  await p.waitForTimeout(400);
  assert.deepEqual(body(calls, 'PUT', '/api/recipes/porridge/ingredients/0'), { amount: 2, unit: 'cup' });

  await p.getByRole('button', { name: /^pinch of magic\./ }).click();
  await p.getByRole('button', { name: 'Remove line' }).click();
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'first tap only asks');
  await p.getByRole('button', { name: 'Tap again to remove' }).click();
  await p.waitForTimeout(400);
  assert.equal(calls.filter((c) => c.method === 'DELETE' && c.path === '/api/recipes/porridge/ingredients/1').length, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('scaling shows what will change and applies the chosen factor', async () => {
  const { ctx, p, calls, errors } = await open('/recipe/porridge');
  await p.getByRole('button', { name: 'Scale the recipe by 2' }).click({ timeout: 15000 });
  await p.getByText('Makes 2 → 4 servings · every amount ×2').waitFor();
  await p.getByRole('button', { name: 'Apply' }).click();
  await p.waitForTimeout(400);
  assert.deepEqual(body(calls, 'POST', '/api/recipes/porridge/scale'), { factor: 2 });
  await p.getByText(/Scaled ×2: now 4 servings/).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});
