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

async function openToday(totals, food = almonds, clear = () => [204], initialEntries = [almondsEntry, yogurtEntry], moveStatus = 200, deleteMany = () => [204]) {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  let currentEntries = initialEntries.map((e) => ({ ...e }));
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/diary/quick-log': () => [],
    'GET /api/diary/': (c) => day(currentEntries.filter((e) => !e.date || c.path.endsWith(e.date)), totals),
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
      currentEntries = currentEntries.map((e) => request.entryIds.includes(e.id) ? { ...e, meal: request.meal, date: request.toDate ?? e.date } : e);
      return [200, currentEntries.filter((e) => request.entryIds.includes(e.id))];
    },
    'DELETE /api/diary/': () => [204],
    'POST /api/diary/clear-meal': clear,
    'POST /api/diary/delete': deleteMany,
  });
  await p.goto(server.url + '/');
  const row = p.getByRole('button', { name: /^Almonds, 28 g/ }).first();
  await row.waitFor({ timeout: 15000 });
  return { ctx, p, calls, row, errors, getEntries: () => currentEntries };
}
/** Press and hold a diary row: starts selecting entries to move, with that row ticked. */
const holdRow = (p, name) => p.getByRole('button', { name }).first().click({ delay: 800 });
/** Clear is in the meal's "…" menu, not next to Add. */
const chooseClear = async (p) => {
  await p.getByRole('button', { name: 'Breakfast actions' }).click();
  await p.getByRole('button', { name: /^Clear breakfast/ }).click();
};
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').length;

test('clear meal confirms the count, supports cancel and undo, and sends only confirmed entries', async () => {
  const { ctx, p, calls } = await openToday();
  assert.equal(await p.getByRole('button', { name: /^Clear breakfast/ }).count(), 0, 'no inline Clear next to Add');
  await chooseClear(p);
  await p.getByText(`Remove 2 logged entries from Breakfast on ${today()}? Planned items are not removed.`).waitFor();
  await p.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(calls.filter((c) => c.path.includes('clear-meal')).length, 0);
  await chooseClear(p);
  await p.getByRole('button', { name: 'Clear entries' }).click();
  await p.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), true);
  assert.equal(calls.filter((c) => c.path.includes('clear-meal')).length, 0);
  await chooseClear(p);
  await p.getByRole('button', { name: 'Clear entries' }).click();
  await p.waitForTimeout(6000);
  const request = calls.find((c) => c.path.includes('clear-meal'));
  assert.deepEqual(JSON.parse(request.body), { date: today(), meal: 'Breakfast', entryIds: ['e1', 'e2'] });
  await ctx.close();
});

