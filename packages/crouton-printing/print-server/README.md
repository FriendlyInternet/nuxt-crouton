# On-location print spooler (Teltonika RUT-series)

Recovery-ready deployment artifacts for the crouton-sales print pipeline on a
Teltonika RUT956 (or similar RutOS/BusyBox router). These files let you rebuild
the router side from scratch if the device is reset.

| File | Goes to | Purpose |
|------|---------|---------|
| `teltonika-simple-spooler-fast.sh` | `/root/` on the router | The polling spooler (decode + print + callback) |
| `print_server.init` | `/etc/init.d/print_server` | procd boot service (autostart + respawn) |

## How it works

The spooler runs **on the router** and only makes **outbound** calls — so the
hosted app stays public and the printers stay on a private LAN. No port
forwarding, no inbound exposure.

```
[app on Cloudflare Pages]  ◄─ HTTPS over 5G/WAN ─►  [RUT956]  ◄─ LAN ─►  [printer :9100]
   (public)                                       spooler runs here      (private, static IP)
```

1. POS order is placed → app generates a print job per printer (base64 ESC/POS) in D1.
2. Spooler polls `GET /api/print-server/events/{EVENT_ID}/jobs?mark_as_printing=true`.
3. **Pre-flight**: queries printer status on its own connection (ESC/POS
   `DLE EOT 1` + `2` + `4`). If the printer reports `Cover open`, `Paper out`,
   `Printer error`, `Printer offline`, or doesn't answer (`Printer not
   responding - paper out, cover open, or offline?`), the job fails immediately **without sending the ticket** —
   this also prevents ghost tickets printing once paper is reloaded. The
   pre-flight must be its own connection: an error-state printer stops
   draining its buffer, so queries appended after a payload would get stuck
   behind the jammed data and never be answered.
4. Decodes the base64, streams the raw bytes to `printerIp:9100` via `nc`,
   with the same status queries appended as a confirmation pass (the held-open
   socket also lets the printer drain its buffer before close).
5. Calls back `POST /api/print-server/jobs/{id}/complete` **only when the
   printer answered "online, paper present"** — otherwise `/fail` with the
   specific `errorMessage` from step 3, or `Printer stopped responding while
   printing (paper ran out mid-ticket?)` when the confirmation pass got no
   reply.

So a **Done** badge in the admin UI means the printer confirmed it was online
with paper — not just that bytes were sent. Failed jobs carry the exact reason
in `errorMessage`, shown on the print job card.

## Network topology (validated)

- **`br-lan` 192.168.1.1/24** — the RUT956's own LAN (its ethernet ports + wifi).
  Printers live here with **static IPs** (e.g. `192.168.1.72`).
- **WAN** — 5G SIM (on-location), or an ethernet uplink for bench testing.
- Printers must be on the RUT956's LAN so the spooler can reach them when the
  router is on 5G with no other network.

## Install / recover

```sh
# 1. copy the spooler script onto the router
scp teltonika-simple-spooler-fast.sh root@<router-ip>:/root/

