// Today's diary rows: tap to edit, swipe to reveal Delete (never deletes by itself), Delete + Undo, and the macro summary.
// Regressions covered: taps on a swiped row not arriving (couldn't edit/delete), a swipe deleting by itself, a scroll or
// short drag opening a row, a macro bar that looked stuck once over target.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, day, drag, isOpen, mockApi, N, phone, serve, swipeLeft, TARGETS, today, visible } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const almondsEntry = { id: 'e1', date: today(), meal: 'Breakfast', item: { kind: 'Food', foodId: 'f1', name: 'Nuts, almonds', quantity: 28, unit: 'g', grams: 28, nutrition: N(162, 5.9, 6.1, 14, 3.5) } };
const yogurtEntry = { id: 'e2', date: today(), meal: 'Breakfast', item: { kind: 'Food', foodId: 'f2', name: 'Yogurt, Greek, plain, nonfat', quantity: 1, unit: 'container', grams: 170, nutrition: N(100, 17, 6, 0.7) } };
const almonds = { id: 'f1', name: 'Nuts, almonds', source: 'UsdaSrLegacy', quality: 'Standard', per100g: N(579, 21, 22, 50, 12.5), portions: [], baseUnit: 'g',
  measures: [{ unit: 'almond', label: 'almond', plural: 'almonds', base: 1.2, kind: 'Count', source: 'almond', countable: true }, { unit: 'cup', label: 'cup', plural: 'cups', base: 143, kind: 'Volume', source: 'cup, whole', countable: false },
    { unit: 'g', label: 'g', plural: 'g', base: 1, kind: 'Mass', source: null, countable: false }, { unit: 'oz', label: 'oz', plural: 'oz', base: 28.349523, kind: 'Mass', source: null, countable: false }] };

async function openToday(totals, food = almonds) {
  const ctx = await phone(b);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = await mockApi(p, {
    'GET /api/diary/quick-log': () => [],
    'GET /api/diary/': () => day([almondsEntry, yogurtEntry], totals),
    'GET /api/targets': () => TARGETS,
    'GET /api/foods/f1': () => food,
    'PATCH /api/diary/e1': (c) => { const body = JSON.parse(c.body); return { ...almondsEntry, item: { ...almondsEntry.item, quantity: body.amount, unit: body.unit } }; },
    'DELETE /api/diary/': () => [204],
  });
  await p.goto(server.url + '/');
  const row = p.getByRole('button', { name: /^Almonds, 28 g/ }).first();
  await row.waitFor({ timeout: 15000 });
  return { ctx, p, calls, row, errors };
}
const deletes = (calls) => calls.filter((c) => c.method === 'DELETE').length;

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

test('measurement list scrolls without moving the editor header', async () => {
  const manyMeasures = [...almonds.measures, ...Array.from({ length: 20 }, (_, i) => ({
    unit: `portion${i}`, label: `portion ${i}`, plural: `portions ${i}`, base: 2, kind: 'Count', source: null, countable: true,
  }))];
  const { ctx, p, row, errors } = await openToday(undefined, { ...almonds, measures: manyMeasures });
  await row.tap();
  const header = p.getByRole('heading', { name: 'Almonds' });
  const amount = p.getByRole('textbox', { name: 'Amount' });
  await amount.waitFor();
  await p.waitForTimeout(500);
  const top = (await header.boundingBox()).y;
  const assertHeader = async () => assert.ok(Math.abs((await header.boundingBox()).y - top) < 1, 'editor header stays in place');

  await p.getByRole('button', { name: /Measure: g/ }).click();
  await assertHeader();
  const group = p.getByRole('radiogroup');
  const dimensions = await group.evaluate((el) => {
    const scroll = [...el.querySelectorAll('div')].find((child) =>
      child.scrollHeight > child.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(child).overflowY));
    return scroll && { height: scroll.clientHeight, content: scroll.scrollHeight };
  });
  assert.ok(dimensions && dimensions.height <= 240 && dimensions.content > dimensions.height, 'long list is bounded and scrollable');
  await p.getByRole('radio', { name: /^portion 19/ }).click();
  await assertHeader();
  assert.equal(await amount.inputValue(), '14');
  await p.getByRole('button', { name: /Measure: portions 19/ }).click();
  await assertHeader();
  await p.getByRole('radio', { name: 'g', exact: true }).click();
  await assertHeader();
  assert.equal(await amount.inputValue(), '28', 'switching back retains the exact amount');
  await p.getByRole('button', { name: /Measure: g/ }).click();
  await p.getByRole('button', { name: /Measure: g/ }).click();
  await assertHeader();
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

test('over a macro target the summary says how far over (the bar itself stops at full)', async () => {
  const { ctx, p } = await openToday(N(1262, 23, 12, 95));
  await p.getByText('25 g over').waitFor({ timeout: 5000 });
  assert.equal(await p.getByText(/g over/).count(), 1, 'only fat is over');
  assert.equal(await p.getByLabel(/^Fat: 95 of 70 grams, 25 grams over target/).count(), 1, 'screen readers hear it too');
  await ctx.close();
});
