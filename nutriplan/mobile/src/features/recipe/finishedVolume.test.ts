import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ML_PER_CUP, volumeFromText, volumeText } from './finishedVolume.ts';

test('finished volume is typed in cups or ml and stored in ml', () => {
  assert.equal(volumeFromText('8', 'cups'), Math.round(8 * ML_PER_CUP * 10) / 10);
  assert.equal(volumeFromText('1,5', 'cups'), Math.round(1.5 * ML_PER_CUP * 10) / 10);
  assert.equal(volumeFromText('950', 'ml'), 950);
  assert.equal(volumeFromText('  ', 'cups'), null);       // empty: no volume (cleared)
  assert.equal(volumeFromText('0', 'ml'), undefined);     // not a valid amount
  assert.equal(volumeFromText('abc', 'cups'), undefined);
});

test('a stored volume reads back in either unit, and switching units keeps the amount', () => {
  const ml = volumeFromText('8', 'cups')!;
  assert.equal(volumeText(ml, 'cups'), '8');
  assert.equal(volumeText(ml, 'ml'), '1892.7');
  assert.equal(volumeText(null, 'cups'), '');
});
