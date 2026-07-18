#!/usr/bin/env bash
# PersonaOS — local dev launcher (macOS / Linux)
# Starts the backend (:4000) and frontend (:4001) together.
# Usage:  ./start.sh          (installs deps if missing, then runs)
#         ./start.sh --fresh  (force reinstall deps first)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRESH=0
[[ "${1:-}" == "--fresh" ]] && FRESH=1

echo ""
echo "PersonaOS — starting local dev"
echo ""

# --- 1. env check ---
if [[ ! -f "$ROOT/backend/.env" ]]; then
  echo "  backend/.env missing. Copy backend/.env.example to backend/.env and fill it in." >&2
  exit 1
fi
if [[ ! -f "$ROOT/frontend/.env" ]]; then
  echo "  frontend/.env missing — creating a default one."
  echo "NEXT_PUBLIC_API=http://localhost:4000" > "$ROOT/frontend/.env"
fi

# --- 2. deps ---
for dir in backend frontend; do
  if [[ $FRESH -eq 1 || ! -d "$ROOT/$dir/node_modules" ]]; then
    echo "  Installing $dir dependencies..."
    (cd "$ROOT/$dir" && npm install)
  fi
done

# --- 3. launch both; kill both on Ctrl+C ---
echo "  Backend  -> http://localhost:4000"
echo "  Frontend -> http://localhost:4001"
echo ""

pids=()
cleanup() { echo ""; echo "  Stopping..."; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; exit 0; }
trap cleanup INT TERM

(cd "$ROOT/backend" && npm start) &
pids+=($!)

(cd "$ROOT/frontend" && PORT=4001 npm run dev) &
pids+=($!)

echo "  Both running. Open http://localhost:4001. Ctrl+C to stop both."
wait
