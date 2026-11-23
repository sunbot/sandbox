// Today's diary rows: tap to edit, swipe to reveal Delete (never deletes by itself), Delete + Undo, and the macro summary.
// Regressions covered: taps on a swiped row not arriving (couldn't edit/delete), a swipe deleting by itself, a scroll or
// short drag opening a row, a macro bar that looked stuck once over target.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, day, drag, isOpen, mockApi, N, phone, serve, swipeLeft, TARGETS, today, visible } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const almondsEntry = { id: 'e1', date: today(), meal: 'Breakfast', item: { kind: 'Food', foodId: 'f1', name: 'Nuts, almonds', quantity: 28, unit: 'g', grams: 28, nutrition: { ...N(162, 5.9, 6.1, 14, 3.5), nutrients: { 1008: 162, 1003: 5.9, 1103: 0, 1162: 1.234 } } } };
const yogurtEntry = { id: 'e2', date: today(), meal: 'Breakfast', item: { kind: 'Food', foodId: 'f2', name: 'Yogurt, Greek, plain, nonfat', quantity: 1, unit: 'container', grams: 170, nutrition: N(100, 17, 6, 0.7) } };
const almonds = { id: 'f1', name: 'Nuts, almonds', source: 'UsdaSrLegacy', quality: 'Standard', per100g: N(579, 21, 22, 50, 12.5), portions: [], baseUnit: 'g',
  measures: [{ unit: 'almond', label: 'almond', plural: 'almonds', base: 1.2, kind: 'Count', source: 'almond', countable: true }, { unit: 'cup', label: 'cup', plural: 'cups', base: 143, kind: 'Volume', source: 'cup, whole', countable: false },
    { unit: 'g', label: 'g', plural: 'g', base: 1, kind: 'Mass', source: null, countable: false }, { unit: 'oz', label: 'oz', plural: 'oz', base: 28.349523, kind: 'Mass', source: null, countable: false }] };

async function openToday(totals, food = almonds, clear = () => [204], initialEntries = [almondsEntry, yogurtEntry], moveStatus = 200) {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  let currentEntries = initialEntries.map((e) => ({ ...e }));
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/diary/quick-log': () => [],
    'GET /api/diary/': () => day(currentEntries, totals),
    'GET /api/targets': () => TARGETS,
    'GET /api/foods/f1': () => food,
    'GET /api/nutrients': () => [200, [
      { id: 1008, name: 'Energy', unit: 'kcal', group: 'Energy', displayOrder: 0 },
      { id: 1003, name: 'Protein', unit: 'g', group: 'Macronutrient', displayOrder: 10 },
      { id: 1103, name: 'Selenium', unit: 'µg', group: 'Mineral', displayOrder: 68 },
      { id: 1162, name: 'Vitamin C', unit: 'mg', group: 'Vitamin', displayOrder: 71 },
      { id: 1114, name: 'Vitamin D', unit: 'µg', group: 'Vitamin', displayOrder: 72 },
    ]],
    'PATCH /api/diary/e1': (c) => { const body = JSON.parse(c.body); return { ...almondsEntry, item: { ...almondsEntry.item, quantity: body.amount, unit: body.unit } }; },
    'POST /api/diary/move': (c) => {
      if (moveStatus !== 200) return [moveStatus, { title: 'Could not move entries' }];
      const request = JSON.parse(c.body);
      currentEntries = currentEntries.map((e) => request.entryIds.includes(e.id) ? { ...e, meal: request.meal } : e);
      return [200, currentEntries.filter((e) => request.entryIds.includes(e.id))];
    },
    'DELETE /api/diary/': () => [204],
    'POST /api/diary/clear-meal': clear,
  });
  await p.goto(server.url + '/');
  const row = p.getByRole('button', { name: /^Almonds, 28 g/ }).first();
  await row.waitFor({ timeout: 15000 });
  return { ctx, p, calls, row, errors, getEntries: () => currentEntries };
}
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').length;

test('clear meal confirms the count, supports cancel and undo, and sends only confirmed entries', async () => {
  const { ctx, p, calls } = await openToday();
  const clear = p.getByRole('button', { name: 'Clear breakfast' });
  await clear.click();
  await p.getByText(`Remove 2 logged entries from Breakfast on ${today()}? Planned items are not removed.`).waitFor();
  await p.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(calls.filter((c) => c.path.includes('clear-meal')).length, 0);
  await clear.click();
  await p.getByRole('button', { name: 'Clear entries' }).click();
  await p.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), true);
  assert.equal(calls.filter((c) => c.path.includes('clear-meal')).length, 0);
  await clear.click();
  await p.getByRole('button', { name: 'Clear entries' }).click();
  await p.waitForTimeout(6000);
  const request = calls.find((c) => c.path.includes('clear-meal'));
  assert.deepEqual(JSON.parse(request.body), { date: today(), meal: 'Breakfast', entryIds: ['e1', 'e2'] });
  await ctx.close();
});

