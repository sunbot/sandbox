// A small JSON-file store. Good for a single-instance MVP; swap for a database
// (SQLite, Postgres, Firestore) before running more than one server process.

import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { creatures: {}, allowed: {}, requests: {}, events: [], visits: {} };

export function openStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(EMPTY);
  for (const key of Object.keys(EMPTY)) data[key] ??= structuredClone(EMPTY[key]);

  function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic replace, so a crash never leaves half a file
  }

  return { data, save };
}
