// Layout regressions on narrow phones. The shared search field's text input had no minWidth, so on web it refused to shrink:
// at 360 px (a common phone) its clear button was pushed out of the field and the card around it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, mockApi, serve, TARGETS } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

for (const width of [320, 360, 393]) {
  test(`the search field and its clear button stay inside the screen at ${width} px`, async () => {
    const ctx = await b.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    await mockApi(p, { 'GET /api/recipes': () => [200, []], 'GET /api/targets': () => TARGETS });
    await p.goto(server.url + '/recipes');
    const input = p.getByRole('textbox', { name: 'Search recipes' });
    await input.fill('chicken soup');
    const clear = p.getByRole('button', { name: 'Clear search' });
    await clear.waitFor({ timeout: 5000 });
    const field = await input.locator('xpath=..').boundingBox();
    const x = await clear.boundingBox();
    assert.ok(field.x + field.width <= width + 0.5, `field ends at ${field.x + field.width}, screen is ${width}`);
    assert.ok(x.x + x.width <= field.x + field.width + 0.5, `clear button ends at ${x.x + x.width}, field ends at ${field.x + field.width}`);
    assert.ok(x.x >= field.x, 'clear button starts inside the field');
    await ctx.close();
  });
}
