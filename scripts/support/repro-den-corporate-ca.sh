#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openwork-den-corporate-ca.XXXXXX")"
PORT="${DEN_TLS_REPRO_PORT:-3979}"
ISSUER="https://localhost:${PORT}"
MOCK_PID=""

cleanup() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" >/dev/null 2>&1 || true
    wait "$MOCK_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

for command in openssl curl node pnpm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $command" >&2
    exit 1
  fi
done

cat > "$TMP_DIR/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=OpenWork Corporate TLS Repro Root" \
  -keyout "$TMP_DIR/root.key" -out "$TMP_DIR/root.pem" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -subj "/CN=localhost" \
  -keyout "$TMP_DIR/server.key" -out "$TMP_DIR/server.csr" >/dev/null 2>&1
openssl x509 -req -days 1 -sha256 \
  -in "$TMP_DIR/server.csr" \
  -CA "$TMP_DIR/root.pem" -CAkey "$TMP_DIR/root.key" -CAcreateserial \
  -extfile "$TMP_DIR/server.ext" \
  -out "$TMP_DIR/server.pem" >/dev/null 2>&1

(
  cd "$ROOT_DIR"
  HOST=127.0.0.1 \
  PORT="$PORT" \
  ISSUER="$ISSUER" \
  TLS_CERT_FILE="$TMP_DIR/server.pem" \
  TLS_KEY_FILE="$TMP_DIR/server.key" \
  node scripts/mock-oauth-mcp-server.mjs > "$TMP_DIR/mock.log" 2>&1
) &
MOCK_PID=$!

for _ in $(seq 1 50); do
  if curl --silent --show-error --fail --cacert "$TMP_DIR/root.pem" "$ISSUER/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$MOCK_PID" >/dev/null 2>&1; then
    echo "ERROR: TLS OAuth fixture exited early" >&2
    cat "$TMP_DIR/mock.log" >&2
    exit 1
  fi
  sleep 0.2
done
curl --silent --show-error --fail --cacert "$TMP_DIR/root.pem" "$ISSUER/health" >/dev/null

echo "==> Control: the certificate is rejected without the corporate root"
set +e
UNTRUSTED_PROBE="$(env -u NODE_EXTRA_CA_CERTS node -e '
fetch(process.argv[1]).then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({ message: error.message, cause: error.cause?.code ?? error.cause?.message ?? null }));
  process.exit(23);
});
' "$ISSUER/health" 2>&1)"
UNTRUSTED_PROBE_STATUS=$?
set -e
if [ "$UNTRUSTED_PROBE_STATUS" -ne 23 ] || ! grep -Eq 'UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT' <<<"$UNTRUSTED_PROBE"; then
  echo "ERROR: expected Node to reject the corporate certificate" >&2
  echo "$UNTRUSTED_PROBE" >&2
  exit 1
fi
echo "$UNTRUSTED_PROBE"

echo "==> Den route without the corporate root: expect 502 fetch failed"
(
  cd "$ROOT_DIR"
  env -u NODE_EXTRA_CA_CERTS \
    DEN_TLS_REPRO_URL="$ISSUER" \
    DEN_TLS_REPRO_EXPECT=untrusted \
    pnpm --filter @openwork-ee/den-api exec tsx scripts/repro-corporate-ca.ts
)

echo "==> Den route with NODE_EXTRA_CA_CERTS: expect OAuth discovery"
(
  cd "$ROOT_DIR"
  NODE_EXTRA_CA_CERTS="$TMP_DIR/root.pem" \
    DEN_TLS_REPRO_URL="$ISSUER" \
    DEN_TLS_REPRO_EXPECT=trusted \
    pnpm --filter @openwork-ee/den-api exec tsx scripts/repro-corporate-ca.ts
)

echo "==> PASS: the same Den OAuth route fails without the corporate CA and reaches needs_auth when the CA is mounted at process startup"