test('clear failure restores entries and shows an error', async () => {
  const { ctx, p } = await openToday(undefined, almonds, () => [500, { detail: 'Clear failed' }]);
  await chooseClear(p);
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

test('choosing a measure never moves the editor: a long list opens and scrolls in its own sheet (#52, #73)', async () => {
  const manyMeasures = [...almonds.measures, ...Array.from({ length: 20 }, (_, i) => ({
    unit: `portion${i}`, label: `portion ${i}`, plural: `portions ${i}`, base: 2, kind: 'Count', source: null, countable: true,
  }))];
  const { ctx, p, row, errors } = await openToday(undefined, { ...almonds, measures: manyMeasures });
  await row.tap();
  const header = p.getByRole('heading', { name: 'Almonds' });
  const editor = p.getByTestId('bottom-sheet').first();
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.waitFor();
  await p.waitForTimeout(500); // the opening slide
  const start = await editor.boundingBox();
  const top = (await header.boundingBox()).y;
  const steady = async (what) => {
    assert.ok(Math.abs((await header.boundingBox()).y - top) < 1, `editor header stays in place (${what})`);
    assert.ok(Math.abs((await editor.boundingBox()).height - start.height) < 1, `editor keeps its height (${what})`);
  };

  await p.getByRole('button', { name: /Measure: g/ }).click();
  await p.getByRole('heading', { name: 'Choose a measure' }).waitFor();
  await p.waitForTimeout(500);
  await steady('measure sheet open');
  // The options are in their own sheet above the editor, scrolling within it (never under the editor's buttons).
  const list = await p.getByRole('radiogroup').evaluate((el) => {
    let n = el; while (n && n.scrollHeight <= n.clientHeight) n = n.parentElement;
    return n ? { height: n.clientHeight, content: n.scrollHeight } : null;
  });
  assert.ok(list && list.content > list.height, 'the long list scrolls inside the measure sheet');
  await p.getByRole('radio', { name: /^portion 19/ }).click();
  await p.waitForTimeout(500);
  await steady('measure picked');
  assert.equal(await amount.inputValue(), '14', '28 g is 14 portions of 2 g');
  await p.getByRole('button', { name: /Measure: portions 19/ }).click();
  await p.getByRole('radio', { name: 'g', exact: true }).click();
  await p.waitForTimeout(500);
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
  await holdRow(p, /^Almonds/);
  await p.getByRole('checkbox', { name: /Almonds/ }).waitFor();
  await p.getByRole('checkbox', { name: /Yogurt/ }).tap();
  await p.getByText('2 selected').waitFor();
  await p.getByRole('button', { name: 'Move' }).click();
  await p.getByRole('radio', { name: 'Snacks' }).click();
  await p.getByRole('button', { name: 'Move 2 entries' }).click();
  await p.getByRole('button', { name: /^Snacks, 262 calories/ }).waitFor();

  const move = calls.find((c) => c.method === 'POST' && c.path === '/api/diary/move');
  assert.ok(move);
  assert.deepEqual(JSON.parse(move.body), { date: today(), entryIds: ['e1', 'e2'], meal: 'Snack' });
  assert.ok(getEntries().every((e) => e.meal === 'Snack'), 'entries now belong to the destination meal');
  assert.ok(calls.filter((c) => c.method === 'GET' && c.path === '/api/diary/' + today()).length >= 2, 'successful move refreshes the diary');
  await p.getByText('2 selected').waitFor({ state: 'detached' });
  assert.equal(await p.getByRole('checkbox').count(), 0, 'selection mode clears after success');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('bulk move needs a selection, cancellation is harmless, and errors retain the selection', async () => {
  const { ctx, p, calls, errors } = await openToday(undefined, almonds, undefined, undefined, 500);
  await holdRow(p, /^Almonds/);
  const move = p.getByRole('button', { name: 'Move', exact: true });
  const almondsRow = p.getByRole('checkbox', { name: /Almonds/ });
  await almondsRow.tap();                                                  // untick the held row: nothing selected
  await p.getByText('0 selected').waitFor();
  assert.equal(await move.isEnabled(), false, 'empty selection cannot be submitted');
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

test('while selecting entries, the meal menu (and its Clear) is hidden: the two would act on the same rows', async () => {
  const { ctx, p, errors } = await openToday();
  await p.getByRole('button', { name: 'Breakfast actions' }).waitFor();
  await holdRow(p, /^Almonds/);
  await p.getByRole('checkbox', { name: /^Almonds/ }).first().waitFor();
  assert.equal(await p.getByRole('button', { name: 'Breakfast actions' }).count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('moving never defaults to a move that changes nothing, and Undo sends each entry back to its own meal', async () => {
  const lunchEntry = { ...yogurtEntry, id: 'e3', meal: 'Lunch' };
  const { ctx, p, calls, errors, getEntries } = await openToday(undefined, almonds, undefined, [almondsEntry, lunchEntry]);
  await holdRow(p, /^Almonds/);                                           // held row starts ticked
  await p.getByText('1 selected').waitFor();
  await p.getByRole('button', { name: 'Move', exact: true }).click();
  // Almonds are in Breakfast: whatever the default is, it isn't Breakfast.
  assert.equal(await p.getByRole('radio', { name: 'Breakfast' }).getAttribute('aria-checked') === 'true'
    || await p.getByRole('radio', { name: 'Breakfast' }).getAttribute('aria-selected') === 'true', false);
  await p.getByRole('radio', { name: 'Breakfast' }).click();
  await p.getByText('It’s already in breakfast that day. Pick another meal or day.').waitFor();
  assert.ok(await p.getByRole('button', { name: 'Move 1 entry' }).isDisabled());
  await p.getByRole('button', { name: 'Close' }).last().click();
  await p.waitForTimeout(400);

  // Add the Lunch yogurt and move both to Dinner, then Undo.
  await p.getByRole('checkbox', { name: /^Yogurt/ }).first().click();
  await p.getByText('2 selected').waitFor();
  await p.getByRole('button', { name: 'Move', exact: true }).click();
  await p.getByRole('radio', { name: 'Dinner' }).click();
  await p.getByRole('button', { name: 'Move 2 entries' }).click();
  await p.getByText('Moved 2 entries to dinner').waitFor();
  assert.deepEqual(getEntries().map((x) => x.meal), ['Dinner', 'Dinner']);
  await p.getByRole('button', { name: 'Undo' }).click();
  for (let i = 0; i < 40 && calls.filter((c) => c.path === '/api/diary/move').length < 3; i++) await p.waitForTimeout(100);
  const moves = calls.filter((c) => c.method === 'POST' && c.path === '/api/diary/move').map((c) => JSON.parse(c.body));
  assert.deepEqual(moves.slice(1).map((m) => [m.meal, m.entryIds]), [['Breakfast', ['e1']], ['Lunch', ['e3']]]);
  assert.deepEqual(getEntries().map((x) => x.meal), ['Breakfast', 'Lunch']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the meal menu starts selecting with nothing ticked; Delete selected confirms, offers Undo, then deletes only the ticked entries', async () => {
  const { ctx, p, calls, errors } = await openToday();
  await p.getByRole('button', { name: 'Breakfast actions' }).click();
  await p.getByRole('button', { name: 'Select entries' }).click();
  await p.getByText('0 selected').waitFor();
  const del = p.getByRole('button', { name: 'Delete selected' });
  assert.equal(await del.isDisabled(), true, 'nothing ticked: Delete is disabled');
  await p.getByRole('checkbox', { name: /^Almonds/ }).first().click();
  await p.getByText('1 selected').waitFor();
  await del.click();
  await p.getByText(`Remove 1 logged entry from ${today()}? Planned items are not removed.`).waitFor();
  await p.getByRole('button', { name: 'Cancel' }).last().click();
  await p.getByText('1 selected').waitFor();                                 // cancelling keeps the selection
  await del.click();
  await p.getByRole('button', { name: 'Delete entries' }).click();
  await p.getByText('Deleted 1 entry').waitFor();
  await p.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), true, 'Undo brings it back');
  assert.equal(calls.filter((c) => c.path === '/api/diary/delete').length, 0, 'nothing sent before the Undo window ends');

  await holdRow(p, /^Almonds/);
  await p.getByRole('checkbox', { name: /^Greek yogurt|^Yogurt/ }).first().click();
  await p.getByText('2 selected').waitFor();
  await p.getByRole('button', { name: 'Delete selected' }).click();
  await p.getByRole('button', { name: 'Delete entries' }).click();
  for (let i = 0; i < 80 && !calls.some((c) => c.path === '/api/diary/delete'); i++) await p.waitForTimeout(100);
  const request = calls.find((c) => c.path === '/api/diary/delete');
  assert.deepEqual(JSON.parse(request.body), { date: today(), entryIds: ['e1', 'e2'] });
  assert.equal(deletes(calls), 0, 'one bulk request, not one delete per entry');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a failed Delete selected restores the entries and says nothing was deleted', async () => {
  const { ctx, p } = await openToday(undefined, almonds, () => [204], undefined, 200, () => [404, { detail: 'One or more diary entries were not found for that date; nothing was deleted.' }]);
  await holdRow(p, /^Almonds/);
  await p.getByRole('button', { name: 'Delete selected' }).click();
  await p.getByRole('button', { name: 'Delete entries' }).click();
  await p.getByText(/nothing was deleted/).waitFor({ timeout: 10000 });
  assert.equal(await visible(p.getByRole('button', { name: /^Almonds, 28 g/ }).first()), true);
  await ctx.close();
});

test('press and hold starts selecting with that food ticked; a short tap still opens the editor; there is no Select button', async () => {
  const { ctx, p, errors } = await openToday();
  assert.equal(await p.getByRole('button', { name: 'Select entries' }).count(), 0);
  await p.getByRole('button', { name: /^Almonds/ }).first().click();          // ordinary tap: the editor
  await p.getByRole('textbox', { name: 'Amount' }).waitFor();
  await p.getByRole('button', { name: 'Close' }).last().click();
  await p.waitForTimeout(500);
  await holdRow(p, /^Almonds/);
  await p.getByText('1 selected').waitFor();
  assert.ok(await p.getByRole('checkbox', { name: /^Almonds/ }).first().isChecked(), 'the held food is ticked');
  assert.equal(await p.getByRole('textbox', { name: 'Amount' }).count(), 0, 'holding does not also open the editor');
  await p.getByRole('button', { name: 'Cancel selection' }).click();
  await p.getByText('1 selected').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('selection: a meal checkbox selects all (then some), the bar stays on one row, and Move can go to tomorrow (#85)', async () => {
  const lunch = { ...yogurtEntry, id: 'e3', meal: 'Lunch', item: { ...yogurtEntry.item, name: 'Lentil soup' } };
  const { ctx, p, calls, errors } = await openToday(undefined, almonds, () => [204], [almondsEntry, yogurtEntry, lunch]);
  await p.setViewportSize({ width: 360, height: 760 });
  await holdRow(p, /^Lentil soup/);                                    // lunch item ticked
  const breakfastBox = p.getByRole('checkbox', { name: 'Select all of breakfast' });
  await breakfastBox.click();
  await p.getByText('3 selected').waitFor();
  assert.equal(await breakfastBox.getAttribute('aria-checked'), 'true');
  await p.getByRole('checkbox', { name: /^Almonds/ }).first().click();  // untick one: the meal shows "some"
  await p.getByText('2 selected').waitFor();
  assert.equal(await breakfastBox.getAttribute('aria-checked'), 'mixed');

  const count = await p.getByText('2 selected').boundingBox();
  const move = await p.getByRole('button', { name: 'Move', exact: true }).boundingBox();
  const close = await p.getByRole('button', { name: 'Cancel selection' }).boundingBox();
  assert.ok(Math.abs(count.y + count.height / 2 - (move.y + move.height / 2)) < 12, 'Move is on the same row as the count');
  assert.ok(Math.abs(close.y - move.y) < 12 && move.x + move.width <= 360, 'nothing wraps or overflows at 360 px');

  await p.getByRole('button', { name: 'Move', exact: true }).click();
  await p.getByRole('button', { name: 'Tomorrow' }).click();
  await p.getByRole('radio', { name: 'Dinner' }).click();
  await p.getByRole('button', { name: /^Move 2 entries/ }).click();
  await p.getByText(/Moved 2 entries to dinner on /).waitFor({ timeout: 10000 });
  const req = JSON.parse(calls.find((c) => c.path === '/api/diary/move').body);
  const tomorrow = new Date(Date.now() + 864e5); const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  assert.deepEqual(req, { date: today(), entryIds: ['e2', 'e3'], meal: 'Dinner', toDate: iso });
  await p.getByRole('button', { name: /^Almonds, 28 g/ }).first().waitFor();          // the unticked food stays
  assert.equal(await p.getByRole('button', { name: /^Lentil soup/ }).count(), 0, 'moved foods left today');
  await p.getByRole('button', { name: 'Undo' }).click();
  for (let i = 0; i < 40 && calls.filter((c) => c.path === '/api/diary/move').length < 3; i++) await p.waitForTimeout(100);
  const undo = calls.filter((c) => c.path === '/api/diary/move').slice(1).map((c) => JSON.parse(c.body));
  assert.deepEqual(undo.map((u) => [u.date, u.toDate, u.meal, u.entryIds]), [[iso, today(), 'Breakfast', ['e2']], [iso, today(), 'Lunch', ['e3']]]);
  assert.deepEqual(errors, []);
  await ctx.close();
});
