// Ask review: an excluded unresolved row must not block logging, and adding a food requires an explicit measure.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, N, phone, serve, today } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const food = (id, name, calories, measures, portions = []) => ({
  id, name, source: 'UsdaSrLegacy', quality: 'Standard', per100g: N(calories, 10, 20, 5), portions, baseUnit: 'g', measures,
});
const egg = food('egg', 'Egg, whole, raw, fresh', 143,
  [{ unit: 'large', label: 'large', plural: 'large', base: 50, kind: 'Count', source: 'large', countable: true }, { unit: 'g', label: 'g', plural: 'g', base: 1, kind: 'Mass', source: null, countable: false }],
  [{ description: 'large', grams: 50 }]);
const toast = food('toast', 'Bread, white, toasted', 293,
  [{ unit: 'slice', label: 'slice', plural: 'slices', base: 25, kind: 'Count', source: 'slice', countable: true }, { unit: 'g', label: 'g', plural: 'g', base: 1, kind: 'Mass', source: null, countable: false }],
  [{ description: 'slice', grams: 25 }]);
const oats = food('oats', 'Oats', 379,
  [{ unit: 'cup', label: 'cup', plural: 'cups', base: 81, kind: 'Volume', source: 'USDA portion', countable: false }, { unit: 'g', label: 'g', plural: 'g', base: 1, kind: 'Mass', source: null, countable: false }]);

const match = (f, grams, status, explanation) => ({
  food: f, score: 60, confidence: 0.9, nutrition: null,
  quantity: { grams, method: 'DefaultPortion', explanation, status },
});
const response = {
  intent: 'LogMeal', reply: 'Review these foods.', usedLanguageModel: false, meal: 'Breakfast', date: today(),
  foodMatches: [
    { text: 'egg', amount: 1, unit: null, foodQuery: 'egg', matches: [match(egg, 50, 'Given', '1 × large (50 g each)')] },
    { text: 'toast', amount: 1, unit: null, foodQuery: 'toast', matches: [match(toast, 25, 'Assumed', '1 × slice (25 g each)')] },
    { text: 'mystery item', amount: null, unit: null, foodQuery: 'mystery item', matches: [] },
  ],
  savedRecipes: [], recipeIdeas: [], cookable: [],
};

test('exclude an unmatched row, add a searched food with a measure, and log only the selected foods', async () => {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'POST /api/assistant': () => response,
    'GET /api/foods/search': () => [200, [oats]],
    'POST /api/diary/foods': (c) => {
      const { items } = JSON.parse(c.body);
      return [200, items.map((_, i) => ({ id: `entry-${i + 1}` }))];
    },
  });

  await p.goto(`${server.url}/assistant`);
  await p.getByRole('textbox', { name: 'Describe what you ate or ask a question' }).fill('egg and toast');
  await p.getByRole('button', { name: 'Send' }).click();
  await p.getByText('3 selected', { exact: true }).waitFor({ timeout: 15000 });

  await p.getByRole('switch', { name: 'Included: mystery item' }).click();
  await p.getByRole('button', { name: 'Log 2 selected' }).waitFor();

  await p.getByRole('button', { name: 'Add a food' }).click();
  await p.getByRole('textbox', { name: 'Search foods to add' }).fill('oats');
  await p.getByRole('button', { name: 'Add Oats' }).click();
  await p.getByText('Replace this match').waitFor();
  await p.getByRole('button', { name: 'Search for another food' }).waitFor();
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.waitFor();
  await p.getByRole('button', { name: 'Measure: cups' }).waitFor();
  const save = p.getByRole('button', { name: 'Log 3 selected' });
  await save.waitFor();
  assert.equal(await save.isEnabled(), false, 'unresolved added foods cannot be logged');
  await amount.fill('1');
  await p.getByRole('button', { name: 'Done' }).click();
  await save.waitFor();
  assert.equal(await save.isEnabled(), true, 'choosing a supported amount clears the blocker');
  await save.click();

  const request = calls.find((c) => c.method === 'POST' && c.path === '/api/diary/foods');
  assert.ok(request, 'the selected foods are submitted in one batch');
  const payload = JSON.parse(request.body);
  assert.deepEqual(payload.items, [
    { foodId: 'egg', grams: 50 },
    { foodId: 'toast', grams: 25 },
    { foodId: 'oats', amount: 1, unit: 'cup' },
  ]);
  assert.deepEqual(errors, []);
  await ctx.close();
});
