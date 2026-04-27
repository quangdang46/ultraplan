#!/usr/bin/env bash
# Smoke test for the Ultraplan backend API.
# Usage:
#   bash tests/api-test.sh [BASE_URL] [CWD]
#
# Example:
#   bun run dev
#   bash tests/api-test.sh http://127.0.0.1:8080 /data/projects/ultraplan

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8080}"
CWD="${2:-$PWD}"
STREAM_TIMEOUT_SECONDS="${STREAM_TIMEOUT_SECONDS:-25}"

FAILURES=0

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 2
  fi
}

require_cmd curl
require_cmd jq
require_cmd timeout
require_cmd mktemp

new_uuid() {
  cat /proc/sys/kernel/random/uuid 2>/dev/null ||
    python3 -c 'import uuid; print(uuid.uuid4())'
}

log() {
  printf '%s\n' "$*"
}

pass() {
  printf 'PASS %s\n' "$*"
}

fail() {
  printf 'FAIL %s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}

section() {
  printf '\n== %s ==\n' "$*"
}

http_status() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local tmp
  tmp="$(mktemp)"

  if [[ -n "$body" ]]; then
    curl -sS -o "$tmp" -w '%{http_code}' \
      -X "$method" \
      -H 'Content-Type: application/json' \
      --data "$body" \
      "${BASE_URL}${path}" > "${tmp}.code"
  else
    curl -sS -o "$tmp" -w '%{http_code}' \
      -X "$method" \
      "${BASE_URL}${path}" > "${tmp}.code"
  fi

  cat "${tmp}.code"
  rm -f "${tmp}.code"
  printf '\n'
  cat "$tmp"
  rm -f "$tmp"
}

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local tmp
  local code

  tmp="$(mktemp)"

  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$tmp" -w '%{http_code}' \
      -X "$method" \
      -H 'Content-Type: application/json' \
      --data "$body" \
      "${BASE_URL}${path}")"
  else
    code="$(curl -sS -o "$tmp" -w '%{http_code}' \
      -X "$method" \
      "${BASE_URL}${path}")"
  fi

  REQUEST_STATUS="$code"
  REQUEST_BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

stream_chat() {
  local session_id="$1"
  local message="$2"
  local quote_text="${3:-}"
  local sse_file
  local payload

  sse_file="$(mktemp)"

  if [[ -n "$quote_text" ]]; then
    payload="$(jq -cn \
      --arg sessionId "$session_id" \
      --arg message "$message" \
      --arg cwd "$CWD" \
      --arg quoteText "$quote_text" \
      '{
        sessionId: $sessionId,
        message: $message,
        cwd: $cwd,
        quote: { text: $quoteText, sourceRole: "assistant" }
      }')"
  else
    payload="$(jq -cn \
      --arg sessionId "$session_id" \
      --arg message "$message" \
      --arg cwd "$CWD" \
      '{
        sessionId: $sessionId,
        message: $message,
        cwd: $cwd
      }')"
  fi

  local curl_status=0
  if ! timeout "${STREAM_TIMEOUT_SECONDS}s" \
    curl -sS -N \
      -X POST "${BASE_URL}/api/chat/stream" \
      -H 'Content-Type: application/json' \
      --data "$payload" \
      --no-buffer > "$sse_file"; then
    curl_status=$?
  fi

  STREAM_STATUS="$curl_status"
  STREAM_FILE="$sse_file"
}

assert_json_status() {
  local expected="$1"
  local label="$2"
  if [[ "$REQUEST_STATUS" == "$expected" ]]; then
    pass "$label -> HTTP $REQUEST_STATUS"
  else
    fail "$label -> HTTP $REQUEST_STATUS, expected $expected; body: $REQUEST_BODY"
  fi
}

assert_sse_contains() {
  local pattern="$1"
  local label="$2"
  if grep -q "$pattern" "$STREAM_FILE"; then
    pass "$label"
  else
    fail "$label -> missing pattern '$pattern' in SSE output"
    log "--- SSE output ---"
    cat "$STREAM_FILE"
  fi
}

assert_sse_success() {
  local label="$1"
  if [[ "$STREAM_STATUS" == "0" ]]; then
    pass "$label"
  else
    fail "$label -> curl/timeout exit $STREAM_STATUS"
    log "--- SSE output ---"
    cat "$STREAM_FILE"
  fi
}

cleanup_stream_file() {
  if [[ -n "${STREAM_FILE:-}" && -f "${STREAM_FILE:-}" ]]; then
    rm -f "$STREAM_FILE"
  fi
}

trap cleanup_stream_file EXIT

section "Config"
log "Base URL: $BASE_URL"
log "CWD: $CWD"

CHAT_SESSION_ID="$(new_uuid)"
IDLE_SESSION_ID=""

section "Health"
request_json GET /health
assert_json_status 200 "GET /health"
if jq -e '.status == "ok"' >/dev/null 2>&1 <<<"$REQUEST_BODY"; then
  pass "/health payload contains status=ok"
else
  fail "/health payload missing status=ok: $REQUEST_BODY"
