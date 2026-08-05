#!/usr/bin/env bash
#
# Persistent printer-subnet route for the fanfare venue Pi (#798).
#
# The thermal printers (kitchen 192.168.1.70 / bar 192.168.1.72) are wifi clients
# of the RUT956 and live on its 192.168.1.0/24 LAN. The Pi reaches them over the
# WIRED eth0 (plugged into a RUT LAN port) by holding a static address in that
# subnet. Home wifi (wlan0) CANNOT reach them.
#
# Previously this was a hand-typed `sudo ip addr add 192.168.1.51/24 dev eth0`,
# which is flushed on every link-down/reboot. This makes it a real, autoconnecting
# NetworkManager profile so it survives reboots with zero manual steps.
#
# Idempotent: safe to re-run. Requires sudo (nmcli writes need root).
set -euo pipefail

CONN="${ETH_CONN:-eth0}"              # NM connection name bound to the eth0 device
ADDR="${ETH_ADDR:-192.168.1.51/24}"   # static IP on the RUT printer subnet
COMPETING="${COMPETING_CONN:-netplan-eth0}"  # DHCP profile that else grabs eth0 at boot

run() { echo "+ $*"; sudo "$@"; }

echo "[configure-network] pinning $CONN -> $ADDR (autoconnect, no default route)"

# Make the printer-LAN profile static, autoconnecting, and the winner for eth0.
# ipv4.never-default = the printer subnet must NEVER become the default route
# (internet/default stays on wlan0 home wifi). No gateway on this profile.
run nmcli con mod "$CONN" \
  ipv4.method manual \
  ipv4.addresses "$ADDR" \
  ipv4.gateway "" \
  ipv4.never-default yes \
  connection.autoconnect yes \
  connection.autoconnect-priority 100

# Stop the DHCP sibling profile from claiming the device on boot.
if nmcli -t -f NAME con show | grep -qx "$COMPETING"; then
  echo "[configure-network] disabling autoconnect on competing profile: $COMPETING"
  run nmcli con mod "$COMPETING" connection.autoconnect no || true
fi

# Apply now (idempotent — re-activates the profile).
run nmcli con up "$CONN"

echo "[configure-network] result:"
ip -4 addr show eth0 | sed 's/^/    /'
echo "[configure-network] done — 192.168.1.x route is now persistent across reboots."
