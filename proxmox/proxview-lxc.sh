#!/usr/bin/env bash
# =============================================================================
# ProxView — Proxmox VE LXC deploy script
#
# Creates an unprivileged Debian 12 LXC, installs Docker, and runs the published
# ProxView image — ready to use. Run this ON A PROXMOX VE HOST as root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/abarbarich/proxview/main/proxmox/proxview-lxc.sh)"
#
# Everything is configurable via environment variables (see DEFAULTS below), e.g.
#   STORAGE=local-zfs RAM_MB=2048 CT_HOSTNAME=proxview bash proxview-lxc.sh
# =============================================================================
set -euo pipefail

# ---- defaults (override via env) -------------------------------------------
CTID="${CTID:-}"                                   # blank = next free VMID
CT_HOSTNAME="${CT_HOSTNAME:-proxview}"
DISK_GB="${DISK_GB:-6}"
RAM_MB="${RAM_MB:-1024}"
CORES="${CORES:-2}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-dhcp}"                                 # dhcp  OR  a CIDR e.g. 192.168.1.50/24
GATEWAY="${GATEWAY:-}"                              # required only for a static NET
STORAGE="${STORAGE:-local-lvm}"                    # where the CT rootfs lives
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"      # where CT templates live
UNPRIVILEGED="${UNPRIVILEGED:-1}"
PROXVIEW_IMAGE="${PROXVIEW_IMAGE:-ghcr.io/abarbarich/proxview:latest}"
PROXVIEW_PORT="${PROXVIEW_PORT:-8080}"
PROXVIEW_USER="${PROXVIEW_USER:-admin}"
PROXVIEW_PASSWORD="${PROXVIEW_PASSWORD:-}"         # blank = auto-generate a strong one

# ---- pretty logging --------------------------------------------------------
B=$'\033[1m'; G=$'\033[1;32m'; Y=$'\033[1;33m'; R=$'\033[1;31m'; C=$'\033[1;36m'; N=$'\033[0m'
info() { echo "${C}▸${N} $*"; }
ok()   { echo "${G}✓${N} $*"; }
warn() { echo "${Y}!${N} $*"; }
die()  { echo "${R}✗ $*${N}" >&2; exit 1; }

# ---- preflight -------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Run as root on the Proxmox VE host."
command -v pct   >/dev/null || die "'pct' not found — this must run on a Proxmox VE host."
command -v pveam >/dev/null || die "'pveam' not found — this must run on a Proxmox VE host."
command -v pvesh >/dev/null || die "'pvesh' not found — this must run on a Proxmox VE host."

[ -n "$CTID" ] || CTID="$(pvesh get /cluster/nextid)"
if pct status "$CTID" >/dev/null 2>&1; then die "CTID $CTID already exists — set CTID=<free id>."; fi

if [ "$NET" != "dhcp" ] && [ -z "$GATEWAY" ]; then
  die "Static NET ($NET) requires GATEWAY=<router ip>."
fi

GENERATED_PW=""
if [ -z "$PROXVIEW_PASSWORD" ]; then
  PROXVIEW_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)"
  GENERATED_PW=1
fi

echo
echo "${B}ProxView LXC deploy${N}"
echo "  CTID .......... $CTID"
echo "  Hostname ...... $CT_HOSTNAME"
echo "  Resources ..... ${CORES} vCPU · ${RAM_MB} MB RAM · ${DISK_GB} GB disk"
echo "  Network ....... ${NET} on ${BRIDGE}${GATEWAY:+ (gw $GATEWAY)}"
echo "  Storage ....... rootfs=${STORAGE} · templates=${TEMPLATE_STORAGE}"
echo "  Image ......... ${PROXVIEW_IMAGE}"
echo "  Unprivileged .. $([ "$UNPRIVILEGED" = 1 ] && echo yes || echo no)"
echo "  Admin ......... ${PROXVIEW_USER} (password $([ -n "$GENERATED_PW" ] && echo auto-generated || echo preset) — shown at the end)"
echo
info "Starting in 5s — Ctrl-C to abort…"; sleep 5

# ---- 1. ensure a Debian 12 template is available ---------------------------
info "Resolving Debian 12 LXC template…"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/{print $2}' | sort -V | tail -1)"
[ -n "$TEMPLATE" ] || die "No debian-12-standard template found in 'pveam available'."
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  info "Downloading $TEMPLATE …"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi
TEMPLATE_REF="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
ok "Template ready: $TEMPLATE"

# ---- 2. create the container ----------------------------------------------
info "Creating LXC $CTID…"
if [ "$NET" = "dhcp" ]; then
  NETCONF="name=eth0,bridge=${BRIDGE},ip=dhcp"
