// Unified recipes: your recipes appear in food search (marked as recipes), can be logged in their own measures, and can be
// used as an ingredient of another recipe (never of itself). The nested line and "Used in" show on the recipe screens.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, N, phone, serve, today } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const summary = (id, name, servings, kcal, over = {}) => ({
  id, name, servings, origin: 'Manual', categories: [], isFavorite: false, hasPhoto: false, perServing: N(kcal, 20, 30, 10), coverage: 1, ...over,
});
const chili = summary('chili', 'Turkey chili', 4, 400);
const pasta = summary('pasta', 'Chili pasta bake', 2, 450);
const measures = [
  { unit: 'serving', label: 'serving', plural: 'servings', base: 1, kind: 'Count', source: '1 of 4 servings', countable: true, origin: 'your recipe' },
  { unit: 'cup', label: 'cup', plural: 'cups', base: 0.5, kind: 'Volume', source: 'finished volume 1892.71 ml', countable: false, origin: 'your recipe' },
  { unit: 'g', label: 'g', plural: 'g', base: 0.002, kind: 'Mass', source: 'finished weight 2000 g', countable: false, origin: 'your recipe' },
];
const detail = (s, over = {}) => ({ summary: s, ingredients: [], warnings: [], measures: [measures[0]], usedIn: [], ...over });
const chiliDetail = detail(chili, { cookedWeightGrams: 2000, finishedVolumeMl: 1892.71, measures, usedIn: [{ id: 'pasta', name: 'Chili pasta bake' }] });
const pastaDetail = detail(pasta, {
  ingredients: [
    { position: 0, rawText: '2 servings chili', amount: 2, unit: 'serving', foodText: 'chili', status: 'Confirmed', matchConfidence: 1, note: 'Your recipe: 2 servings of 4',
      recipeId: 'chili', recipeName: 'Turkey chili', servings: 2, grams: 1000, nutrition: N(800, 40, 60, 20) },
    { position: 1, rawText: '200 g pasta', amount: 200, unit: 'g', foodText: 'pasta', status: 'Unmatched', matchConfidence: 0 },
  ],
});

async function open(path, extra = {}) {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/foods/search': () => [200, []],
    'GET /api/foods/branded': () => ({ results: [], attribution: null }),
    'GET /api/recipes/chili': () => chiliDetail,
    'GET /api/recipes/pasta': () => pastaDetail,
    'GET /api/recipes': (c) => [200, [chili, pasta].filter((r) => !c.query.get('search') || r.name.toLowerCase().includes(c.query.get('search').toLowerCase()))],
    ...extra,
  });
  await p.goto(server.url + path);
  return { ctx, p, calls, errors };
}

