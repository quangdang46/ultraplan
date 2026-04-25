#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "=== Ultraplan API Server Test ==="
echo ""

echo "1. Health check..."
curl -s "$BASE_URL/health" | jq .
echo ""

echo "2. Init auth..."
INIT=$(curl -s -X POST "$BASE_URL/api/auth/init")
echo "$INIT" | jq .
TOKEN=$(echo "$INIT" | jq -r '.tempToken')
echo ""

sleep 1

echo "3. Verify auth..."
VERIFY=$(curl -s -X POST "$BASE_URL/api/auth/verify" \
  -H "Content-Type: application/json" \
  -d "{\"tempToken\": \"$TOKEN\"}")
echo "$VERIFY" | jq .
KEY=$(echo "$VERIFY" | jq -r '.apiKey')
echo ""

echo "4. Test /api/auth/validate..."
curl -s "$BASE_URL/api/auth/validate" \
  -H "Authorization: Bearer $KEY" | jq .
echo ""

echo "5. Test /api/tools..."
curl -s "$BASE_URL/api/tools" | jq .
echo ""

echo "6. Test /api/sessions..."
curl -s "$BASE_URL/api/sessions" \
  -H "Authorization: Bearer $KEY" | jq .
echo ""

echo "7. Test /api/state..."
curl -s "$BASE_URL/api/state" \
  -H "Authorization: Bearer $KEY" | jq .
echo ""

echo "8. Stream chat (echo hello)..."
curl -s -X POST "$BASE_URL/api/chat/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"message": "run: echo hello"}'
echo ""
echo ""

echo "9. Stream chat (ls -la /tmp)..."
curl -s -X POST "$BASE_URL/api/chat/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"message": "run: ls -la /tmp"}'
echo ""
echo ""

echo "=== All tests completed ==="
