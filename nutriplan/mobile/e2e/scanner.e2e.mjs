// Web barcode scanner with a simulated camera stack and BarcodeDetector (headless Chromium has neither a phone camera nor a
// barcode detector). Regressions covered: the old low-resolution, never-focused web camera (blurry in Android Chrome); the
// fallback scanner losing its zoom button; the camera or detection loop left running after leaving; repeated detections
// causing repeated lookups; camera errors without a way to type the barcode.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { browser, day, mockApi, N, phone, serve, TARGETS, visible } from './helpers.mjs';

let server, b;
before(async () => { server = await serve(); b = await browser(); });
after(async () => { await b?.close(); await server?.close(); });

const CODE = '012345678905';
const AF = { focusMode: ['none', 'manual', 'single-shot', 'continuous'], zoom: { min: 1, max: 8, step: 0.1 }, torch: true };
const FIXED = { focusMode: ['none', 'manual'], zoom: { min: 1, max: 4 } };
const lens = (id, label, caps, maxWidth = 1920) => ({ id, label, caps, maxWidth });
const food = { id: 'f1', name: 'Pickles', source: 'UsdaBranded', quality: 'Standard', per100g: N(11, 0.3, 2, 0.2, 1), portions: [], baseUnit: 'g', measures: [] };

/** Runs in the page before the app: each "lens" has its own capabilities, like a real phone; calls are recorded on window.__cam. */
const fakeCamera = (cfg) => `(() => {
  const cfg = ${JSON.stringify(cfg)};
  window.__cam = { gum: [], stopped: [], applied: [], detectCalls: 0 };
  const open = (lens, video) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; c.getContext('2d').fillRect(0, 0, 64, 48);
    const stream = c.captureStream(5), track = stream.getVideoTracks()[0];
    const big = video && video.width && video.width.ideal >= 1920 && lens.maxWidth >= 1920;
    track.getSettings = () => ({ deviceId: lens.id, width: big ? 1920 : 640, height: big ? 1080 : 480, facingMode: 'environment' });
    track.getCapabilities = lens.caps ? () => lens.caps : undefined;
    const stop = track.stop.bind(track); track.stop = () => { window.__cam.stopped.push(lens.id); stop(); };
    track.applyConstraints = async (c2) => { window.__cam.applied.push(JSON.parse(JSON.stringify(c2))); };
    return stream;
  };
  const md = {
    getUserMedia: async (constraints) => {
      window.__cam.gum.push(JSON.parse(JSON.stringify(constraints)));
      if (cfg.gumError) { const e = new Error('x'); e.name = cfg.gumError; throw e; }
      const v = constraints.video;
      if (cfg.rejectBig && v && v.width) { const e = new Error('x'); e.name = 'OverconstrainedError'; throw e; }
      const id = v && v.deviceId && v.deviceId.exact;
      const l = id ? cfg.lenses.find((x) => x.id === id) : cfg.lenses[0];
      if (!l) { const e = new Error('x'); e.name = 'NotFoundError'; throw e; }
      return open(l, v === true ? null : v);
    },
    enumerateDevices: async () => cfg.lenses.map((l) => ({ deviceId: l.id, kind: 'videoinput', label: l.label })),
    getSupportedConstraints: () => ({ facingMode: true, width: true, height: true, zoom: true }),
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
  if (cfg.detector) {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e']; }
      constructor(o) { window.__cam.formats = o.formats; }
      async detect() { window.__cam.detectCalls++; return window.__cam.detectCalls >= (cfg.detectAfter ?? 3) ? [{ rawValue: cfg.code, format: 'ean_13' }] : []; }
    };
  } else { delete window.BarcodeDetector; }
})();`;