test('your recipes show first in search, marked as recipes, and log in their own measure (1 cup = half a serving)', async () => {
  const { ctx, p, calls, errors } = await open(`/food/search?date=${today()}&meal=Dinner&mode=log`, {
    'POST /api/diary/recipe': (c) => ({ id: 'd1', date: today(), meal: 'Dinner', item: { kind: 'Recipe', recipeId: 'chili', name: 'Turkey chili', quantity: 1, unit: 'cup', nutrition: N(200, 10, 15, 5) }, ...JSON.parse(c.body) }),
  });
  await p.getByRole('textbox', { name: 'Search foods and recipes' }).fill('chili');
  const row = p.getByRole('button', { name: /^Turkey chili\. per serving · makes 4: 400 calories.*Your recipe/ });
  await row.waitFor({ timeout: 15000 });
  await p.getByText('Your recipes', { exact: true }).waitFor();
  await row.click();

  await p.getByRole('button', { name: /Measure: serving/ }).click();
  await p.getByRole('radio', { name: /^cup, 0\.5 servings/ }).click();
  // Switching measure keeps the amount: 1 serving is 2 cups of this chili.
  assert.equal(await p.getByRole('textbox', { name: 'Amount' }).inputValue(), '2');
  await p.getByRole('textbox', { name: 'Amount' }).fill('1');
  await p.getByRole('button', { name: /^Add · 200 kcal/ }).click();
  await p.waitForTimeout(500);
  const post = calls.find((c) => c.method === 'POST' && c.path === '/api/diary/recipe');
  assert.ok(post, 'logged');
  const body = JSON.parse(post.body);
  assert.deepEqual({ recipeId: body.recipeId, amount: body.amount, unit: body.unit, servings: body.servings, meal: body.meal }, { recipeId: 'chili', amount: 1, unit: 'cup', servings: 0.5, meal: 'Dinner' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a recipe can be chosen as an ingredient of another recipe, but the recipe being edited is never offered', async () => {
  const { ctx, p, calls, errors } = await open('/food/search?mode=ingredient&recipeId=pasta&position=1', {
    'PUT /api/recipes/pasta/ingredients/1': () => pastaDetail,
  });
  await p.getByRole('textbox', { name: 'Search foods and recipes' }).fill('chili');
  await p.getByRole('button', { name: /^Turkey chili\./ }).waitFor({ timeout: 15000 });
  assert.equal(await p.getByRole('button', { name: /^Chili pasta bake\./ }).count(), 0, 'not offered inside itself');
  await p.getByRole('button', { name: /^Turkey chili\./ }).click();

  await p.getByRole('textbox', { name: 'Amount' }).fill('2');
  await p.getByRole('button', { name: 'Use as this ingredient' }).click();
  await p.waitForTimeout(500);
  const put = calls.find((c) => c.method === 'PUT' && c.path === '/api/recipes/pasta/ingredients/1');
  assert.ok(put, 'ingredient updated');
  assert.deepEqual(JSON.parse(put.body), { recipeId: 'chili', amount: 2, unit: 'serving' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a nested recipe line reads as your recipe, and a recipe shows where it is used', async () => {
  const { ctx, p, errors } = await open('/recipe/pasta');
  const line = p.getByRole('button', { name: /^2 servings chili\. Your recipe: Turkey chili · 2 servings \(1000 g\)\. 800 calories/ });
  await line.waitFor({ timeout: 15000 });
  await line.click();
  await p.getByRole('button', { name: 'Change amount' }).waitFor();
  await p.getByRole('button', { name: 'Open this recipe' }).click();
  await p.getByRole('heading', { name: 'Used in' }).waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: 'Chili pasta bake' }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('updating ingredient matches shows a preview first and saves only on Apply', async () => {
  const change = { id: 'chili', name: 'Turkey chili', kcalPerServingBefore: 388, kcalPerServingAfter: 504, coverageBefore: 1, coverageAfter: 1,
    lines: [{ rawText: '1 can (13.5 oz) coconut milk', foodBefore: 'Coconut milk', foodAfter: 'Nuts, coconut milk, canned', gramsBefore: 382.7, gramsAfter: 382.7, status: 'AutoMatched' }] };
  const { ctx, p, calls, errors } = await open('/recipes', {
    'POST /api/recipes/rematch-all': (c) => ({ applied: c.query.get('apply') === 'true', recipesChecked: 2, changed: [change] }),
  });
  await p.getByRole('button', { name: 'Update ingredient matches…' }).click();
  await p.getByText('Checked 2 recipes: 1 would change.', { exact: false }).waitFor({ timeout: 15000 });
  await p.getByText('388 → 504 kcal per serving').waitFor();
  await p.getByText(/Coconut milk \(383 g\) → .*canned.* \(383 g\)/i).waitFor();
  const rematches = () => calls.filter((c) => c.path === '/api/recipes/rematch-all');
  assert.equal(rematches().length, 1);
  assert.notEqual(rematches()[0].query.get('apply'), 'true', 'opening only previews');
  await p.getByRole('button', { name: 'Apply to 1 recipe' }).click();
  await p.getByText('Updated 1 recipe.', { exact: false }).waitFor();
  assert.equal(rematches()[1].query.get('apply'), 'true');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('searching "apple" labels a recipe found through an ingredient, lists name matches first, and the search box has no browser outline (#84)', async () => {
  const chiliHit = { ...summary('smoky', 'Smoky Chipotle Beef Chili', 6, 420), matchedOn: 'Ingredient', matchedText: '1 tbsp apple cider vinegar' };
  const pie = summary('pie', 'Apple pie', 8, 300);
  const { ctx, p, errors } = await open('/food/search?mode=log', { 'GET /api/recipes': () => [200, [pie, chiliHit]] });
  const box = p.getByRole('textbox').first();
  await box.click();
  await box.fill('apple');
  await p.getByText('Smoky Chipotle Beef Chili').waitFor({ timeout: 15000 });
  await p.getByText(/Matches ingredient: 1 tbsp apple cider vinegar/).waitFor();
  const names = await p.locator('text=/^(Apple pie|Smoky Chipotle Beef Chili)$/').allInnerTexts();
  assert.deepEqual(names.slice(0, 2), ['Apple pie', 'Smoky Chipotle Beef Chili']);
  const outline = await box.evaluate((el) => getComputedStyle(el).outlineStyle);
  assert.equal(outline, 'none', 'no rectangular browser outline inside the rounded field');
  const border = await box.evaluate((el) => getComputedStyle(el.parentElement).borderTopColor);
  const idle = await p.evaluate(() => { document.activeElement.blur(); return null; });
  const borderIdle = await box.evaluate((el) => getComputedStyle(el.parentElement).borderTopColor);
  assert.notEqual(border, borderIdle, 'focus is shown on the field itself');
  assert.equal(idle, null);
  assert.deepEqual(errors, []);
  await ctx.close();
});
