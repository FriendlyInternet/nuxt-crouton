#!/bin/sh

# Crouton print spooler for Teltonika RUT-series routers (BusyBox/RutOS).
#
# Polls the hosted app for pending print jobs, decodes the base64 ESC/POS
# payload, streams it to the thermal printer's raw TCP port (9100), then calls
# back to mark the job complete/failed. Outbound-only — no inbound exposure.
#
# Self-pairing (#1366): the router generates a persistent device id + pairing
# code on first boot and authenticates every request with them. While nobody
# has claimed the device in the app, the poll answers HTTP 428 with a
# server-rendered pairing ticket, which this script prints on the attached
# thermal printer (throttled) — read the ticket, type the code into the app
# (event settings → Print flow → Setup → "Koppel router"), done. No per-event
# EVENT_ID, no shared API key, zero SSH after first imaging.
#
# Config is via environment variables (set them in the procd init service,
# /etc/init.d/print_server — see print_server.init):
#   API_URL     - base URL of the hosted app, e.g. https://your-app.example
#   PRINTER_IP  - printer used for the pairing/diagnostic tickets ONLY
#                 (job tickets carry their own printer ip). Default the
#                 documented static: 192.168.1.72
#   DEVICE_FILE - where the persistent identity lives (default
#                 /etc/print_server_device — /etc persists across reboots)
#
# Notes:
# - Uses a pure-awk base64 decoder because the minimal BusyBox build on RutOS
#   has no `base64` applet. awk on BusyBox is byte-safe, so 8-bit ESC/POS
#   (incl. CP858 high bytes) survives.
# - Uses `nc IP PORT` (the minimal nc form) — compatible with RutOS BusyBox nc.
# - A job is only marked complete after the printer confirms it is online with
#   paper present (ESC/POS DLE EOT status queries appended to the payload).
#   Set STATUS_CHECK=0 for the legacy "TCP send = done" behavior.
# - Ticket reprint throttling counts POLLS, not wall-clock time — the RUT's
#   clock freezes without NTP, but the 2s poll cadence never does.

# Configuration - can be overridden with environment variables
API_URL="${API_URL:-http://192.168.1.214:3000}"
PRINTER_IP="${PRINTER_IP:-192.168.1.72}"
DEVICE_FILE="${DEVICE_FILE:-/etc/print_server_device}"
PRINTER_PORT="9100"
# Reprint the pairing/diagnostic ticket at most every N polls (~2s each;
# 1800 ≈ hourly) — and always once on service start.
TICKET_EVERY="${TICKET_EVERY:-1800}"
# STATUS_CHECK=1 (default): after sending the ticket, query the printer with
# ESC/POS DLE EOT and only mark the job complete when the printer answers
# "online, paper present". STATUS_CHECK=0 restores the legacy fire-and-forget
# behavior (complete as soon as the TCP send succeeds) for printers that don't
# answer DLE EOT.
STATUS_CHECK="${STATUS_CHECK:-1}"
# Seconds to hold the socket open after sending — lets the printer drain its
# receive buffer and answer the status queries on the same connection. With the
# early-return read (#1539) this is now a CAP, not a fixed wait: a printer that
# answers sooner is confirmed sooner; a slow one still gets up to DRAIN_SECS.
DRAIN_SECS="${DRAIN_SECS:-2}"
# Pre-flight status-read CAP (seconds). Same early-return semantics as
# DRAIN_SECS: a fast printer clears in a fraction of this; a slow one gets the
# full window. Raise it (e.g. 3) for a printer on a weak link without slowing a
# fast one — the read returns on first reply regardless. Default matches the
# historical fixed pre-flight wait so behaviour is unchanged unless overridden.
PREFLIGHT_SECS="${PREFLIGHT_SECS:-1}"
# Parallel per-printer drain (#1539). 1 (default): different printers drain
# concurrently (one background worker per printer IP), jobs to the SAME printer
# stay strictly serial (Epson TM = one :9100 connection at a time). Set to 0 to
# force the legacy fully-sequential path (clean fallback, never worse).
PARALLEL_DRAIN="${PARALLEL_DRAIN:-1}"

# A complete DLE-EOT status reply is three bytes (status / offline cause /
# paper); once we've collected that many the read may return early instead of
# waiting out the fixed window (#1539).
NEEDED_STATUS_BYTES=3

