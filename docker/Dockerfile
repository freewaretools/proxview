# syntax=docker/dockerfile:1

# ---- Builder: install all deps, build frontend + backend ----
FROM node:24-alpine AS builder
WORKDIR /app
# Toolchain for native modules (better-sqlite3, argon2, etc. added in later milestones)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend/ backend/
COPY frontend/ frontend/
RUN npm run build -w frontend && npm run build -w backend
# Drop dev dependencies (keeps compiled native modules) to slim the runtime image
RUN npm prune --omit=dev

# ---- Runtime: only prod deps + built output ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
# Release version, injected by CI (`docker build --build-arg VERSION=x.y.z`) — surfaced in the UI.
ARG VERSION=dev
ENV PROXVIEW_VERSION=$VERSION
# Optional remote-access tunnels, applied in-app by the setup wizards:
#   tailscale/tailscaled (Alpine community repo) + cloudflared (static binary)
#   + wireguard-tools (wg / wg-quick; the tunnel itself needs --cap-add NET_ADMIN).
# buildkit populates TARGETARCH (amd64 / arm64) for the target platform.
ARG TARGETARCH
RUN apk add --no-cache ca-certificates tailscale wireguard-tools && \
    wget -qO /usr/local/bin/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}" && \
    chmod +x /usr/local/bin/cloudflared && \
    mkdir -p /data
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "backend/dist/index.js"]
