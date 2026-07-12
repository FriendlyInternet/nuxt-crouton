#!/bin/sh
# Local, agent-verifiable reproduction of the parallel per-printer drain (#1539).
#
# Drives the REAL grouping + fan-out in teltonika-simple-spooler-fast.sh (sourced
# as a library, SPOOLER_LIB=1) with stubbed `nc`/`curl`/`timeout`, feeding a poll
# RESPONSE that contains 3 jobs to 3 DISTINCT printer IPs. Each stub `nc`
# records its start second; if the fan-out is concurrent the three pre-flight
# `nc`s start within ~1s of each other, if it is serial they start ~2s apart
# (each stub sleeps 2s).
#
# Usage:  sh parallel-drain.harness.sh <PARALLEL_DRAIN 0|1>
# Prints: "RESULT: CONCURRENT spread=<n>s" (exit 0) or "RESULT: SERIAL ..." (exit 1)
#
# Runs under BusyBox ash and POSIX sh. No real printer, network, or /etc access.

set -u
MODE="${1:-1}"

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../teltonika-simple-spooler-fast.sh"

WORK=$(mktemp -d 2>/dev/null || echo "/tmp/pd_harness_$$")
mkdir -p "$WORK/bin"
NC_LOG="$WORK/nc.log"
: > "$NC_LOG"

# --- stubs (first on PATH) ---------------------------------------------------
# nc: log "<epoch> <IP=$1>", drain stdin, emit a healthy 3-byte DLE-EOT reply
# (0x12 x3) so classify_status passes, then sleep 1 to model a printer. 1s is
# enough to separate serial (each job = 2 nc sleeps ⇒ starts ≥2s apart) from
# concurrent (all starts within ~1s) at whole-second timestamp resolution.
cat > "$WORK/bin/nc" <<STUB
#!/bin/sh
echo "\$(date +%s) \$1" >> "$NC_LOG"
cat >/dev/null 2>&1
printf '\022\022\022'
sleep 1
STUB

# curl: report_complete / report_fail — succeed silently.
cat > "$WORK/bin/curl" <<'STUB'
#!/bin/sh
exit 0
STUB

# timeout: passthrough (macOS has no `timeout`); drop the duration arg, exec rest.
cat > "$WORK/bin/timeout" <<'STUB'
#!/bin/sh
shift
exec "$@"
STUB

chmod +x "$WORK/bin/nc" "$WORK/bin/curl" "$WORK/bin/timeout"
PATH="$WORK/bin:$PATH"
export PATH

# --- load the real spooler as a library --------------------------------------
SPOOLER_LIB=1
export SPOOLER_LIB
DEVICE_FILE="$WORK/device"    # unused in lib mode, but keep it off /etc
DEVICE_ID="test-device"       # normally set by the (skipped) identity block;
DEVICE_CODE="000000"          # define here so report_* don't trip `set -u`.
STATUS_CHECK=1                # exercise the pre-flight + post-send nc reads
PARALLEL_DRAIN="$MODE"
# shellcheck disable=SC1090
. "$SCRIPT"

# --- fake poll response: 3 jobs, 3 distinct printer IPs ----------------------
# printData is base64 of "TEST" (VEVTVA==) so decode_base64 yields >0 bytes.
RESPONSE='{"jobs":[{"id":"j1","printData":"VEVTVA==","printerIp":"192.168.1.70"},{"id":"j2","printData":"VEVTVA==","printerIp":"192.168.1.72"},{"id":"j3","printData":"VEVTVA==","printerIp":"192.168.1.73"}]}'
JOBLIST="$WORK/joblist.txt"
printf 'j1\nj2\nj3\n' > "$JOBLIST"

# --- drive the REAL grouping + fan-out ---------------------------------------
group_jobs_by_printer
# NB: not `GROUPS` — that's a bash special (group-id array); it silently breaks
# under sh=bash on the dev box. (Harmless on BusyBox ash, but keep it portable.)
NGROUPS=$(wc -l < "$GROUP_IPS" | tr -d ' ')
echo "groups=$NGROUPS (expect 3)"
fan_out_drain

# --- measure concurrency of the pre-flight nc starts -------------------------
# One start per printer IP (first nc = pre-flight). Take the first stamp per IP.
STARTS=$(sort -k2 "$NC_LOG" | awk '!seen[$2]++ {print $1}')
COUNT=$(echo "$STARTS" | grep -c .)
MIN=$(echo "$STARTS" | sort -n | head -1)
MAX=$(echo "$STARTS" | sort -n | tail -1)
SPREAD=$(( MAX - MIN ))

echo "printer-starts=$COUNT min=$MIN max=$MAX spread=${SPREAD}s"
rm -rf "$WORK"

if [ "$COUNT" -lt 3 ]; then
    echo "RESULT: INCOMPLETE (expected 3 printer starts, got $COUNT)"
    exit 2
fi
if [ "$SPREAD" -le 1 ]; then
    echo "RESULT: CONCURRENT spread=${SPREAD}s"
    exit 0
else
    echo "RESULT: SERIAL spread=${SPREAD}s"
    exit 1
fi