# Sub-second poll primitive for the early-return reads. Prefer usleep (0.1s
# granularity → a fast printer clears in <1s); fall back to whole-second sleep
# on a BusyBox build without usleep (still correctly bounded by the cap, just
# 1s granularity). Detected once here so the cap arithmetic stays consistent.
if usleep 1000 2>/dev/null; then
    POLL_CMD="usleep 100000"
    POLLS_PER_SEC=10
else
    POLL_CMD="sleep 1"
    POLLS_PER_SEC=1
fi

# Stream file $1 to printer $2:9100, holding the socket open until the DLE-EOT
# reply lands in $4 (>= NEEDED_STATUS_BYTES bytes) or $3 seconds elapse —
# whichever first. Early-return (#1539): only changes WHEN we stop waiting, not
# WHAT we later conclude from the bytes. `timeout` is a hard safety net a few
# seconds past the cap so a wedged nc can never hang the drain.
send_and_wait_reply() {
    _SEND_FILE="$1"; _IP="$2"; _CAP="$3"; _RESP="$4"
    : > "$_RESP"
    _MAX=$(( _CAP * POLLS_PER_SEC ))
    [ "$_MAX" -lt 1 ] && _MAX=1
    (
        cat "$_SEND_FILE"
        # Hold stdin (and thus the socket) open, polling for the reply. Break
        # the instant the full status reply has arrived so nc gets EOF and
        # closes early; otherwise fall through at the cap.
        _n=0
        while [ "$_n" -lt "$_MAX" ]; do
            _b=$(wc -c < "$_RESP" 2>/dev/null | tr -d ' ')
            { [ -n "$_b" ] && [ "$_b" -ge "$NEEDED_STATUS_BYTES" ]; } && break
            $POLL_CMD
            _n=$(( _n + 1 ))
        done
    ) | timeout $(( _CAP + 6 )) nc "$_IP" "$PRINTER_PORT" > "$_RESP" 2>/dev/null
}

# Add Google DNS if not present
grep -q "8.8.8.8" /etc/resolv.conf || echo "nameserver 8.8.8.8" >> /etc/resolv.conf

# --- Persistent device identity (#1366) --------------------------------------
# Generated once from the kernel's uuid (no clock dependency), then reused
# forever. The printed pairing code is what the operator types into the app.
if [ ! -f "$DEVICE_FILE" ]; then
    UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null | tr -d '-')
    if [ -z "$UUID" ]; then
        echo "$(date '+%H:%M:%S') FATAL: cannot read /proc/sys/kernel/random/uuid"
        exit 1
    fi
    # 6-digit code from a second uuid's digits (uuid hex alone can be light on
    # digits; two reads always yield enough).
    DIGITS=$(cat /proc/sys/kernel/random/uuid /proc/sys/kernel/random/uuid | tr -cd '0-9')
    {
        echo "DEVICE_ID=rut-$(echo "$UUID" | cut -c1-8)"
        echo "DEVICE_CODE=$(echo "$DIGITS" | cut -c1-6)"
    } > "$DEVICE_FILE"
fi
. "$DEVICE_FILE"

echo "$(date '+%H:%M:%S') Crouton print spooler started"
echo "  API_URL: $API_URL"
echo "  DEVICE_ID: $DEVICE_ID"

# Faster base64 decoder - simplified version
decode_base64() {
    awk '
    BEGIN {
        b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        for (i = 0; i < 64; i++) {
            b64_to_num[substr(b64, i+1, 1)] = i
        }
        b64_to_num["="] = 0
    }
    {
        gsub(/[ \t\r\n]/, "", $0)
        for (i = 1; i <= length($0); i += 4) {
            c1 = substr($0, i, 1); c2 = substr($0, i+1, 1)
            c3 = substr($0, i+2, 1); c4 = substr($0, i+3, 1)
            n1 = b64_to_num[c1]; n2 = b64_to_num[c2]
            n3 = (c3 == "=") ? 0 : b64_to_num[c3]
            n4 = (c4 == "=") ? 0 : b64_to_num[c4]
            printf "%c", (n1 * 4) + int(n2 / 16)
            if (c3 != "=") printf "%c", ((n2 % 16) * 16) + int(n3 / 4)
            if (c4 != "=") printf "%c", ((n3 % 4) * 64) + n4
        }
    }'
}

