#!/usr/bin/env bash
# probe-feedback-endpoint.sh <url> — print the HTTP status of POST <url>/api/_feedback.
# A brand-new Worker's workers.dev route takes a few seconds to propagate: the edge answers
# its own HTML 404 for every path right after `wrangler deploy`, which deploy-app.yml misread
# as "overlay not installed" on a correct build. Retry for up to 60s on 404/000.
URL="$1"
code=000
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
            -X POST -H 'content-type: application/json' -d '{}' \
            "$URL/api/_feedback" || echo 000)"
  { [ "$code" = "404" ] || [ "$code" = "000" ]; } || break
  [ "$attempt" = "12" ] || sleep 5
done
echo "$code"