# 2. copy + configure the boot service
scp print_server.init root@<router-ip>:/etc/init.d/print_server
ssh root@<router-ip>
vi /etc/init.d/print_server     # set API_URL (+ PRINTER_IP if not .72)
chmod +x /etc/init.d/print_server
/etc/init.d/print_server enable
/etc/init.d/print_server start
```

**That's the last SSH.** On first start the spooler generates a persistent
identity (`/etc/print_server_device`) and **prints a pairing ticket** on the
`PRINTER_IP` printer (#1366). Type the ticket's Router-ID + code into the app
(event settings → Print flow → **Setup** → *Koppel router*) — the router then
serves every event of that team whose Print flow is **Via the venue router**
(#1324). A new event needs nothing on the router; which events print is
decided entirely by the in-app Print flow picker. Revoking the router in the
app makes it print a fresh pairing ticket.

While the app is **unreachable** (no uplink, wrong `API_URL`), the script
prints a minimal English *diagnostic ticket* from its own strings instead —
if that sheet prints, the printer leg works and the problem is the uplink; if
nothing prints, look at the printer/power. Both tickets are throttled: once
per service start, then at most ~hourly (poll-count based — the RUT clock
freezes without NTP, the poll cadence doesn't).

If you can't `scp` (no password handy), `cat > /root/teltonika-simple-spooler-fast.sh`
and paste — **but** beware terminals that add leading spaces on paste: a shebang
or heredoc delimiter with leading whitespace will break. For small config edits,
prefer an in-place `sed` over re-pasting the whole file:

```sh
sed -i 's#API_URL=old#API_URL=https://your-app.pages.dev#; s#EVENT_ID=old#EVENT_ID=new#' /etc/init.d/print_server
/etc/init.d/print_server restart
```

## Configuration

> **Sync note (#1364):** the app renders an inline version of the Install +
> Configuration checklists — the "Setup" panel under the Print flow picker
> (`TransportPicker.vue`, content passed in by `crouton-sales`'s
> `SettingsTab.vue`, with the event id / app URL pre-filled). When a step or
> variable here changes, update those checklists too, and vice versa.

Set in `/etc/init.d/print_server` under `procd_set_param env`:

| Var | Value |
|-----|-------|
| `API_URL` | Base URL of the hosted app, e.g. `https://kassa.friendlyinter.net` |
| `PRINTER_IP` | Optional, default `192.168.1.72`. The printer used for the **pairing/diagnostic tickets only** — job tickets carry their own printer IP |
| `DEVICE_FILE` | Optional, default `/etc/print_server_device`. Where the persistent device id + pairing code live (delete it to mint a new identity) |
| `TICKET_EVERY` | Optional, default `1800` polls (~hourly). Pairing/diagnostic reprint throttle |
| `STATUS_CHECK` | Optional, default `1`. Set `0` to skip the DLE EOT confirmation and mark jobs complete on TCP send alone (only for printers that don't answer DLE EOT — the TM-m30 does) |
| `DRAIN_SECS` | Optional, default `2`. Seconds the socket is held open after sending so the printer can drain its buffer and reply |

The device authenticates with its own printed code (`x-device-id` +
`x-device-code` headers against `GET /api/print-server/jobs`) — there is no
shared `API_KEY` and no `EVENT_ID` in this flow. The code is a per-device
credential the app can revoke (crouton-auth scoped-access grant, with
brute-force lockout).

### Legacy: EVENT_ID + API_KEY (pre-#1366 script)

A router still running the old script polls
`GET /api/print-server/events/$EVENT_ID/jobs` with the shared `x-api-key`
(app secret `NUXT_CROUTON_SALES_PRINT_API_KEY`) and needs `EVENT_ID` updated +
`/etc/init.d/print_server restart` **per event**. That endpoint keeps working
during the migration — flash the new script whenever the router is physically
reachable, pair it once, and never SSH per event again.

### ⚠️ The event's print flow must allow the spooler (#1324)

Each event can pick its transport in the app (event settings → Print flow).
When the event is set to **Local device** or **No physical printing**, the
`/jobs` endpoint returns an empty `[]` — the spooler idles harmlessly, no
error, nothing prints from here. If tickets aren't printing, check the event's
Print flow setting first: it must be **Via the venue router** (which is also
the default for an event that never picked a flow).

## Finding the printer IP

The Epson TM-m30 prints its IP on power-on, or set a static IP in its web UI.
From the router:

```sh
cat /tmp/dhcp.leases               # DHCP clients on br-lan (empty if static)
ip neigh show dev br-lan           # ARP neighbours
```

Enter that IP (port `9100`) in the printer record in the admin UI.

## Verifying / troubleshooting

```sh
# is the service running?
ps w | grep teltonika | grep -v grep
logread -e print_server | tail -20          # or: logread -f

# uplink leg: can the router reach the app over TLS? (expect [] and exit 0)
curl -s -H "x-api-key: $KEY" "https://your-app.pages.dev/api/print-server/events/$EV/jobs"; echo " exit $?"

# printer leg: raw ESC/POS test print (init + text + feed + cut)
printf '\x1b\x40router -> printer OK\n\n\n\x1d\x56\x41\x10' | nc 192.168.1.72 9100

# status leg: query printer status (expect a couple of non-printable bytes back;
# pipe through hexdump-ish awk if you want to inspect them)
( printf '\x10\x04\x01\x10\x04\x04'; sleep 2 ) | nc 192.168.1.72 9100 | wc -c   # expect 2
```

### Gotchas learned in the field

- **No `base64` applet** on the minimal BusyBox build — the spooler uses a
  pure-awk decoder (BusyBox awk is byte-safe, so 8-bit ESC/POS survives).
- **`nc` is the minimal variant** (`nc IP PORT` only, no `-z`). Test connectivity
  by actually sending bytes, not `nc -z`.
- **TLS works** out of the box on RutOS `curl` (CA bundle present) — no `-k` needed.
- **Default config is for old local dev** (`192.168.1.214:3000`, key `1234`) —
  always confirm the env in `/etc/init.d/print_server` points at production.
- **Two spoolers race**: if you launch one manually while the boot service runs,
  both poll and `mark_as_printing` collides. Run only the service.