test('clear failure restores entries and shows an error', async () => {
  const { ctx, p } = await openToday(undefined, almonds, () => [500, { detail: 'Clear failed' }]);
  await p.getByRole('button', { name: 'Clear breakfast' }).click();
  await p.getByRole('button', { name: 'Clear entries' }).click();
  await p.getByText('Clear failed').waitFor({ timeout: 10000 });
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), true);
  await ctx.close();
});

test('nutrition view shows the saved snapshot, preserves a quantity draft and never saves it', async () => {
  const { ctx, p, calls, row, errors } = await openToday();
  await row.tap();
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.fill('56');
  await p.getByRole('button', { name: 'View nutrition' }).click();
  await p.getByText('Saved nutrition snapshot').waitFor();
  await p.getByText('1.234 mg').waitFor();
  assert.equal(await visible(p.getByText('Saved for 28 g. Unsaved quantity changes are not included.')), true);
  assert.equal(await visible(p.getByText('162 kcal')), true);
  assert.equal(await visible(p.getByText('1.234 mg')), true);
  assert.equal(await visible(p.getByText('0 µg')), true);
  assert.equal(await visible(p.getByText('Not reported')), true);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  await p.getByRole('button', { name: 'Back to editor' }).click();
  assert.equal(await amount.inputValue(), '56');
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('tapping a logged food opens the editor, and saving sends the new amount in the chosen measure', async () => {
  const { ctx, p, calls, row, errors } = await openToday();
  await row.tap();
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.waitFor({ timeout: 5000 });
  assert.equal(await amount.inputValue(), '28');
  await p.getByRole('button', { name: /Measure: g/ }).click();
  await p.getByRole('radio', { name: /^almond/i }).click();
  await amount.fill('12');
  await p.getByRole('button', { name: 'Save changes' }).click();
  await p.waitForTimeout(800);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'Save sends the change');
  assert.deepEqual(JSON.parse(patch.body), { amount: 12, unit: 'almond' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('opening the measure list never moves the editor: a long list scrolls inside it (#52)', async () => {
  const manyMeasures = [...almonds.measures, ...Array.from({ length: 20 }, (_, i) => ({
    unit: `portion${i}`, label: `portion ${i}`, plural: `portions ${i}`, base: 2, kind: 'Count', source: null, countable: true,
  }))];
  const { ctx, p, row, errors } = await openToday(undefined, { ...almonds, measures: manyMeasures });
  await row.tap();
  const header = p.getByRole('heading', { name: 'Almonds' });
  const sheet = p.getByTestId('bottom-sheet');
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.waitFor();
  await p.waitForTimeout(500); // the opening slide
  const start = await sheet.boundingBox();
  const top = (await header.boundingBox()).y;
  const steady = async (what) => {
    const now = await sheet.boundingBox();
    assert.ok(Math.abs((await header.boundingBox()).y - top) < 1, `editor header stays in place (${what})`);
    assert.ok(Math.abs(now.height - start.height) < 1, `sheet keeps its height (${what})`);
  };

  await p.getByRole('button', { name: /Measure: g/ }).click();
  await steady('list opened');
  const scroll = await p.getByTestId('entry-editor-scroll').evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }));
  assert.ok(scroll.content > scroll.height, 'the long list scrolls inside the editor');
  await p.getByRole('radio', { name: /^portion 19/ }).click();
  await steady('measure picked');
  assert.equal(await amount.inputValue(), '14', '28 g is 14 portions of 2 g');
  await p.getByRole('button', { name: /Measure: portions 19/ }).click();
  await p.getByRole('radio', { name: 'g', exact: true }).click();
  await steady('switched back');
  assert.equal(await amount.inputValue(), '28', 'switching back keeps the exact amount');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a swipe reveals Delete but never deletes by itself; tapping away closes it without opening the editor', async () => {
  const { ctx, p, calls, row } = await openToday();
  await swipeLeft(p, await row.boundingBox());
  assert.equal(await isOpen(row), true, 'swipe reveals Delete');
  assert.equal(await visible(row), true, 'the food is still there');
  await p.waitForTimeout(5500);
  assert.equal(deletes(calls), 0, 'nothing deleted by swiping');
  await p.getByRole('button', { name: /^Yogurt/ }).first().tap();
  await p.waitForTimeout(500);
  assert.equal(await isOpen(row), false, 'tapping another row closes the open one');
  assert.equal(await visible(p.getByRole('textbox', { name: 'Amount' })), false, 'and does not open the editor');
  await ctx.close();
});

test('Delete hides the food with Undo; Undo restores it; the server delete happens only after the Undo window', async () => {
  const { ctx, p, calls, row } = await openToday();
  await swipeLeft(p, await row.boundingBox());
  await p.getByRole('button', { name: 'Delete Almonds' }).tap();
  await p.waitForTimeout(400);
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), false, 'hidden at once');
  await p.getByRole('button', { name: 'Undo' }).tap();
  await p.waitForTimeout(400);
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), true, 'Undo brings it back');
  assert.equal(deletes(calls), 0, 'Undo means no server delete');

  await swipeLeft(p, await p.getByRole('button', { name: /^Almonds, 28 g/ }).first().boundingBox());
  await p.getByRole('button', { name: 'Delete Almonds' }).tap();
  await p.waitForTimeout(6000);
  assert.equal(deletes(calls), 1, 'deleted once the Undo window passes');
  await ctx.close();
});

