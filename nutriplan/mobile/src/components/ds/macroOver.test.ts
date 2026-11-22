import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barFill, macroOver } from './macroOver.ts';

test('over a macro target the amount over is reported, because the bar itself stops at full', () => {
  assert.equal(macroOver(95, 70), 25);
  assert.equal(macroOver(120, 50), 70); // 200 almonds' fat: keeps counting
  assert.equal(barFill(120, 50), 1);
  assert.equal(barFill(25, 50), 0.5);
});

test('at or near the target, or with no target, nothing is called over', () => {
  assert.equal(macroOver(50, 50), null);
  assert.equal(macroOver(52, 50), null); // within 5 %
  assert.equal(macroOver(30, 50), null);
  assert.equal(macroOver(30, 0), null);
  assert.equal(barFill(30, 0), 0);
  assert.equal(barFill(-5, 50), 0);
});
