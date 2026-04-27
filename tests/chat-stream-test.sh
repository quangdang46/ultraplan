#!/bin/bash
# Test script for chat streaming - verifies messages don't get stuck

BASE_URL="${1:-http://localhost:8080}"
CWD="${2:-$PWD}"
SESSION_ID="${3:-}"

echo "=== Chat Streaming Test ==="
echo "Server: $BASE_URL"
echo "CWD: $CWD"
echo ""

# Generate a fresh session ID - server will create it on first message
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="test-$(date +%s)-$$"
  echo "Using fresh session ID: $SESSION_ID"
else
  echo "Using provided session ID: $SESSION_ID"
fi

echo ""
echo "Sending chat message..."
echo ""

# Stream the response with timeout
timeout 30 curl -s -N -X POST "$BASE_URL/api/chat/stream" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"hello\", \"cwd\": \"$CWD\"}" \
  --no-buffer 2>&1 | while IFS= read -r line; do
  if [[ "$line" == data:* ]]; then
    EVENT=$(echo "$line" | sed 's/data: //' | jq -r '.type // empty' 2>/dev/null)
    if [[ -n "$EVENT" ]]; then
      echo "[EVENT] $EVENT"
      if [[ "$EVENT" == "message_end" ]] || [[ "$EVENT" == "error" ]]; then
        echo ">>> Stream ended (event: $EVENT)"
        break
      fi
    fi
  elif [[ "$line" == event:* ]]; then
    EVENT_TYPE=$(echo "$line" | cut -d' ' -f2)
    echo "[EVENT_TYPE] $EVENT_TYPE"
  fi
done

echo ""
echo "=== Test complete ==="
