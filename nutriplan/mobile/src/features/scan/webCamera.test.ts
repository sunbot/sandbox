import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildVideoConstraints, classifyCameraError, describeTrack, FALLBACK_CONSTRAINTS, focusConstraint, isOverconstrained, needsBetterCamera,
  normalLevel, pickBestCamera, rearCandidates, SCAN_FORMATS, supportedScanFormats, zoomedLevel,
} from './webCamera.ts';

const summary = (over: Parameters<typeof describeTrack>[0] = {}, settings = { width: 1920, height: 1080 }) => describeTrack(over, settings);

test('the camera is requested at a size barcodes can be read at, rear-facing, never a hard-coded device', () => {
  assert.deepEqual(buildVideoConstraints(), { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } });
  // A specific camera is asked for by id (exact), chosen at run time from what this browser lists.
  assert.deepEqual(buildVideoConstraints('abc'), { deviceId: { exact: 'abc' }, width: { ideal: 1920 }, height: { ideal: 1080 } });
  // Looser requests exist for browsers that say the size can't be met, down to "any camera".
  assert.deepEqual(FALLBACK_CONSTRAINTS, [{ facingMode: { ideal: 'environment' } }, {}]);
  assert.equal(isOverconstrained({ name: 'OverconstrainedError' }), true);
  assert.equal(isOverconstrained({ name: 'NotAllowedError' }), false);
});

test('only the four barcode formats the scanner supports are used, and only those this browser can read', () => {
  assert.deepEqual([...SCAN_FORMATS], ['ean_13', 'ean_8', 'upc_a', 'upc_e']);
  assert.deepEqual(supportedScanFormats(['qr_code', 'ean_13', 'upc_a', 'code_128']), ['ean_13', 'upc_a']);
  assert.deepEqual(supportedScanFormats(['qr_code']), []);
  assert.deepEqual(supportedScanFormats([]), []);
});

test('a camera is described only by what it reports; missing capabilities are never assumed', () => {
  const none = describeTrack(undefined, undefined);
  assert.deepEqual(none, { width: 0, height: 0, focusModes: null, continuousFocus: false, zoom: null, torch: false });
  const full = describeTrack({ focusMode: ['none', 'manual', 'continuous'], zoom: { min: 1, max: 8, step: 0.1 }, torch: true }, { width: 1920, height: 1080 });
  assert.equal(full.continuousFocus, true);
  assert.deepEqual(full.zoom, { min: 1, max: 8 });
  assert.equal(full.torch, true);
  assert.equal(describeTrack({ zoom: { min: 1, max: 1 } }, {}).zoom, null); // no range = no zoom
});

test('autofocus is applied only when the camera lists continuous focus', () => {
  assert.deepEqual(focusConstraint(summary({ focusMode: ['manual', 'continuous'] })), { focusMode: 'continuous' });
  assert.equal(focusConstraint(summary({ focusMode: ['none', 'manual'] })), null);
  assert.equal(focusConstraint(summary({})), null); // browser reports nothing: nothing is applied
});

test('other lenses are tried only for a camera known to lack continuous focus', () => {
  assert.equal(needsBetterCamera(summary({ focusMode: ['none'] })), true);
  assert.equal(needsBetterCamera(summary({ focusMode: ['manual', 'single-shot'] })), true);
  assert.equal(needsBetterCamera(summary({ focusMode: ['continuous'] })), false);
  assert.equal(needsBetterCamera(summary({})), false); // nothing reported: leave the browser's choice alone
});

test('rear candidates: environment cameras by capability, labels only as a fallback, never the open one or a front camera', () => {
  const devices = [
    { deviceId: 'cur', kind: 'videoinput', label: 'camera2 0, facing back' },
    { deviceId: 'front', kind: 'videoinput', label: 'camera2 1, facing front' },
    { deviceId: 'b2', kind: 'videoinput', label: 'camera2 2, facing back' },
    { deviceId: 'b3', kind: 'videoinput', label: '', facing: ['environment'] },
    { deviceId: 'u', kind: 'videoinput', label: 'camera', facing: ['user'] },
    { deviceId: 'mic', kind: 'audioinput', label: 'back mic' },
    { deviceId: 'b4', kind: 'videoinput', label: 'rear camera' },
    { deviceId: 'b5', kind: 'videoinput', label: 'back camera 5' },
  ];
  assert.deepEqual(rearCandidates(devices, 'cur'), ['b2', 'b3', 'b4']); // bounded to 3
  assert.deepEqual(rearCandidates(devices, 'cur', 10), ['b2', 'b3', 'b4', 'b5']);
  assert.deepEqual(rearCandidates([{ deviceId: 'x', kind: 'videoinput', label: '' }], undefined), []); // unlabelled and unknown: not guessed
  assert.deepEqual(rearCandidates([], 'cur'), []);
});

test('the best camera has continuous focus first, then the larger picture; ties keep the first', () => {
  const cam = (id: string, focus: string[] | undefined, w: number, h: number) => ({ id, summary: describeTrack({ focusMode: focus }, { width: w, height: h }) });
  assert.equal(pickBestCamera([cam('a', ['none'], 1920, 1080), cam('b', ['continuous'], 640, 480)])?.id, 'b');
  assert.equal(pickBestCamera([cam('a', ['continuous'], 640, 480), cam('b', ['continuous'], 1920, 1080)])?.id, 'b');
  assert.equal(pickBestCamera([cam('a', ['none'], 1280, 720), cam('b', ['none'], 1280, 720)])?.id, 'a');
  assert.equal(pickBestCamera([]), undefined);
});

test('zoom: twice the normal view where the range allows, nothing where it would only enlarge pixels', () => {
  assert.equal(zoomedLevel(summary({ zoom: { min: 1, max: 8 } })), 2);
  assert.equal(normalLevel(summary({ zoom: { min: 1, max: 8 } })), 1);
  assert.equal(zoomedLevel(summary({ zoom: { min: 0.5, max: 10 } })), 2); // an ultra-wide minimum still means 1× is normal
  assert.equal(normalLevel(summary({ zoom: { min: 0.5, max: 10 } })), 1);
  assert.equal(zoomedLevel(summary({ zoom: { min: 1, max: 1.2 } })), null); // too little range to matter
  assert.equal(zoomedLevel(summary({ zoom: { min: 1, max: 1.5 } })), 1.5);
  assert.equal(zoomedLevel(summary({})), null); // no zoom support: no button
  assert.equal(normalLevel(summary({})), null);
});

test('camera failures are explained in words a person can act on, and typing the barcode is always offered', () => {
  const kinds = (name: string) => classifyCameraError({ name }).kind;
  assert.equal(kinds('NotAllowedError'), 'denied');
  assert.equal(kinds('SecurityError'), 'denied');
  assert.equal(kinds('NotFoundError'), 'none');
  assert.equal(kinds('NotReadableError'), 'busy');
  assert.equal(kinds('AbortError'), 'busy');
  assert.equal(kinds('SomethingElse'), 'other');
  assert.equal(classifyCameraError(new Error('x')).kind, 'other');
  assert.equal(classifyCameraError(null).kind, 'other');
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }, false).kind, 'insecure');
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'X']) assert.match(classifyCameraError({ name }).message, /type the barcode/i);
  assert.match(classifyCameraError({ name: 'NotAllowedError' }).message, /Chrome/);
});
