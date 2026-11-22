#!/usr/bin/env bash
# Builds the web app for the browser regression tests into dist-e2e/. Sign-in is out of scope there (every /api call is
# mocked), so for this build only the sign-in gate shows the app directly; the source file is restored afterwards.
# Never deploy dist-e2e.
set -euo pipefail
cd "$(dirname "$0")/.."
GATE=src/auth/AuthGate.tsx
cp "$GATE" "$GATE.e2e-orig"
trap 'mv -f "$GATE.e2e-orig" "$GATE"' EXIT
sed -i 's/^  const { state } = useAuth();/  if (children) return <>{children}<\/>;\n  const { state } = useAuth();/' "$GATE"
grep -q "if (children) return" "$GATE" || { echo "AuthGate.tsx changed shape: update e2e/build-web.sh" >&2; exit 1; }
rm -rf dist-e2e
npx expo export --platform web --output-dir dist-e2e