# Print the decimal value of the first bytes of a file, one per line (max 3).
# Used to parse DLE EOT status responses — minimal BusyBox has no od/hexdump
# guarantee, but awk is byte-safe on RutOS (same trick as decode_base64).
# Status bytes are never 0x00 or 0x0A (fixed bit 1 is always set), so awk's
# line handling can't eat them.
read_status_bytes() {
    awk 'BEGIN { for (i = 1; i < 256; i++) ord[sprintf("%c", i)] = i }
    n < 3 {
        for (j = 1; j <= length($0) && n < 3; j++) { print ord[substr($0, j, 1)]; n++ }
    }' "$1"
}

# The three real-time status queries sent together, answered in order:
#   DLE EOT 1 (printer status), DLE EOT 2 (offline cause), DLE EOT 4 (paper).
STATUS_QUERIES='\020\004\001\020\004\002\020\004\004'

# Classify the three DLE EOT response bytes ($1 $2 $3, decimal; may be empty).
# $4 = message to use when there was no response at all.
# Sets STATUS_ERROR to a human-readable reason, or "" when the printer is
# online with paper present.
classify_status() {
    B1="$1"; B2="$2"; B3="$3"
    STATUS_ERROR=""
    if [ -z "$B1" ]; then
        STATUS_ERROR="$4"
    elif [ $(( B1 & 147 )) -ne 18 ]; then
        # Every DLE EOT response has fixed bits 0/1/4/7 = 0/1/1/0,
        # i.e. (byte & 0x93) == 0x12 — anything else is not ESC/POS status.
        STATUS_ERROR="Unexpected status response - not an ESC/POS printer?"
    elif [ -n "$B2" ] && [ $(( B2 & 4 )) -ne 0 ]; then
        # DLE EOT 2: bit 2 = cover open
        STATUS_ERROR="Cover open"
    elif { [ -n "$B3" ] && [ $(( B3 & 96 )) -ne 0 ]; } || { [ -n "$B2" ] && [ $(( B2 & 32 )) -ne 0 ]; }; then
        # DLE EOT 4: bits 5+6 = roll paper end / DLE EOT 2: bit 5 = stopped, paper end
        STATUS_ERROR="Paper out"
    elif [ -n "$B2" ] && [ $(( B2 & 64 )) -ne 0 ]; then
        # DLE EOT 2: bit 6 = error condition
        STATUS_ERROR="Printer error"
    elif [ $(( B1 & 8 )) -ne 0 ]; then
        # DLE EOT 1: bit 3 = offline for any other reason
        STATUS_ERROR="Printer offline"
    fi
}

# Callback helpers. The server flips a job to status=printing when we fetch
# it, so a lost callback strands the job there (UI can only recover it via
# "Resend failed jobs") — retry a few times and use -f so HTTP errors count.
report_complete() {
    for _ in 1 2 3; do
        curl -s -f -m 10 -X POST \
            -H "x-device-id: $DEVICE_ID" \
            -H "x-device-code: $DEVICE_CODE" \
            -H "Content-Type: application/json" \
            "$API_URL/api/print-server/jobs/$1/complete" >/dev/null 2>&1 && return 0
        sleep 2
    done
    echo "$(date '+%H:%M:%S') WARNING: could not report job $1 complete"
}

# $2 = errorMessage (must not contain double quotes)
report_fail() {
    for _ in 1 2 3; do
        curl -s -f -m 10 -X POST \
            -H "x-device-id: $DEVICE_ID" \
            -H "x-device-code: $DEVICE_CODE" \
            -H "Content-Type: application/json" \
            -d "{\"errorMessage\":\"$2\"}" \
            "$API_URL/api/print-server/jobs/$1/fail" >/dev/null 2>&1 && return 0
        sleep 2
    done
    echo "$(date '+%H:%M:%S') WARNING: could not report job $1 failed"
}

# --- Pairing / diagnostic tickets (#1366) ------------------------------------
# Both are throttled by POLL COUNT (clock-freeze-safe): printed when the
# counter hits 0 (service start) and then every TICKET_EVERY polls while the
# condition persists. Printing resets the shared counter.
TICKET_COUNTDOWN=0

