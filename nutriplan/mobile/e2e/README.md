# Browser regression tests

Each test here guards against an issue that actually happened. They drive the web build in Chromium, with every `/api` call
mocked (no server, no real data) and, for the scanner, a simulated multi-lens camera and `BarcodeDetector`.

| File | Guards against |
|---|---|
| `diary.e2e.mjs` | taps on a logged food not opening the editor; Delete not working; a swipe deleting by itself; a short drag or scroll opening a row; the macro bar looking stuck once over target |
| `scanner.e2e.mjs` | the low-resolution, never-focused web camera (blurry in Android Chrome); the fallback scanner losing its zoom button; camera/detection left running after leaving; repeated lookups; camera errors without manual entry |
| `gaps.e2e.mjs` | "Show different ideas" repeating ideas or leaking skipped ideas across filters; no way back after the last page |
| `recipe-import.e2e.mjs` | Paprika instructions shown under website import; a blocked site (403) shown as a bare status with no fallback; stale import errors surviving a tab switch, edit or retry |

Android-only touch behaviour can't be reproduced in a browser: `src/features/diary/swipe.test.ts` guards that instead (the
diary row must keep to React Native's touch handling), and `docs/LOGGING.md` lists the device checks.

```bash
npm i --no-save playwright@1.63.0 && npx playwright install chromium   # once
npm run e2e:build   # web build into dist-e2e/ (sign-in gate bypassed for this build only; never deploy it)
npm run e2e
```

CI runs them on every push and pull request ("App (browser regression tests)").