async function openScanner(cfg, { barcode = 200, fromToday = false } = {}) {
  const ctx = await phone(b, { permissions: ['camera'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(fakeCamera({ code: CODE, ...cfg }));
  const calls = await mockApi(p, {
    'GET /api/foods/barcode/': () => (barcode === 0 ? 'abort' : barcode === 404 ? [404, { title: 'Not found', reason: 'NotFound' }] : food),
    'GET /api/foods/f1': () => food,
    'GET /api/diary/quick-log': () => [],
    'GET /api/diary/': () => day([]),
    'GET /api/targets': () => TARGETS,
  });
  if (fromToday) {
    await p.goto(server.url + '/');
    await p.getByRole('button', { name: 'Scan a barcode' }).click();
  } else {
    await p.goto(server.url + '/scan');
  }
  await p.waitForTimeout(1500);
  const cam = () => p.evaluate(() => window.__cam);
  const lookups = () => calls.filter((c) => c.path.startsWith('/api/foods/barcode/')).length;
  return { ctx, p, cam, lookups, errors };
}
const path = (p) => new URL(p.url()).pathname;

test('the camera is asked for a sharp picture, rear-facing, and the four food barcode formats', async () => {
  const { ctx, cam } = await openScanner({ detector: true, detectAfter: 9999, lenses: [lens('L0', 'camera2 0, facing back', AF)] });
  const c = await cam();
  assert.deepEqual(c.gum[0], { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  assert.equal(c.gum.length, 1, 'a good default lens is kept: no probing');
  assert.deepEqual(c.formats, ['ean_13', 'ean_8', 'upc_a', 'upc_e']);
  assert.deepEqual(c.applied[0], { advanced: [{ focusMode: 'continuous' }] }, 'continuous focus where the camera lists it');
  await ctx.close();
});

test('a fixed-focus default lens is swapped for a rear lens that can focus, and the rest are closed', async () => {
  const { ctx, p, cam, lookups } = await openScanner({ detector: true, lenses: [lens('L0', 'camera2 0, facing back', FIXED), lens('L2', 'camera2 2, facing back', AF), lens('LF', 'camera2 1, facing front', AF)] });
  await p.waitForURL(/\/food\/f1/, { timeout: 8000 });
  const c = await cam();
  assert.deepEqual(c.gum.map((g) => g.video.deviceId?.exact ?? 'default'), ['default', 'L2'], 'never the front camera');
  assert.ok(c.stopped.includes('L0'), 'the fixed-focus lens was closed');
  assert.equal(lookups(), 1, 'one lookup, then the product opens');
  await ctx.close();
});

test('zoom and torch appear only when the camera supports them, and apply to it', async () => {
  const { ctx, p, cam } = await openScanner({ detector: true, detectAfter: 9999, lenses: [lens('L0', 'camera2 0, facing back', AF)] });
  await p.getByRole('button', { name: 'Zoom in' }).click();
  await p.getByRole('button', { name: 'Turn torch on' }).click();
  await p.waitForTimeout(300);
  const applied = (await cam()).applied.map((a) => a.advanced[0]);
  assert.deepEqual(applied.slice(1), [{ zoom: 2 }, { torch: true }]);
  await ctx.close();

  const bare = await openScanner({ detector: true, detectAfter: 9999, lenses: [lens('L0', 'camera2 0, facing back', undefined)] });
  assert.equal(await visible(bare.p.getByRole('button', { name: 'Zoom in' })), false);
  assert.equal(await visible(bare.p.getByRole('button', { name: 'Turn torch on' })), false);
  assert.equal((await bare.cam()).gum.length, 1, 'a camera that reports nothing is left as the browser chose it');
  await bare.ctx.close();
});

test('if the size is refused the camera still opens with a looser request', async () => {
  const { ctx, p, cam } = await openScanner({ detector: true, detectAfter: 9999, rejectBig: true, lenses: [lens('L0', 'camera2 0, facing back', AF, 640)] });
  assert.deepEqual((await cam()).gum.map((g) => g.video), [{ facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, { facingMode: { ideal: 'environment' } }]);
  assert.equal(await p.getByText('The camera couldn’t start').count(), 0);
  await ctx.close();
});

for (const [error, says] of [['NotAllowedError', /blocked/], ['NotFoundError', /No camera/], ['NotReadableError', /in use/]]) {
  test(`${error}: the reason is explained and typing the barcode still works`, async () => {
    const { ctx, p, lookups } = await openScanner({ detector: true, gumError: error, lenses: [lens('L0', 'camera2 0, facing back', AF)] });
    assert.match(await p.locator('body').innerText(), says);
    await p.getByRole('textbox', { name: 'Barcode number' }).fill(CODE);
    await p.getByRole('button', { name: 'Look up' }).click();
    await p.waitForURL(/\/food\/f1/, { timeout: 8000 });
    assert.equal(lookups(), 1);
    await ctx.close();
  });
}

test('without BarcodeDetector the previous scanner is used, unchanged (same request, zoom button kept)', async () => {
  const { ctx, p, cam } = await openScanner({ detector: false, lenses: [lens('L0', 'camera2 0, facing back', AF, 640)] });
  assert.deepEqual((await cam()).gum[0], { video: { facingMode: { ideal: 'environment' } } });
  assert.equal(await visible(p.getByRole('button', { name: 'Zoom in' })), true);
  assert.equal(await visible(p.getByRole('button', { name: 'Turn torch on' })), false);
  await ctx.close();
});

test('not found goes to entering the label; a network failure offers Try again, with one lookup despite repeated detections', async () => {
  const nf = await openScanner({ detector: true, detectAfter: 2, lenses: [lens('L0', 'camera2 0, facing back', AF)] }, { barcode: 404 });
  await nf.p.waitForURL(/\/custom-food\?barcode=012345678905/, { timeout: 8000 });
  await nf.ctx.close();

  const net = await openScanner({ detector: true, detectAfter: 2, lenses: [lens('L0', 'camera2 0, facing back', AF)] }, { barcode: 0 });
  await net.p.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 8000 });
  assert.equal(await visible(net.p.getByRole('button', { name: 'Enter the label by hand' })), true);
  await net.p.waitForTimeout(1500); // the camera keeps seeing the code
  assert.equal(net.lookups(), 1);
  await net.ctx.close();
});

test('leaving the screen turns the camera off and stops detecting', async () => {
  const { ctx, p, cam } = await openScanner({ detector: true, detectAfter: 9999, lenses: [lens('L0', 'camera2 0, facing back', AF)] }, { fromToday: true });
  assert.equal(path(p), '/scan');
  await p.getByRole('button', { name: 'Cancel' }).click();
  await p.waitForTimeout(800);
  assert.equal(path(p), '/');
  const c1 = await cam();
  assert.ok(c1.stopped.includes('L0'), 'camera stopped');
  await p.waitForTimeout(800);
  assert.equal((await cam()).detectCalls, c1.detectCalls, 'no detection after leaving');
  await ctx.close();
});