fi

section "Sessions List"
request_json GET /api/sessions
assert_json_status 200 "GET /api/sessions"
if jq -e '.sessions | arrays' >/dev/null 2>&1 <<<"$REQUEST_BODY"; then
  pass "/api/sessions returns sessions array"
else
  fail "/api/sessions payload is invalid: $REQUEST_BODY"
fi

section "Create Session"
request_json POST /api/sessions "$(jq -cn --arg cwd "$CWD" '{ cwd: $cwd }')"
if [[ "$REQUEST_STATUS" == "200" || "$REQUEST_STATUS" == "201" ]]; then
  pass "POST /api/sessions -> HTTP $REQUEST_STATUS"
else
  fail "POST /api/sessions -> HTTP $REQUEST_STATUS; body: $REQUEST_BODY"
fi
IDLE_SESSION_ID="$(jq -r '.session.id // empty' <<<"$REQUEST_BODY")"
if [[ -n "$IDLE_SESSION_ID" ]]; then
  pass "Created idle session $IDLE_SESSION_ID"
else
  fail "Create session response missing session.id: $REQUEST_BODY"
fi

section "Chat Stream"
stream_chat "$CHAT_SESSION_ID" "Reply with exactly: hi. Do not use tools."
assert_sse_success "POST /api/chat/stream finished"
assert_sse_contains '^event: session_created$' "SSE emitted session_created"
assert_sse_contains '^event: message_start$' "SSE emitted message_start"
assert_sse_contains '^event: content_delta$' "SSE emitted content_delta"
assert_sse_contains '^event: message_end$' "SSE emitted message_end"
if grep -q '"text":"[^"]' "$STREAM_FILE"; then
  pass "SSE body contains streamed assistant text"
else
  fail "SSE body missing streamed assistant text"
  log "--- SSE output ---"
  cat "$STREAM_FILE"
fi
cleanup_stream_file

section "Quote Stream"
stream_chat "$CHAT_SESSION_ID" "Reply with exactly: noted." "Previous assistant message"
assert_sse_success "POST /api/chat/stream with quote finished"
assert_sse_contains '^event: message_end$' "Quoted stream emitted message_end"
cleanup_stream_file

section "Session Detail"
request_json GET "/api/sessions/${CHAT_SESSION_ID}"
assert_json_status 200 "GET /api/sessions/:id"

section "Session Messages"
request_json GET "/api/sessions/${CHAT_SESSION_ID}/messages"
assert_json_status 200 "GET /api/sessions/:id/messages"
if jq -e '.messages | arrays' >/dev/null 2>&1 <<<"$REQUEST_BODY"; then
  pass "Messages endpoint returns array"
else
  fail "Messages endpoint payload is invalid: $REQUEST_BODY"
fi

section "Rename Session"
request_json PATCH "/api/sessions/${CHAT_SESSION_ID}" \
  "$(jq -cn '{ name: "API Smoke Session" }')"
assert_json_status 200 "PATCH /api/sessions/:id"

section "Suggest Files"
request_json GET "/api/suggest/files?q=src&cwd=${CWD}"
assert_json_status 200 "GET /api/suggest/files"
if jq -e '
  (.items | type) == "array"
' >/dev/null 2>&1 <<<"$REQUEST_BODY"; then
  pass "Suggest files returns items array"
else
  fail "Suggest files payload is invalid: $REQUEST_BODY"
fi

section "Suggest Commands"
request_json GET "/api/suggest/commands?q=/he&cwd=${CWD}"
assert_json_status 200 "GET /api/suggest/commands"
if jq -e '
  (.items | type) == "array"
' >/dev/null 2>&1 <<<"$REQUEST_BODY"; then
  pass "Suggest commands returns items array"
else
  fail "Suggest commands payload is invalid: $REQUEST_BODY"
fi

section "Validation Errors"
request_json POST /api/chat/stream "$(jq -cn --arg cwd "$CWD" '{ cwd: $cwd }')"
assert_json_status 400 "POST /api/chat/stream without message"

request_json POST /api/chat/control "$(jq -cn --arg sessionId "$CHAT_SESSION_ID" '{ sessionId: $sessionId }')"
assert_json_status 400 "POST /api/chat/control without request_id"

section "Delete Idle Session"
if [[ -n "$IDLE_SESSION_ID" ]]; then
  request_json DELETE "/api/sessions/${IDLE_SESSION_ID}"
  if [[ "$REQUEST_STATUS" == "200" || "$REQUEST_STATUS" == "204" ]]; then
    pass "DELETE /api/sessions/:id -> HTTP $REQUEST_STATUS"
  else
    fail "DELETE /api/sessions/:id -> HTTP $REQUEST_STATUS; body: $REQUEST_BODY"
  fi
fi

section "Summary"
log "Chat session: $CHAT_SESSION_ID"
log "Idle session: ${IDLE_SESSION_ID:-none}"

if [[ "$FAILURES" -gt 0 ]]; then
  log "Failures: $FAILURES"
  exit 1
fi

log "All API smoke checks passed."
