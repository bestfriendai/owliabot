#!/bin/bash
#
# OwliaBot Docker installer — thin wrapper around `owliabot onboard --docker`
#
set -euo pipefail

OWLIABOT_IMAGE="${OWLIABOT_IMAGE:-ghcr.io/owliabot/owliabot:latest}"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "\033[0;34mℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
die()     { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── Check Docker ──────────────────────────────────────────────────────────────
command -v docker &>/dev/null || die "Docker not found. Install: https://docs.docker.com/get-docker/"
docker info &>/dev/null       || die "Docker daemon not running. Please start Docker."
COMPOSE_CMD=""; docker compose version &>/dev/null && COMPOSE_CMD="docker compose"
[ -z "$COMPOSE_CMD" ] && command -v docker-compose &>/dev/null && COMPOSE_CMD="docker-compose"

# ── Pull image ────────────────────────────────────────────────────────────────
info "Pulling ${OWLIABOT_IMAGE}..."
docker pull "${OWLIABOT_IMAGE}" || die "Failed to pull image."
success "Image ready"

# ── Prepare host directories ──────────────────────────────────────────────────
mkdir -p config workspace ~/.owliabot/auth
chmod 700 ~/.owliabot ~/.owliabot/auth 2>/dev/null || true

# ── Run interactive onboard inside container ──────────────────────────────────
info "Starting interactive configuration..."
docker run --rm -it \
  -v ~/.owliabot:/home/owliabot/.owliabot \
  -v "$(pwd)/config:/app/config" \
  -v "$(pwd):/app/output" \
  "${OWLIABOT_IMAGE}" \
  onboard --docker --config-dir /app/config --output-dir /app/output \
  </dev/tty

[ -f docker-compose.yml ] || die "Onboard did not generate docker-compose.yml."

# ── Start container ───────────────────────────────────────────────────────────
[ -z "$COMPOSE_CMD" ] && die "Docker Compose not found. Run manually: docker compose up -d"
${COMPOSE_CMD} up -d || die "Failed to start. Check docker-compose.yml."
success "Container started"

# ── Wait for healthy ──────────────────────────────────────────────────────────
info "Waiting for container..."
for i in $(seq 1 30); do
  CID=$(${COMPOSE_CMD} ps -q owliabot 2>/dev/null)
  [ -n "$CID" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null)" = "true" ] && break
  sleep 1
done
[ -n "$CID" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null)" = "true" ] \
  && success "Container is running" \
  || die "Container not ready after 30s. Check: ${COMPOSE_CMD} logs"

# ── Auto-trigger OAuth if needed ──────────────────────────────────────────────
if grep -qE 'apiKey: "?oauth"?' config/app.yaml 2>/dev/null; then
  info "OAuth providers detected — starting auth setup..."
  docker exec -it "$CID" owliabot auth setup </dev/tty || \
    info "OAuth skipped. Retry: docker exec -it owliabot owliabot auth setup"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━ OwliaBot is running! 🦉 ━━━${NC}"
echo ""
echo "  ${COMPOSE_CMD} logs -f       # Follow logs"
echo "  ${COMPOSE_CMD} restart       # Restart"
echo "  ${COMPOSE_CMD} down          # Stop"
echo "  ${COMPOSE_CMD} pull && ${COMPOSE_CMD} up -d  # Update"
