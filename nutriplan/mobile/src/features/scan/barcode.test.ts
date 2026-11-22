import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkManualBarcode, createScanGate, digitsOf, expandUpcE, validGtin } from './barcode.ts';

test('typed barcodes: digits only, a real length and a valid check digit', () => {
  assert.equal(digitsOf('0 12345 67890 5'), '012345678905');
  assert.equal(validGtin('012345678905'), true);   // UPC-A
  assert.equal(validGtin('4006381333931'), true);  // EAN-13
  assert.equal(validGtin('96385074'), true);       // EAN-8
  assert.equal(validGtin('012345678904'), false);  // wrong check digit
  assert.deepEqual(checkManualBarcode(' 0 12345 67890 5 '), { ok: true, code: '012345678905' });
  assert.equal(checkManualBarcode('').ok, false);
  assert.equal(checkManualBarcode('12345').ok, false);
  const typo = checkManualBarcode('012345678904');
  assert.equal(typo.ok, false);
  assert.match((typo as { message: string }).message, /last digit/);
});

test('a scan is not looked up twice at once, and a failed code is ignored for a moment', () => {
  let t = 0;
  const gate = createScanGate(4000, () => t);
  assert.equal(gate.accept('A'), true);
  assert.equal(gate.accept('A'), false); // still looking it up
  assert.equal(gate.accept('B'), false);
  gate.done('A', true);                  // lookup failed
  assert.equal(gate.accept('A'), false); // same code right away: ignored (the camera keeps seeing it)
  assert.equal(gate.accept('B'), true);  // a different code is fine
  gate.done('B', false);
  t = 5000;
  assert.equal(gate.accept('A'), true);  // after the cool-down the code can be tried again
  gate.reset();
  assert.equal(gate.accept('A'), true);
});

test('a UPC-E code typed as printed is accepted (checked through its UPC-A form)', () => {
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(validGtin('042100005264'), true);
  assert.deepEqual(checkManualBarcode('04252614'), { ok: true, code: '04252614' });
  assert.equal(checkManualBarcode('04252615').ok, false); // wrong check digit
});

test('an invalid code stays ignored for as long as asked', () => {
  let t = 0;
  const gate = createScanGate(4000, () => t);
  assert.equal(gate.accept('X'), true);
  gate.done('X', true, 60_000);
  t = 10_000;
  assert.equal(gate.accept('X'), false);
  t = 61_000;
  assert.equal(gate.accept('X'), true);
});
