// Bundles the claude.ai page: the shared engine in ../src plus artifact/app.js,
// inlined into artifact/page.html, written to artifact/dist/creature-garden.html.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [path.join(here, 'app.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
});
const js = result.outputFiles[0].text;
if (js.includes('</script')) throw new Error('The bundle contains "</script" and cannot be inlined.');

const template = fs.readFileSync(path.join(here, 'page.html'), 'utf8');
if (!template.includes('/*BUNDLE*/')) throw new Error('page.html is missing the /*BUNDLE*/ marker.');
const out = path.join(here, 'dist', 'creature-garden.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, template.replace('/*BUNDLE*/', () => js));
console.log(`Wrote ${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