test('a short drag or a vertical scroll never opens a row', async () => {
  const { ctx, p, row } = await openToday();
  const box = await row.boundingBox();
  const y = box.y + box.height / 2, x0 = box.x + box.width - 30;
  await drag(p, Array.from({ length: 6 }, (_, i) => ({ x: x0 - i * 5, y })));
  assert.equal(await isOpen(row), false, 'short drag snaps back');
  await drag(p, Array.from({ length: 12 }, (_, i) => ({ x: x0, y: y - i * 8 })));
  assert.equal(await isOpen(row), false, 'vertical scroll');
  await drag(p, Array.from({ length: 12 }, (_, i) => ({ x: x0 - i * 3, y: y - i * 8 })));
  assert.equal(await isOpen(row), false, 'mostly vertical diagonal');
  await ctx.close();
});

test('selecting entries from different meals moves them together and refreshes the diary', async () => {
  const entries = [{ ...almondsEntry, meal: 'Breakfast' }, { ...yogurtEntry, meal: 'Lunch' }];
  const { ctx, p, calls, errors, getEntries } = await openToday(undefined, almonds, undefined, entries);
  await p.getByRole('button', { name: 'Select entries' }).click();
  await p.getByRole('checkbox', { name: /Almonds/ }).tap();
  await p.getByRole('checkbox', { name: /Yogurt/ }).tap();
  await p.getByRole('button', { name: 'Move' }).click();
  await p.getByRole('radio', { name: 'Snacks' }).click();
  await p.getByRole('button', { name: 'Move 2 entries' }).click();
  await p.getByRole('button', { name: /^Snacks, 262 calories/ }).waitFor();

  const move = calls.find((c) => c.method === 'POST' && c.path === '/api/diary/move');
  assert.ok(move);
  assert.deepEqual(JSON.parse(move.body), { date: today(), entryIds: ['e1', 'e2'], meal: 'Snack' });
  assert.ok(getEntries().every((e) => e.meal === 'Snack'), 'entries now belong to the destination meal');
  assert.ok(calls.filter((c) => c.method === 'GET' && c.path === '/api/diary/' + today()).length >= 2, 'successful move refreshes the diary');
  await p.getByRole('button', { name: 'Select entries' }).waitFor();
  assert.equal(await p.getByRole('checkbox').count(), 0, 'selection mode clears after success');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('bulk move needs a selection, cancellation is harmless, and errors retain the selection', async () => {
  const { ctx, p, calls, errors } = await openToday(undefined, almonds, undefined, undefined, 500);
  await p.getByRole('button', { name: 'Select entries' }).click();
  const move = p.getByRole('button', { name: 'Move', exact: true });
  assert.equal(await move.isEnabled(), false, 'empty selection cannot be submitted');
  const almondsRow = p.getByRole('checkbox', { name: /Almonds/ });
  await almondsRow.tap();
  await move.click();
  await p.getByTestId('bottom-sheet').getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await p.getByRole('checkbox', { name: /Almonds/ }).count(), 1, 'closing the destination sheet keeps selection');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/api/diary/move').length, 0, 'cancel does not send a request');

  await move.click();
  await p.getByRole('radio', { name: 'Snacks' }).click();
  await p.getByRole('button', { name: 'Move 1 entry' }).click();
  await p.getByRole('alert').waitFor();
  assert.equal(await p.getByTestId('bottom-sheet').isVisible(), true, 'the error is visible inside the open sheet');
  assert.equal(await p.getByRole('checkbox', { name: /Almonds/ }).count(), 1, 'failed moves keep the selection for retry');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/api/diary/move').length, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('over a macro target the summary says how far over (the bar itself stops at full)', async () => {
  const { ctx, p } = await openToday(N(1262, 23, 12, 95));
  await p.getByText('25 g over').waitFor({ timeout: 5000 });
  assert.equal(await p.getByText(/g over/).count(), 1, 'only fat is over');
  assert.equal(await p.getByLabel(/^Fat: 95 of 70 grams, 25 grams over target/).count(), 1, 'screen readers hear it too');
  await ctx.close();
});

test('while selecting entries to move, a meal cannot be cleared (the two would act on the same rows)', async () => {
  const { ctx, p, errors } = await openToday();
  await p.getByRole('button', { name: 'Clear breakfast' }).waitFor();
  await p.getByRole('button', { name: 'Select entries' }).click();
  await p.getByRole('checkbox', { name: /^Almonds/ }).first().waitFor();
  assert.equal(await p.getByRole('button', { name: 'Clear breakfast' }).count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});
