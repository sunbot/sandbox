// Fill the Gaps "Show different ideas". Regressions covered: ideas repeating, the skipped list leaking across filters (a
// filter showing "No more ideas" before its first page), no way back after the last page.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, N, phone, serve, today, visible } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const names = ['Greek yogurt + Blueberries', 'Lentil soup', 'Chicken breast + Broccoli', 'Cottage cheese + Apple', 'Almonds + Banana', 'Egg + Brown rice', 'Black beans + Rice'];
const ideas = names.map((n, i) => ({
  id: (i + 1).toString(16).padStart(16, 'a'),
  items: n.split(' + ').map((x, j) => ({ kind: 'Food', foodId: `f${i}${j}`, recipeId: null, name: x, amount: 100, unit: 'g', nutrition: N(150), portion: '1 serving' })),
  adds: N(300, 20), remainingAfter: N(600), summary: '', category: 'Meal', reasons: [], effects: [],
}));

async function openGaps() {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/plan/gaps': (c) => {
      const ex = (c.query.get('exclude') ?? '').split(',').filter(Boolean);
      const unseen = ideas.filter((s) => !ex.includes(s.id));
      const page = unseen.slice(0, 3);
      return { date: today(), remaining: N(900, 50, 100, 30), gaps: [], suggestions: page, situation: 'Open', message: 'About 900 kcal left today.', mode: c.query.get('mode') ?? 'BestMatch',
        availableModes: [{ mode: 'BestMatch', count: 3 }, { mode: 'QuickSnack', count: 3 }], emptyReason: page.length ? null : 'Exhausted', emptyMessage: page.length ? null : 'No more matching ideas right now.',
        swaps: [], nextDay: [], dataNotes: [], moreIdeas: unseen.length - page.length, skippedIdeas: ideas.length - unseen.length };
    },
  });
  await p.goto(`${server.url}/gaps?date=${today()}`);
  await p.getByText('Greek yogurt + Blueberries').first().waitFor({ timeout: 15000 });
  const shown = async () => (await p.locator('text=/ \\+ |Lentil soup/').allInnerTexts()).filter((x) => names.includes(x));
  const requests = () => calls.filter((c) => c.path === '/api/plan/gaps').map((c) => ({ mode: c.query.get('mode'), exclude: (c.query.get('exclude') ?? '').split(',').filter(Boolean).length }));
  return { ctx, p, shown, requests, errors };
}

test('each tap shows new ideas without repeats until none are left, then Start over goes back to the first', async () => {
  const { ctx, p, shown, requests, errors } = await openGaps();
  const first = new Set(await shown());
  await p.getByRole('button', { name: 'Show different ideas' }).click();
  await p.getByText('Cottage cheese + Apple').first().waitFor({ timeout: 5000 });
  const second = await shown();
  assert.ok(second.every((n) => !first.has(n)), `no repeats: ${second}`);
  await p.getByRole('button', { name: 'Show different ideas' }).click();
  await p.getByText('No more matching ideas right now.').waitFor({ timeout: 5000 });
  assert.deepEqual(await shown(), ['Black beans + Rice']);
  assert.equal(await visible(p.getByRole('button', { name: 'Show different ideas' })), false);
  assert.deepEqual(requests().map((r) => r.exclude), [0, 3, 6], 'every shown idea is sent back');
  await p.getByRole('button', { name: 'Start over' }).click();
  await p.getByText('Greek yogurt + Blueberries').first().waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('each filter keeps its own skipped ideas: rotating in Best match does not use up Quick snack', async () => {
  const { ctx, p, requests } = await openGaps();
  await p.getByRole('button', { name: 'Show different ideas' }).click();
  await p.getByText('Cottage cheese + Apple').first().waitFor({ timeout: 5000 });
  await p.getByRole('button', { name: 'Quick snack' }).click();
  await p.waitForTimeout(1200);
  const quick = requests().filter((r) => r.mode === 'QuickSnack');
  assert.ok(quick.length > 0 && quick.every((r) => r.exclude === 0), 'Quick snack starts fresh');
  await p.getByRole('button', { name: 'Best match' }).click();
  await p.waitForTimeout(1200);
  assert.equal(await p.getByText('Cottage cheese + Apple').count() > 0, true, 'Best match keeps its place');
  await ctx.close();
});

test('data limitations collapse to one notice and a card shows its essentials, keeping cautions in view (#87)', async () => {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const salad = {
    id: 'salad', items: [{ kind: 'Recipe', foodId: null, recipeId: 'r1', name: 'Greek salad', amount: 1, unit: 'serving', nutrition: N(828, 11), portion: '1 serving' }],
    adds: N(828, 11), remainingAfter: N(210), summary: '', category: 'Meal', effects: [{ nutrientId: 1079, name: 'Fiber', before: 23, after: 12, unit: 'g', kind: 'Goal' }],
    reasons: [{ code: 'gap', text: 'Helps close your fiber gap: about 11 of the 23 g missing' }, { code: 'source', text: 'A useful source of potassium' },
      { code: 'gap', text: 'Helps close your iron gap' }, { code: 'limit', text: 'Uses 900 of the 1,000 mg sodium left in your limit' },
      { code: 'calories', text: 'Fits within your remaining 1,038 kcal (leaves about 210)' }],
  };
  const notes = ['Magnesium is missing from 3 logged foods.', 'Zinc is missing from 3 logged foods.', 'Added sugars are reported only on labelled products.'];
  await mockApi(p, {
    'GET /api/plan/gaps': () => ({ date: today(), remaining: N(1038, 115, 100, 30), gaps: [], suggestions: [salad], situation: 'Open', message: 'About 1,038 kcal left today.', mode: 'BestMatch',
      availableModes: [{ mode: 'BestMatch', count: 1 }], emptyReason: null, emptyMessage: null, swaps: [], nextDay: [], dataNotes: notes, moreIdeas: 0, skippedIdeas: 0 }),
  });
  await p.goto(`${server.url}/gaps?date=${today()}`);
  await p.getByRole('button', { name: '3 data limitations · View details' }).waitFor({ timeout: 15000 });
  assert.equal(await visible(p.getByText(notes[0])), false, 'collapsed by default');
  await p.getByRole('button', { name: '3 data limitations · View details' }).click();
  await p.getByText(notes[2]).waitFor();                                            // nothing about uncertainty is lost
  await p.getByRole('button', { name: 'Hide data limitations' }).click();

  assert.equal(await p.getByText('Greek salad', { exact: true }).count(), 1, 'the name appears once');
  await p.getByText('Helps close your fiber gap: about 11 of the 23 g missing').waitFor();
  await p.getByText('Uses 900 of the 1,000 mg sodium left in your limit').waitFor();  // a caution is never tucked away
  assert.equal(await visible(p.getByText('Helps close your iron gap')), false);
  assert.equal(await visible(p.getByText('AFTER THIS')), false);
  await p.getByRole('button', { name: /^Plan for / }).waitFor();                   // the action stays in view
  await p.getByRole('button', { name: 'View nutrition details' }).click();
  await p.getByText('Helps close your iron gap').waitFor();
  await p.getByText('AFTER THIS').waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});