ticket_due() {
    [ "$TICKET_COUNTDOWN" -le 0 ]
}

ticket_printed() {
    TICKET_COUNTDOWN=$TICKET_EVERY
}

# Print the server-rendered pairing ticket ($1 = base64 ESC/POS).
print_pairing_ticket() {
    TMPFILE="/tmp/pairing_ticket.bin"
    echo "$1" | decode_base64 > "$TMPFILE"
    if [ -s "$TMPFILE" ]; then
        ( cat "$TMPFILE"; sleep "$DRAIN_SECS" ) | timeout 15 nc "$PRINTER_IP" "$PRINTER_PORT" >/dev/null 2>&1 \
            && echo "$(date '+%H:%M:%S') Pairing ticket printed on $PRINTER_IP (device $DEVICE_ID)"
    fi
    rm -f "$TMPFILE"
}

# The app is unreachable — print a minimal English diagnostic from our own
# strings (the server can't render anything for us now). Doubles as a printer
# self-test: if this sheet prints, the printer leg works and the problem is
# the uplink; if nothing prints, look at the printer/power.
print_diagnostic_ticket() {
    {
        # ESC @ init, ESC t 19 (CP858)
        printf '\033@\033t\023'
        printf 'PRINT SERVER: CANNOT REACH APP\n\n'
        printf 'Device:  %s\n' "$DEVICE_ID"
        printf 'API_URL: %s\n' "$API_URL"
        printf 'Error:   %s\n\n' "$1"
        printf 'This sheet printing means the printer\n'
        printf 'works - check the internet uplink or\n'
        printf 'the API_URL in /etc/init.d/print_server\n\n\n'
        # GS V 0 — full cut
        printf '\035V\000'
    } | timeout 15 nc "$PRINTER_IP" "$PRINTER_PORT" >/dev/null 2>&1 \
        && echo "$(date '+%H:%M:%S') Diagnostic ticket printed on $PRINTER_IP"
}

# Process one job, start to finish (pre-flight → send → confirm → callback)
process_job() {
    JOB_ID="$1"
    PRINT_DATA="$2"
    JOB_PRINTER_IP="$3"

    TMPFILE="/tmp/print_$JOB_ID.bin"
    RESPFILE="/tmp/printresp_$JOB_ID.bin"

    # Decode print data
    echo "$PRINT_DATA" | decode_base64 > "$TMPFILE"

    if [ ! -s "$TMPFILE" ]; then
        # Decode produced no bytes — report failure so the job doesn't sit at
        # status=printing forever.
        echo "$(date '+%H:%M:%S') Job $JOB_ID: empty decode (bad printData)"
        report_fail "$JOB_ID" "Empty base64 decode"
        rm -f "$TMPFILE"
        return
    fi

    if [ "$STATUS_CHECK" = "1" ]; then
        # Pre-flight: query status on its OWN connection BEFORE sending the
        # ticket. A printer in an error state (no paper, cover open) stops
        # draining its receive buffer, so queries appended after a payload get
        # stuck behind the jammed ticket data and are never answered — on an
        # empty connection a live ESC/POS printer always answers, even while
        # offline. This also avoids dumping the ticket into a jammed buffer,
        # which would print as a ghost ticket once paper is reloaded.
        QUERYFILE="/tmp/printquery_$JOB_ID.bin"
        printf "$STATUS_QUERIES" > "$QUERYFILE"
        send_and_wait_reply "$QUERYFILE" "$JOB_PRINTER_IP" "$PREFLIGHT_SECS" "$RESPFILE"
        rm -f "$QUERYFILE"

        set -- $(read_status_bytes "$RESPFILE")
        # In the field, a printer that accepts nothing / answers nothing is
        # almost always in an error state with a jammed receive buffer —
        # i.e. paper out or cover open. Say so instead of a vague shrug.
        classify_status "${1:-}" "${2:-}" "${3:-}" \
            "Printer not responding - paper out, cover open, or offline?"

        if [ -n "$STATUS_ERROR" ]; then
            echo "$(date '+%H:%M:%S') Job $JOB_ID: pre-flight failed on $JOB_PRINTER_IP: $STATUS_ERROR"
            report_fail "$JOB_ID" "$STATUS_ERROR"
            rm -f "$TMPFILE" "$RESPFILE"
            return
        fi

        # Printer is healthy — send the ticket with the same status queries
        # appended as a confirmation pass. The read holds stdin (and thus the
        # socket) open so the printer can drain its buffer and reply before nc
        # closes — abrupt close right after send is how tickets used to vanish
        # silently — but now returns the instant the reply lands (capped at
        # DRAIN_SECS) instead of always waiting the full window.
        printf "$STATUS_QUERIES" >> "$TMPFILE"
        send_and_wait_reply "$TMPFILE" "$JOB_PRINTER_IP" "$DRAIN_SECS" "$RESPFILE"

        set -- $(read_status_bytes "$RESPFILE")
        classify_status "${1:-}" "${2:-}" "${3:-}" \
            "Printer stopped responding while printing (paper ran out mid-ticket?)"

        if [ -n "$STATUS_ERROR" ]; then
            echo "$(date '+%H:%M:%S') Job $JOB_ID: post-send check failed on $JOB_PRINTER_IP: $STATUS_ERROR"
            report_fail "$JOB_ID" "$STATUS_ERROR"
        else
            echo "$(date '+%H:%M:%S') Job $JOB_ID printed on $JOB_PRINTER_IP"
            report_complete "$JOB_ID"
        fi
    else
        # Legacy fire-and-forget: trust the TCP send (no confirmation the
        # printer actually printed).
        timeout 5 nc "$JOB_PRINTER_IP" "$PRINTER_PORT" < "$TMPFILE" 2>/dev/null

        if [ $? -eq 0 ]; then
            echo "$(date '+%H:%M:%S') Job $JOB_ID sent to $JOB_PRINTER_IP"
            report_complete "$JOB_ID"
        else
            echo "$(date '+%H:%M:%S') Job $JOB_ID failed to print"
            report_fail "$JOB_ID" "Failed to send to printer"
        fi
    fi

    rm -f "$TMPFILE" "$RESPFILE"
}

