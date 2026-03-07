#!/usr/bin/env bash
# MemoryClaw — End-to-End Webhook Validation
# Tests the full stack: curl → n8n Webhook → AI Agent → MCP Client → MemoryClaw MCP Server
#
# Usage:
#   chmod +x tests/e2e/webhook-scenarios.sh
#   ./tests/e2e/webhook-scenarios.sh
#
# Prerequisites:
#   - n8n running on localhost:5678
#   - "MemoryClaw Memory Test" workflow active at /webhook/teste
#   - Webhook input schema: { "message": "string", "userId": "string" }
#   - AI Agent text field: Message: {{ $json.body.message }}\nuserId: {{ $json.body.userId }}

set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:5678/webhook/teste}"
TIMEOUT="${TIMEOUT:-60}"
USER_A="user_test_a"
USER_B="user_test_b"
PASS=0
FAIL=0
TOTAL=0

# ── Colors ──────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

log_header()  { echo -e "\n${BLUE}━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
log_section() { echo -e "\n${CYAN}  ▸ $1${NC}"; }
log_pass()    { echo -e "    ${GREEN}✅ PASS${NC}: $1"; PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); }
log_fail()    { echo -e "    ${RED}❌ FAIL${NC}: $1"; FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); }
log_info()    { echo -e "    ${YELLOW}→${NC} $1"; }

