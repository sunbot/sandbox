import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paprikaImportError, urlImportError } from './importNotice.ts';

test('a 403 from the website is explained as the site blocking imports, with a fallback and no Paprika wording', () => {
  const n = urlImportError('The site returned 403 Forbidden.');
  assert.equal(n.title, 'This website blocked automated recipe imports');
  assert.equal(n.fallback, true);
  assert.ok(!JSON.stringify(n).match(/paprika|invalid|valid url/i));
});

test('other fetch failures keep their detail and still offer a fallback', () => {
  assert.match(urlImportError('The site returned 500 Internal Server Error.').lines[0], /500/);
  assert.equal(urlImportError("Can't reach the server.").lines[0], "Can't reach the server.");
  assert.equal(urlImportError('x').fallback, true);
});

test('paprika failures are labelled as file import failures', () => {
  assert.equal(paprikaImportError('bad file').title, 'Paprika import failed');
  assert.equal(paprikaImportError('bad file').fallback, undefined);
});
