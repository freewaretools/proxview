# ProxView

![CI](https://github.com/abarbarich/proxview/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Docker ready](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Fastify 5](https://img.shields.io/badge/Fastify-5-white?logo=fastify&logoColor=black)
![Read-only](https://img.shields.io/badge/access-read--only-success)

**A read-only pane of glass for every Proxmox VE cluster and Proxmox Backup Server you run.**

ProxView is a free, self-hosted **view-only monitoring dashboard** for homelabbers running
**multiple** Proxmox stations — a lightweight, no-licence alternative to Proxmox Datacenter
Manager with a one-command deploy. It **only ever reads**: least-privilege *audit* API
tokens for metrics and a read-only SSH key for temperatures. ProxView never starts, stops,
migrates, or changes anything on your nodes — it's a dashboard, not a controller.

![ProxView overview — multiple Proxmox VE nodes and a PBS server in one dark dashboard](docs/screenshots/overview.png)

- 🖥️ **Per-node CPU, memory, disk & temperatures** across all your sites, live
- 📦 **VMs & CTs** running on each node, with status and resource use
- 📈 **History charts** (CPU / memory / temperature) with 1h · 24h · 7d ranges
- 💾 **PBS backup health** — datastore fullness, backup freshness, GC & verify status
- 🌡️ **Temperatures via SSH** (`lm-sensors`) — the one thing the Proxmox API can't give you
- 🔔 **At-a-glance alerts** — offline nodes, near-full datastores, stale backups, hot CPUs
- 🔒 **Secure by default** — first-run admin setup, encrypted credentials, localhost-only core
- 🌐 **Optional remote access** — guided in-app Cloudflare Tunnel & Tailscale wizards (no `.env` edits)

## How it's meant to run

ProxView reaches each Proxmox VE / PBS station over its API (a read-only *audit* token)
and, for temperatures, over SSH. That works best when ProxView and your stations can talk
to each other **privately**:

- **All on one network?** Point ProxView straight at each station's LAN IP.
- **Spread across sites?** Put ProxView and your nodes on a **Tailscale tailnet** or a
  **WireGuard tunnel** and add each station by its private IP. Both are set up in one place —
  **Settings → Connectivity**.

**Keep it off the public internet.** ProxView is built for a private LAN or tailnet, not
the WWW — it holds credentials for every cluster you run, so it shouldn't be world-facing.
To reach it while you're away, prefer **Tailscale** (visible only to your own devices). For
homelabbers who want a simple public URL anyway, a guided **Cloudflare Tunnel** wizard is
included — if you use it, gate the hostname with **Cloudflare Access** so the dashboard is
never left open to the world.

> **Running on a VPS reached over WireGuard/Tailscale?** Publish the port on the *tunnel*
> interface, not loopback or `0.0.0.0`. With compose, set `BIND_ADDR` to the host's tunnel
> IP (e.g. `BIND_ADDR=10.0.0.7`); with plain `docker run`, use `-p 10.0.0.7:8080:8080`. It's
> then reachable through the tunnel and refused on the public interface.

## Quick start (Docker)

```bash
git clone https://github.com/abarbarich/proxview.git && cd proxview
cp .env.example .env          # optionally set PROXVIEW_SECRET_KEY (openssl rand -hex 32)
docker compose up -d --build
```

On first boot ProxView prints a one-time **setup link** to the logs — open it to create
your admin account:

```bash
docker compose logs -f app    # look for:  Setup ProxView: http://localhost:8080/setup?token=...
```

Then open `http://localhost:8080`, sign in, and add your sites under **Settings**.

**Try it with synthetic data first** (no real cluster needed):

```bash
DEMO=1 docker compose up -d --build
```

> Prefer not to build locally? A prebuilt multi-arch image is published to
> `ghcr.io/abarbarich/proxview:latest` on each tagged release — set that as the `app`
> service's `image:` in `docker-compose.yml` to pull instead of build.

## Adding a Proxmox VE site

1. In Proxmox: **Datacenter → Permissions → API Tokens**, create a token for a user with
   the **`PVEAuditor`** role at `/` (read-only). Copy the token ID (`user@realm!name`) and
   secret.
2. In ProxView **Settings → Add a site**: name, `https://<host>:8006`, the token ID and
   secret. Leave *Verify TLS* off for the default self-signed cert.
3. (Optional) **Temperatures**: expand *Temperatures via SSH*, add the node's host, an SSH
   user, and a read-only private key. Requires `apt install lm-sensors` on the node.

Proxmox Backup Server works the same way (`https://<host>:8007`, an `Audit` token —
note PBS uses a **colon** before the secret, which ProxView handles for you).

Click any node to drill into per-metric history (CPU · memory · temperature · power):

![Node detail — CPU, memory, temperature and power history charts](docs/screenshots/node-detail.png)

## Local development

```bash
npm install
npm run dev      # backend (Fastify) on :8080, frontend (Vite) on :5173 with /api proxy
```

## Remote access (optional, opt-in)

The core stack binds to `127.0.0.1` only. Expose it deliberately from
**Settings → Connectivity** — each wizard links you to the provider to grab a token, then
ProxView applies it in-app. No `.env` edits, no compose commands.

![Settings → Remote access & connectivity — Cloudflare Tunnel, Tailscale and WireGuard wizards](docs/screenshots/connectivity.png)

- **Cloudflare Tunnel** — public HTTPS, no open ports. Create a tunnel in Cloudflare Zero
  Trust (point the public hostname at `http://localhost:8080`, gate it with **Cloudflare
  Access**), paste the tunnel token, and connect. ProxView runs `cloudflared` for you.
- **Tailscale** — tailnet-only HTTPS via Tailscale Serve. Paste a reusable auth key and
  connect; ProxView joins your tailnet and becomes reachable at
  `https://proxview.<your-tailnet>.ts.net`. Tick **Funnel** to also expose it publicly.
  Once ProxView is on the tailnet you can add sites by their `100.x` IPs.

Both `cloudflared` and `tailscaled` ship inside the image and run in userspace — no extra
container privileges. Tokens are stored AES-256-GCM encrypted alongside your site creds.

### Reach nodes across networks (WireGuard)

WireGuard needs kernel-level networking, so it runs as a compose add-on rather than
in-app. In **Settings → Connectivity**, generate a keypair, fill `wireguard/wg0.conf`
(see `wireguard/wg0.conf.example`), add the public key as a peer on your WG server, then:
`docker compose -f docker-compose.yml -f docker-compose.wireguard.yml up -d`

<details><summary>Advanced: run the tunnels as compose sidecars instead</summary>

If you'd rather not run the tunnels inside the app container, the classic sidecar files
are still here: set `CF_TUNNEL_TOKEN` / `TS_AUTHKEY` in `.env` and use
`docker compose --profile cloudflare up -d` or
`docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d`.
</details>

## Architecture

- **backend/** — Fastify + TypeScript. Holds credentials (AES-256-GCM encrypted), polls
  each site (`/cluster/resources`, `/status/datastore-usage`, SSH `sensors -j`), keeps
  live snapshots, writes time-series to SQLite, streams updates over SSE, and serves the
  built frontend.
- **frontend/** — React + Vite + Zustand. Dark, dense monitoring UI (uPlot charts).
- Ships as **one Docker image / one core service**. Data (SQLite + secret key) lives in
  the `./data` volume.

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `PORT` | `8080` | Host port the dashboard is published on |
| `BIND_ADDR` | `127.0.0.1` | Host interface to publish on. On a VPS, set to your WireGuard/Tailscale IP (e.g. `10.0.0.7`) — never `0.0.0.0` on a public box |
| `DEMO` | `0` | `1` serves synthetic data |
| `PROXVIEW_SECRET_KEY` | auto | 32-byte hex key for credential encryption |
| `POLL_INTERVAL_MS` | `10000` | PVE/PBS poll cadence |
| `TEMP_INTERVAL_MS` | `45000` | SSH temperature poll cadence |
| `RETENTION_DAYS` | `30` | Time-series retention |
| `COOKIE_SECURE` | `0` | Set `1` when always behind HTTPS |

## Roadmap

| # | Milestone | Status |
|---|-----------|--------|
| M1 | Scaffold + Docker | ✅ |
| M2 | First-run auth + DB | ✅ |
| M3 | PVE provider + live overview | ✅ |
| M4 | Time-series + history charts | ✅ |
| M5 | Temperatures via SSH | ✅ |
| M6 | PBS provider + backup health | ✅ |
| M7 | Remote-access plugins + polish | ✅ |

## Security notes

- **Read-only by design.** ProxView never mutates your clusters — give it audit tokens
  only: PVE `PVEAuditor`, PBS `Audit`. Never `root@pam`.
- Back up `data/secret.key` (or set `PROXVIEW_SECRET_KEY`): it decrypts your stored site
  credentials.
- Keep it on a private network or tailnet. Prefer Tailscale over public exposure; if you
  use the Cloudflare Tunnel wizard, put **Cloudflare Access** in front.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and the
(short) ground rules. The most important one: ProxView stays **read-only**.

## License

[MIT](LICENSE) © 2026 Anton Barbarich