# ── HTTP helper ─────────────────────────────────────────────────────────
send() {
  local msg="$1" userId="${2:-default}"
  # Escape for JSON
  local escaped_msg
  escaped_msg=$(printf '%s' "$msg" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" | tr -d '"')
  curl -s -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    --data-binary "{\"message\": \"$escaped_msg\", \"userId\": \"$userId\"}" \
    --max-time "$TIMEOUT" 2>/dev/null \
    || echo '{"output":"ERROR: no response or timeout"}'
}

# ── Assertions ──────────────────────────────────────────────────────────
assert_contains() {
  local label="$1" response="$2" expected="$3"
  if echo "$response" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    text = (d.get('output') or '').lower()
    assert '$(echo "$expected" | tr '[:upper:]' '[:lower:]')' in text
except: raise SystemExit(1)
" 2>/dev/null; then
    log_pass "$label"
  else
    log_fail "$label (expected: '$expected')"
    log_info "Response: $response"
  fi
}

assert_not_contains() {
  local label="$1" response="$2" unexpected="$3"
  if echo "$response" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    text = (d.get('output') or '').lower()
    assert '$(echo "$unexpected" | tr '[:upper:]' '[:lower:]')' not in text
except: raise SystemExit(1)
" 2>/dev/null; then
    log_pass "$label"
  else
    log_fail "$label (unexpected: '$unexpected' found)"
    log_info "Response: $response"
  fi
}

assert_has_output() {
  local label="$1" response="$2"
  if echo "$response" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
assert 'output' in d and len(d['output']) > 0
" 2>/dev/null; then
    log_pass "$label"
  else
    log_fail "$label (no 'output' field)"
    log_info "Response: $response"
  fi
}

# ════════════════════════════════════════════════════════════════════════
# CATEGORY 1: Health & Basic Connectivity
# ════════════════════════════════════════════════════════════════════════
log_header "Cat 1: Health & Connectivity"

log_section "1.1 Webhook responds with JSON"
R=$(send "ola" "$USER_A")
assert_has_output "Webhook returns valid JSON with output field" "$R"

log_section "1.2 Agent responds in Portuguese"
R=$(send "Como voce esta?" "$USER_A")
assert_has_output "Agent responds to greeting" "$R"

# ════════════════════════════════════════════════════════════════════════
# CATEGORY 2: memory_add (Save)
# ════════════════════════════════════════════════════════════════════════
log_header "Cat 2: memory_add — Saving Facts"

log_section "2.1 Save basic personal info"
R=$(send "Salve na memoria: meu nome e Carlos e sou engenheiro de dados" "$USER_A")
assert_contains "Confirms save" "$R" "salv"

log_section "2.2 Save work information"
R=$(send "Salve: trabalho na empresa DataCorp em Sao Paulo" "$USER_A")
assert_contains "Confirms work info saved" "$R" "salv"

log_section "2.3 Save preference"
R=$(send "Minha linguagem favorita de programacao e Python" "$USER_A")
assert_contains "Confirms preference saved" "$R" "salv"

log_section "2.4 Save project info"
R=$(send "Estou trabalhando num projeto chamado Pipeline Pro para processar dados em tempo real" "$USER_A")
assert_contains "Confirms project saved" "$R" "salv"

sleep 2  # allow reindex

# ════════════════════════════════════════════════════════════════════════
# CATEGORY 3: memory_search (Retrieve)
# ════════════════════════════════════════════════════════════════════════
log_header "Cat 3: memory_search — Retrieving Facts"

log_section "3.1 Retrieve by name (exact keyword)"
R=$(send "Qual e o meu nome? Busque na memoria." "$USER_A")
assert_contains "Finds name Carlos" "$R" "carlos"

log_section "3.2 Retrieve work info"
R=$(send "Onde trabalho? Busque na memoria." "$USER_A")
assert_contains "Finds company DataCorp" "$R" "datacorp"

log_section "3.3 Retrieve preference"
R=$(send "Qual e minha linguagem de programacao favorita?" "$USER_A")
assert_contains "Finds Python" "$R" "python"

log_section "3.4 Retrieve project"
R=$(send "Fale sobre meu projeto atual. Busque na memoria." "$USER_A")
assert_contains "Finds Pipeline Pro" "$R" "pipeline"

log_section "3.5 Semantic search — query differs from stored text"
R=$(send "O que eu faco profissionalmente? Busque na memoria." "$USER_A")
assert_contains "Semantic: finds work role" "$R" "engenheiro"

log_section "3.6 No hallucination — unknown fact"
R=$(send "Qual e meu time de futebol favorito? Busque na memoria." "$USER_A")
assert_not_contains "Does not hallucinate a team" "$R" "flamengo"
assert_not_contains "Does not hallucinate a team" "$R" "palmeiras"
assert_not_contains "Does not hallucinate a team" "$R" "corinthians"

# ════════════════════════════════════════════════════════════════════════
# CATEGORY 4: memory_add Merge (Deduplication)
# ════════════════════════════════════════════════════════════════════════
log_header "Cat 4: memory_add Merge — Deduplication"

log_section "4.1 Add related fact to existing topic"
R=$(send "Tambem gosto muito de TypeScript alem de Python" "$USER_A")
assert_contains "Saves second language" "$R" "salv"

sleep 2

log_section "4.2 Both facts searchable after merge"
R=$(send "Quais linguagens eu gosto? Busque na memoria." "$USER_A")
assert_contains "Finds Python after merge" "$R" "python"
assert_contains "Finds TypeScript after merge" "$R" "typescript"

log_section "4.3 Update existing fact"
R=$(send "Na verdade meu nome completo e Carlos Eduardo Silva" "$USER_A")
assert_contains "Confirms update" "$R" "salv"

sleep 2

R=$(send "Qual e o meu nome completo?" "$USER_A")
assert_contains "Finds updated full name" "$R" "carlos"

# ════════════════════════════════════════════════════════════════════════
# CATEGORY 5: Multi-User Isolation
# ════════════════════════════════════════════════════════════════════════
log_header "Cat 5: Multi-User Isolation"

log_section "5.1 Save fact for User B"
R=$(send "Meu nome e Fernanda e sou designer de UX" "$USER_B")
assert_contains "User B saves info" "$R" "salv"

sleep 2

log_section "5.2 User B finds own memory"
R=$(send "Qual e o meu nome? Busque na memoria." "$USER_B")
assert_contains "User B finds Fernanda" "$R" "fernanda"

log_section "5.3 User A does NOT see User B's memory"
R=$(send "Voce conhece alguem chamado Fernanda? Busque na memoria." "$USER_A")
assert_not_contains "User A isolated from User B" "$R" "fernanda"

log_section "5.4 User B does NOT see User A's memory"
R=$(send "Voce conhece alguem chamado Carlos? Busque na memoria." "$USER_B")
assert_not_contains "User B isolated from User A" "$R" "carlos"

# ════════════════════════════════════════════════════════════════════════
# CATEGORY 6: Edge Cases
# ════════════════════════════════════════════════════════════════════════
log_header "Cat 6: Edge Cases"

log_section "6.1 Empty query gracefully handled"
R=$(send "Busque qualquer coisa na memoria." "$USER_A")
assert_has_output "Empty-ish query returns response" "$R"

log_section "6.2 Long message handled"
LONG_MSG="Salve estas informacoes: gosto de cafe preto pela manha, prefiro trabalhar de manha cedo entre 6h e 12h, uso Mac com teclado mecanico, tenho dois monitores, bebo agua mineral sem gas, prefiro reunioes no periodo da tarde"
R=$(send "$LONG_MSG" "$USER_A")
assert_contains "Long save confirmed" "$R" "salv"

sleep 2

R=$(send "Quando eu prefiro trabalhar? Busque na memoria." "$USER_A")
assert_contains "Retrieves work hours from long message" "$R" "manha"

# ════════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  RESULTADO FINAL${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Total  : $TOTAL"
echo -e "  ${GREEN}Pass   : $PASS${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}Fail   : $FAIL${NC}"
  echo ""
  exit 1
else
  echo -e "  ${GREEN}Fail   : 0${NC}"
  echo -e "\n  ${GREEN}Todos os cenários passaram! ✅${NC}"
fi