else
  NETCONF="name=eth0,bridge=${BRIDGE},ip=${NET},gw=${GATEWAY}"
fi
# nesting + keyctl let Docker run inside an unprivileged container.
pct create "$CTID" "$TEMPLATE_REF" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM_MB" --swap 512 \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "$NETCONF" \
  --unprivileged "$UNPRIVILEGED" \
  --features nesting=1,keyctl=1 \
  --onboot 1 \
  --description "ProxView — read-only Proxmox VE + PBS dashboard (https://github.com/abarbarich/proxview)" \
  >/dev/null
ok "Container created."

info "Starting container…"
pct start "$CTID" >/dev/null
# wait for networking to settle and an IP to appear
CT_IP=""
for _ in $(seq 1 30); do
  CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')" || true
  [ -n "$CT_IP" ] && break
  sleep 2
done
[ -n "$CT_IP" ] || die "Container started but no IP yet — check '$BRIDGE' / DHCP."
ok "Container up at $CT_IP"

# ---- 3. install Docker + run ProxView (inside the CT) ----------------------
info "Installing Docker inside the container (this takes a minute)…"
# base64 the admin creds so any characters survive the substitution + shell quoting.
USER_B64="$(printf %s "$PROXVIEW_USER" | base64 | tr -d '\n')"
PASS_B64="$(printf %s "$PROXVIEW_PASSWORD" | base64 | tr -d '\n')"
INNER=$(cat <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl fuse-overlayfs >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
fi
systemctl enable --now docker >/dev/null 2>&1
docker rm -f proxview >/dev/null 2>&1 || true
docker run -d --name proxview --restart unless-stopped \
  -p __PORT__:8080 -v proxview-data:/data \
  -e PROXVIEW_ADMIN_USER="$(printf %s __USERB64__ | base64 -d)" \
  -e PROXVIEW_ADMIN_PASSWORD="$(printf %s __PASSB64__ | base64 -d)" \
  __IMAGE__ >/dev/null
EOF
)
INNER="${INNER//__PORT__/$PROXVIEW_PORT}"
INNER="${INNER//__IMAGE__/$PROXVIEW_IMAGE}"
INNER="${INNER//__USERB64__/$USER_B64}"
INNER="${INNER//__PASSB64__/$PASS_B64}"
pct exec "$CTID" -- bash -c "$INNER"
ok "ProxView container running."

# ---- 4. wait for health, grab the one-time setup token ---------------------
info "Waiting for ProxView to come up…"
pct exec "$CTID" -- bash -c \
  "for i in \$(seq 1 40); do curl -sf http://127.0.0.1:${PROXVIEW_PORT}/api/health >/dev/null && exit 0; sleep 1; done; exit 1" \
  || warn "Health check timed out — it may still be starting."

# ---- done ------------------------------------------------------------------
echo
ok "${B}ProxView is deployed!${N}"
echo
if pct exec "$CTID" -- bash -c "curl -s http://127.0.0.1:${PROXVIEW_PORT}/api/setup/status" 2>/dev/null | grep -q '"needsSetup":false'; then
  # Admin was provisioned from the environment — hand over ready-to-use credentials.
  echo "  Open:   ${C}http://${CT_IP}:${PROXVIEW_PORT}/login${N}"
  echo "  Login:  ${B}${PROXVIEW_USER}${N}  /  ${B}${PROXVIEW_PASSWORD}${N}"
  [ -n "$GENERATED_PW" ] && echo "          (auto-generated — change it in Settings → Account)"
else
  # Fallback: no/short password given — use the one-time token from the logs.
  TOKEN="$(pct exec "$CTID" -- bash -c "docker logs proxview 2>&1 | grep -oE 'token=[A-Za-z0-9_-]+' | tail -1" || true)"
  echo "  Open:   ${C}http://${CT_IP}:${PROXVIEW_PORT}/${TOKEN:+setup?${TOKEN}}${N}"
  [ -n "$TOKEN" ] || echo "  Token:  run  pct exec ${CTID} -- docker logs proxview 2>&1 | grep 'setup?token'"
fi
echo
echo "  ${B}This is LAN-only.${N} To reach it across networks, open Settings → Remote"
echo "  access & connectivity and use the Cloudflare Tunnel or Tailscale wizard."
echo
echo "  Manage:  pct enter ${CTID}   ·   updates:  pct exec ${CTID} -- sh -c \\"
echo "           'docker pull ${PROXVIEW_IMAGE} && docker rm -f proxview && docker run -d \\"
echo "            --name proxview --restart unless-stopped -p ${PROXVIEW_PORT}:8080 \\"
echo "            -v proxview-data:/data ${PROXVIEW_IMAGE}'"
echo
