#!/bin/sh
# Run every browser test, each against its own fresh server.
#   cd tests/e2e && npm install && npx playwright install chromium && ./run.sh [suite ...]
# PYTHON is the interpreter with Wally's API requirements installed (default: python3).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PYTHON=${PYTHON:-python3}
TMP=$(mktemp -d)
FAILED=""

serve() { # serve <port> <folder> [demo]
  rm -rf "$2" && mkdir -p "$2"
  (cd "$REPO" && WALLY_DATA="$2" DEMO="${3:-false}" WALLY_RECOVERY_FILE="$2/password.txt" "$PYTHON" -m uvicorn utils.dev_server:app --port "$1" >"$2/server.log" 2>&1 &)
  for _ in $(seq 1 50); do curl -s "http://localhost:$1/api/health" >/dev/null && return 0; sleep 0.2; done
  echo "server on $1 did not start"; cat "$2/server.log"; return 1
}
stop() { pkill -f "uvicorn utils.dev_server:app --port $1" 2>/dev/null; sleep 0.3; }
run() { # run <suite> [env...]
  name=$1; shift
  echo "=== $name"
  if env "$@" node "$HERE/$name.mjs"; then echo "--- $name passed"; else echo "--- $name FAILED"; FAILED="$FAILED $name"; fi
}

SUITES=${*:-"dashboard transactions add recurring budgets settings signin review flows"}
for s in $SUITES; do
  case $s in
    dashboard|add|flows)
      serve 8891 "$TMP/$s" true && run "$s" BASE=http://localhost:8891; stop 8891 ;;
    transactions)
      serve 8891 "$TMP/$s" true && run "$s" BASE=http://localhost:8891 SUITE=demo; stop 8891
      serve 8892 "$TMP/$s-perf" && run "$s" BASE=http://localhost:8892 SUITE=perf; stop 8892 ;;
    settings)
      serve 8891 "$TMP/$s" true && serve 8892 "$TMP/$s-empty" && run "$s" BASE=http://localhost:8891 EMPTY=http://localhost:8892; stop 8891; stop 8892 ;;
    recurring|budgets|signin|review)
      run "$s" REPO="$REPO" PYTHON="$PYTHON" PORT=8893 ;;
  esac
done
rm -rf "$TMP"
[ -z "$FAILED" ] && echo "All browser tests passed." || { echo "Failed:$FAILED"; exit 1; }
