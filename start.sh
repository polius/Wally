#!/bin/sh
# Wally's two processes: the API (uvicorn) and the web server (nginx). If either one ends, the other is
# stopped and the container exits, so Docker's restart policy can start it again instead of leaving a
# container that is "up" and answers 502. docker stop reaches both, so the API shuts down cleanly.
python3 -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --root-path /api --proxy-headers &
api=$!
nginx -g 'daemon off;' &
web=$!
stopping=0
trap 'stopping=1; kill -TERM "$api" "$web" 2>/dev/null' TERM INT
while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do
  sleep 1 & wait $!
done
kill -TERM "$api" "$web" 2>/dev/null
wait
[ "$stopping" = 1 ] && exit 0
echo "Wally: the API or the web server stopped; exiting so Docker can restart the container." >&2
exit 1
