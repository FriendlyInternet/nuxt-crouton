#!/usr/bin/env bash
#
# Boot-time + periodic reachability check for the fanfare venue rig (#798).
#
# Distinguishes the two failure modes that look identical from the app
# ("printer not responding — paper out, cover open"):
#   1. a real printer fault, vs
#   2. the RUT (the printers' wifi AP) being powered down → eth0 NO-CARRIER →
#      the whole printer subnet is gone.
#
# Run at boot and every few minutes (systemd timer). Logs a clear verdict to the
# journal; exits non-zero when degraded so `systemctl status` shows it red.
set -u

RUT="${RUT_IP:-192.168.1.1}"
KITCHEN="${KITCHEN_IP:-192.168.1.70}"
BAR="${BAR_IP:-192.168.1.72}"
PORT="${PRINTER_PORT:-9100}"
ETH_ADDR="${ETH_ADDR:-192.168.1.51/24}"
APP_URL="${APP_HEALTH_URL:-http://127.0.0.1/}"   # the till serves on port 80

fail=0
log() { echo "[fanfare-health] $*"; }
tcp_open() { timeout 2 bash -c "cat < /dev/null > /dev/tcp/$1/$2" 2>/dev/null; }

# 1. eth0 physical link (RUT LAN). carrier 0 == RUT/link down.
carrier="$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo 0)"
if [ "$carrier" = "1" ]; then
  log "OK   eth0 carrier up"
else
  log "FAIL eth0 NO-CARRIER — RUT or cable down; ALL printing will fail until restored"
  fail=1
fi

# 2. static printer-subnet IP present
if ip -4 addr show eth0 2>/dev/null | grep -q "${ETH_ADDR%/*}/"; then
  log "OK   eth0 has $ETH_ADDR (printer-subnet route)"
else
  log "FAIL eth0 missing $ETH_ADDR — run configure-network.sh"
  fail=1
fi

# 3. RUT gateway reachable
if ping -c1 -W1 "$RUT" >/dev/null 2>&1; then
  log "OK   RUT gateway $RUT reachable"
else
  log "FAIL RUT gateway $RUT unreachable"
  fail=1
fi

# 4. both station printers listening on :9100
for kv in "kitchen=$KITCHEN" "bar=$BAR"; do
  name="${kv%%=*}"; ip="${kv#*=}"
  if tcp_open "$ip" "$PORT"; then
    log "OK   $name printer $ip:$PORT open"
  else
    log "FAIL $name printer $ip:$PORT unreachable"
    fail=1
  fi
done

# 5. fanfare app responding locally. Informational, NOT a hard gate — the network
#    reachability above is the #798 signal, and the drainer tolerates the app
#    lagging. Retry for ~15s: on a fresh boot the node cold-start lags the
#    boot-time check (OnBootSec) by a few seconds, and we don't want a spurious
#    WARN every reboot.
app_ok=0
for _ in 1 2 3 4 5; do
  if curl -fsS -o /dev/null --max-time 4 "$APP_URL" 2>/dev/null; then app_ok=1; break; fi
  sleep 3
done
if [ "$app_ok" -eq 1 ]; then
  log "OK   fanfare app responding at $APP_URL"
else
  log "WARN fanfare app not responding at $APP_URL (still cold-starting, or down — check: journalctl -u fanfare)"
fi

if [ "$fail" -ne 0 ]; then
  log "VERDICT: DEGRADED — see FAIL lines above"
  exit 1
fi
if [ "$app_ok" -eq 1 ]; then
  log "VERDICT: healthy — LAN up, RUT + both printers reachable, app up"
else
  log "VERDICT: network healthy (LAN + RUT + both printers); app not responding yet — re-run in a few seconds"
fi
