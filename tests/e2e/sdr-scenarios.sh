#!/usr/bin/env bash
# MemoryClaw — SDR Agent Scenario Test
# Simulates a real multi-turn SDR conversation across "sessions"
# showing how memory makes the agent smarter over time.
#
# Usage:
#   chmod +x tests/e2e/sdr-scenarios.sh
#   ./tests/e2e/sdr-scenarios.sh
#
# Prerequisites:
#   - n8n running on localhost:5678
#   - "MemoryClaw SDR Agent" workflow active at /webhook/sdr

set -euo pipefail

SDR_URL="${SDR_URL:-http://localhost:5678/webhook/sdr}"
TIMEOUT="${TIMEOUT:-60}"
PROSPECT="prospect_ana_lima"
DATA_DIR="$(cd "$(dirname "$0")/../.." && pwd)/packages/mcp-server/data"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

PASS=0; FAIL=0; TOTAL=0

log_header()  { echo -e "\n${BLUE}━━━ $1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
log_turn()    { echo -e "\n${CYAN}  👤 Prospect:${NC} $1"; }
log_agent()   { echo -e "  ${YELLOW}🤖 SDR Agent:${NC} $1"; }
log_pass()    { echo -e "    ${GREEN}✅ PASS${NC}: $1"; PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); }
log_fail()    { echo -e "    ${RED}❌ FAIL${NC}: $1"; FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); }

# ── Cleanup ──────────────────────────────────────────────────────────────
echo -e "${YELLOW}Resetting prospect memory...${NC}"
rm -rf "$DATA_DIR/users/$PROSPECT"
mkdir -p "$DATA_DIR/users"

# ── HTTP helper ──────────────────────────────────────────────────────────
say() {
  local msg="$1"
  local escaped
  escaped=$(printf '%s' "$msg" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" | tr -d '"')
  curl -s -X POST "$SDR_URL" \
    -H "Content-Type: application/json" \
    --data-binary "{\"message\": \"$escaped\", \"userId\": \"$PROSPECT\"}" \
    --max-time "$TIMEOUT" 2>/dev/null \
    || echo '{"output":"ERROR"}'
}

output_of() {
  echo "$1" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
if isinstance(d, list): d = d[0]
print(d.get('output', ''))
" 2>/dev/null
}

assert_contains() {
  local label="$1" response="$2" expected="$3"
  if output_of "$response" | python3 -c "
import sys
text = sys.stdin.read().lower()
assert '$(echo "$expected" | tr '[:upper:]' '[:lower:]')' in text
" 2>/dev/null; then
    log_pass "$label"
  else
    log_fail "$label (expected: '$expected')"
    echo "    Response: $(output_of "$response" | head -c 300)"
  fi
}

assert_not_contains() {
  local label="$1" response="$2" unexpected="$3"
  if output_of "$response" | python3 -c "
import sys
text = sys.stdin.read().lower()
assert '$(echo "$unexpected" | tr '[:upper:]' '[:lower:]')' not in text
" 2>/dev/null; then
    log_pass "$label"
  else
    log_fail "$label (unexpected '$unexpected' found)"
    echo "    Response: $(output_of "$response" | head -c 300)"
  fi
}

# ════════════════════════════════════════════════════════════════════════
# SESSION 1 — First Contact
# ════════════════════════════════════════════════════════════════════════
log_header "Session 1 — First Contact"
echo -e "  ${CYAN}Prospect Ana Lima reaches out for the first time${NC}"

log_turn "Oi, vi sobre o MemoryClaw no LinkedIn. Sou a Ana, trabalho como Head de IA na startup HealthBot."
R1=$(say "Oi, vi sobre o MemoryClaw no LinkedIn. Sou a Ana, trabalho como Head de IA na startup HealthBot.")
log_agent "$(output_of "$R1" | head -c 300)"
assert_contains "Greets and acknowledges Ana" "$R1" "ana"

sleep 2

log_turn "Temos 3 agentes de IA em producao que atendem pacientes. O problema e que eles nao lembram nada entre sessoes."
R2=$(say "Temos 3 agentes de IA em producao que atendem pacientes. O problema e que eles nao lembram nada entre sessoes.")
log_agent "$(output_of "$R2" | head -c 300)"
assert_contains "Acknowledges the pain point" "$R2" "memori"

sleep 2

# ════════════════════════════════════════════════════════════════════════
# SESSION 2 — Follow-up (simulates a new conversation)
# The agent should REMEMBER Ana without asking again
# ════════════════════════════════════════════════════════════════════════
log_header "Session 2 — Follow-up (memory test)"
echo -e "  ${CYAN}Ana returns the next day — agent must remember her context${NC}"

log_turn "Oi, voltei para saber mais sobre o produto."
R3=$(say "Oi, voltei para saber mais sobre o produto.")
log_agent "$(output_of "$R3" | head -c 300)"
assert_contains "Remembers Ana by name" "$R3" "ana"
assert_contains "Remembers HealthBot" "$R3" "healthbot"
assert_not_contains "Does not ask name again" "$R3" "qual.*seu nome"

sleep 2

log_turn "Quantos agentes de IA voces ja tem em producao com memoria?"
R4=$(say "Quantos agentes de IA voces ja tem em producao com memoria?")
log_agent "$(output_of "$R4" | head -c 300)"
assert_contains "Responds about use cases" "$R4" "agent"

sleep 2

# ════════════════════════════════════════════════════════════════════════
# SESSION 3 — Qualification deep dive
# ════════════════════════════════════════════════════════════════════════
log_header "Session 3 — Qualification (BANT)"
echo -e "  ${CYAN}Ana shares budget and timeline — agent should save and use it${NC}"

log_turn "Nosso budget para ferramentas de IA e em torno de 500 dolares por mes. Precisamos de algo rodando em 2 meses."
R5=$(say "Nosso budget para ferramentas de IA e em torno de 500 dolares por mes. Precisamos de algo rodando em 2 meses.")
log_agent "$(output_of "$R5" | head -c 300)"
assert_contains "Acknowledges budget/timeline" "$R5" "orçamento"

sleep 2

log_turn "Sou eu quem decide as ferramentas, mas preciso validar com o CTO."
R6=$(say "Sou eu quem decide as ferramentas, mas preciso validar com o CTO.")
log_agent "$(output_of "$R6" | head -c 300)"
assert_contains "Acknowledges authority" "$R6" "cto"

sleep 3

# ════════════════════════════════════════════════════════════════════════
# SESSION 4 — Final validation: full context recall
# ════════════════════════════════════════════════════════════════════════
log_header "Session 4 — Full Context Recall"
echo -e "  ${CYAN}Validate the agent has accumulated all context about Ana${NC}"

log_turn "O que voce ja sabe sobre mim, minha empresa, meu problema e meu budget? Busque na sua memoria antes de responder."
R7=$(say "O que voce ja sabe sobre mim, minha empresa, meu problema e meu budget? Busque na sua memoria antes de responder.")
SUMMARY=$(output_of "$R7")
log_agent "$SUMMARY"

assert_contains "Recalls name Ana" "$R7" "ana"
assert_contains "Recalls company or role" "$R7" "head"
assert_contains "Recalls pain point (agents/memory)" "$R7" "agente"
assert_contains "Recalls decision authority" "$R7" "cto"

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
  exit 1
else
  echo -e "  ${GREEN}Fail   : 0${NC}"
  echo -e "\n  ${GREEN}SDR Agent com memória persistente funcionando! ✅${NC}"
fi