while true; do
    [ "$TICKET_COUNTDOWN" -gt 0 ] && TICKET_COUNTDOWN=$((TICKET_COUNTDOWN - 1))

    # Poll the device-scoped endpoint (#1366) — the claim in the app decides
    # which events we serve; no EVENT_ID here. Generous timeout: a bulk
    # requeue ("Resend failed jobs") returns every ticket's base64 in one
    # response — with -m 5 that truncated over 5G, leaving jobs flipped to
    # status=printing but never parsed (stuck forever).
    BODYFILE="/tmp/poll_body.$$"
    HTTP_CODE=$(curl -s -m 30 -o "$BODYFILE" -w '%{http_code}' \
        -H "x-device-id: $DEVICE_ID" \
        -H "x-device-code: $DEVICE_CODE" \
        "$API_URL/api/print-server/jobs?mark_as_printing=true" 2>/dev/null)
    CURL_EXIT=$?
    # Remove newlines from JSON response for grep/sed parsing.
    RESPONSE=$(tr -d '\n\r' < "$BODYFILE" 2>/dev/null | tr -s ' ')
    rm -f "$BODYFILE"

    if [ "$CURL_EXIT" -ne 0 ] || [ "$HTTP_CODE" = "000" ]; then
        # App unreachable — one diagnostic sheet per throttle window.
        if ticket_due; then
            print_diagnostic_ticket "curl exit $CURL_EXIT (no HTTP response)"
            ticket_printed
        fi
        sleep 2
        continue
    fi

    if [ "$HTTP_CODE" = "428" ]; then
        # Unclaimed: the body carries a server-rendered pairing ticket.
        if ticket_due; then
            TICKET_B64=$(echo "$RESPONSE" | sed -n 's/.*"ticket": *"\([^"]*\)".*/\1/p')
            [ -n "$TICKET_B64" ] && print_pairing_ticket "$TICKET_B64"
            ticket_printed
        fi
        sleep 2
        continue
    fi

    if [ "$HTTP_CODE" != "200" ]; then
        # 401/429/5xx: wrong code, lockout, or server trouble — log, never
        # print (a lockout printing sheets every poll would drain the roll).
        echo "$(date '+%H:%M:%S') Poll answered HTTP $HTTP_CODE"
        sleep 2
        continue
    fi

    if [ ! -z "$RESPONSE" ] && echo "$RESPONSE" | grep -q '"printData"'; then
        # Extract all job data in one pass (handle space after colon in JSON)
        JOBLIST="/tmp/jobs_$$.txt"
        echo "$RESPONSE" | grep -o '"id": *"[^"]*"' | sed 's/"id": *"\([^"]*\)"/\1/g' > "$JOBLIST"

        # Group jobs by printer IP (#1539). Different printers drain in PARALLEL
        # (one background worker each); jobs to the SAME printer stay in one
        # group and drain SERIALLY — Epson TM accepts one :9100 connection at a
        # time, so parallel jobs to one printer starve each other into timeouts.
        # No local "already processed" dedup by design: the server flips jobs to
        # status=printing on fetch (the real dedup), and a requeued job MUST
        # print again.
        GROUP_PREFIX="/tmp/pjgroup_$$"
        GROUP_IPS="/tmp/pjips_$$.txt"
        rm -f "$GROUP_PREFIX"_* "$GROUP_IPS" 2>/dev/null
        : > "$GROUP_IPS"

        while IFS= read -r JOB_ID; do
            [ -z "$JOB_ID" ] && continue
            JOB_PRINTER_IP=$(echo "$RESPONSE" | sed -n "s/.*\"id\": *\"$JOB_ID\"[^}]*\"printerIp\": *\"\([^\"]*\)\".*/\1/p")
            if [ -z "$JOB_PRINTER_IP" ]; then
                # No routable printer — fail fast so it doesn't sit at printing.
                echo "$(date '+%H:%M:%S') Job $JOB_ID: could not parse printer IP from poll response"
                report_fail "$JOB_ID" "Spooler could not parse job from poll response"
                continue
            fi
            SAFE_IP=$(echo "$JOB_PRINTER_IP" | tr -c '0-9A-Za-z' '_')
            GF="${GROUP_PREFIX}_${SAFE_IP}"
            # First job for this printer? Record the IP and remember its group
            # file maps back to the real IP.
            if [ ! -f "$GF" ]; then
                echo "$JOB_PRINTER_IP $GF" >> "$GROUP_IPS"
            fi
            echo "$JOB_ID" >> "$GF"
        done < "$JOBLIST"

        # Drain one printer's group serially: extract each job's payload and
        # print it in order (single :9100 connection at a time).
        drain_printer_group() {
            _GIP="$1"; _GFILE="$2"
            while IFS= read -r _JID; do
                [ -z "$_JID" ] && continue
                _PDATA=$(echo "$RESPONSE" | sed -n "s/.*\"id\": *\"$_JID\"[^}]*\"printData\": *\"\([^\"]*\)\".*/\1/p")
                if [ -z "$_PDATA" ]; then
                    echo "$(date '+%H:%M:%S') Job $_JID: could not parse job data from poll response"
                    report_fail "$_JID" "Spooler could not parse job from poll response"
                    continue
                fi
                echo "$(date '+%H:%M:%S') Processing job $_JID to $_GIP"
                process_job "$_JID" "$_PDATA" "$_GIP"
            done < "$_GFILE"
        }

        # Fan out one worker per printer. PARALLEL_DRAIN=0 forces the legacy
        # fully-sequential path (clean fallback, never worse than before).
        while IFS= read -r GLINE; do
            [ -z "$GLINE" ] && continue
            GIP=${GLINE%% *}
            GFILE=${GLINE#* }
            if [ "$PARALLEL_DRAIN" = "1" ]; then
                drain_printer_group "$GIP" "$GFILE" &
            else
                drain_printer_group "$GIP" "$GFILE"
            fi
        done < "$GROUP_IPS"
        # Wait for every printer's worker before the next poll (no-op when the
        # drain ran sequentially).
        wait

        rm -f "$JOBLIST" "$GROUP_IPS" "$GROUP_PREFIX"_*

        # Short sleep when jobs found
        sleep 1
    else
        # Tighter idle poll (#1539) — cheap ~1s pickup win when no jobs pending.
        sleep 1
    fi
done
