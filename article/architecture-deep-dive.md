# 🦞 Moltbot - Engenharia Reversa & Análise Arquitetural Completa

> Análise profunda da arquitetura do Moltbot através de engenharia reversa do código-fonte.

## 📋 Índice

1. [Visão Geral da Arquitetura](#visão-geral-da-arquitetura)
2. [Componentes Core](#componentes-core)
3. [Subsistemas Principais](#subsistemas-principais)
4. [Fluxo de Dados](#fluxo-de-dados)
5. [Padrões Arquiteturais Únicos](#padrões-arquiteturais-únicos)
6. [Otimizações de Performance](#otimizações-de-performance)
7. [Pontos de Extensão](#pontos-de-extensão)
8. [Decisões Arquiteturais](#decisões-arquiteturais)
9. [Stack Técnico](#stack-técnico)
10. [Estrutura de Arquivos](#estrutura-de-arquivos)

---

## 🏗️ Visão Geral da Arquitetura

O Moltbot possui uma arquitetura de **control plane distribuído** baseada em WebSocket, com três camadas principais:

```
┌─────────────────────────────────────────────────────────┐
│                    GATEWAY (Control Plane)              │
│              WebSocket Server (ws://127.0.0.1:18789)    │
│  ┌──────────┬──────────┬──────────┬─────────────────┐  │
│  │ Channel  │ Agent    │  Cron    │  Canvas Host    │  │
│  │ Registry │ Runtime  │ Service  │  Browser Ctrl   │  │
│  └──────────┴──────────┴──────────┴─────────────────┘  │
└─────────────────────────────────────────────────────────┘
           ▲                    ▲                ▲
           │                    │                │
    ┌──────┴────────┐    ┌─────┴─────┐   ┌─────┴──────┐
    │   Channels    │    │  Clients  │   │   Nodes    │
    │ (WhatsApp,    │    │ (CLI,Mac  │   │ (iOS,      │
    │  Telegram,    │    │  app,Web) │   │  Android)  │
    │  Discord...)  │    └───────────┘   └────────────┘
    └───────────────┘
```

### Princípios Arquiteturais

1. **Local-first**: Gateway roda localmente, dados permanecem no dispositivo do usuário
2. **Modular**: Plugin-based architecture para canais, tools e hooks
3. **Resilient**: Failover automático, session compaction, auto-recovery
4. **Extensível**: APIs claras para extensões via plugins
5. **Performante**: Lane-based concurrency, caching, batching

---

## 🔥 Componentes Core

### 1. Gateway System (Control Plane) ⭐⭐⭐⭐⭐

**Localização**: `src/gateway/server.impl.ts`

O Gateway é o **coração do sistema** - um plano de controle WebSocket unificado que orquestra todas as operações.

#### Responsabilidades

- **WebSocket Server Management**
  - Protocol negotiation com versioning
  - Connection lifecycle (connect, disconnect, reconnect)
  - Request/response correlation via UUID
  - Event broadcasting (ticks, presence updates)

- **Service Orchestration**
  - Channel registry e routing
  - Agent runtime management
  - Cron service scheduling
  - Canvas host serving
  - Browser control coordination

- **State Management**
  - Config hot-reload sem downtime
  - Presence tracking em tempo real
  - Node registry dinâmico
  - Health monitoring com ticks

#### Binding Modes

```typescript
loopback  → 127.0.0.1      // Local-only (default, seguro)
lan       → 0.0.0.0        // Network broadcast
tailnet   → Tailscale IPv4 // Tailscale network (100.64.0.0/10)
auto      → Loopback com fallback para LAN
```

#### Gateway Protocol

**Localização**: `src/gateway/protocol/index.ts`

Protocolo baseado em JSON com validação via AJV:

```typescript
// Request frame
{
  id: string,           // UUID para correlação
  method: string,       // e.g., "agent.send", "chat.run"
  params: object        // Parâmetros validados
}

// Response frame
{
  id: string,           // Matches request id
  ok: boolean,
  payload?: any,        // Se sucesso
  error?: {             // Se falha
    code: string,
    message: string,
    details?: any
  }
}

// Event frame
{
  event: string,        // e.g., "tick", "presence.update"
  data: object
}
```

**100+ métodos suportados**:
- `agent.*` - Agent operations
- `chat.*` - Chat operations
- `config.*` - Configuration
- `cron.*` - Scheduled tasks
- `device.*` - Device management
- `exec.*` - Command execution
- `memory.*` - Memory operations
- E muito mais...

#### Gateway Client

**Localização**: `src/gateway/client.ts`

Cliente robusto com reconexão automática:

```typescript
// Features do cliente:
- Exponential backoff (1s → 30s)
- TLS fingerprint validation (anti-MITM)
- Device auth token management
- Tick monitoring (detect stalls)
- Request timeout handling
- Sequence number gap detection
- Auto-reconnect com state preservation
```

**Tick System**: Gateway envia ticks a cada 30s. Cliente detecta gaps e reconecta se necessário.

---

### 2. Agent Runtime (Pi Agent) ⭐⭐⭐⭐⭐

**Localização**: `src/agents/pi-embedded-runner/`

O **motor de execução** para operações de IA - pode rodar embedded ou como RPC.

#### Arquitetura do Run Manager

**Arquivo**: `run.ts` (700+ linhas)

```typescript
class PiEmbeddedRunner {
  // 1. Auth Profile Resolution
  resolveAuthProfile() → {
    - Seleciona profile primário
    - Configura fallback chain
    - Verifica cooldown periods
  }

  // 2. Model Selection
  selectModel() → {
    - Resolve model alias (e.g., "claude" → "claude-3-5-sonnet")
    - Valida context window
    - Aplica overrides de configuração
  }

  // 3. Context Window Validation
  validateContextWindow() → {
    - Calcula tokens disponíveis
    - Reserva espaço para resposta
    - Triggera compaction se necessário
  }

  // 4. Tool Execution
  executeTool() → {
    - Split SDK tools vs Channel tools
    - Async execution com streaming
    - Result formatting (markdown/plain)
    - Error handling e retry
  }

  // 5. Session Management
  manageSession() → {
    - Load/save session state
    - Apply compaction quando overflow
    - Track usage metrics
    - Persist to JSONL
  }
}
```

#### Failover System ⭐⭐⭐⭐

Sistema inteligente de fallback para auth profiles:

```
Primary Profile (Claude Pro)
    │
    ├─ Rate Limited? → Secondary Profile (OpenAI)
    │                      │
    │                      ├─ Auth Error? → Tertiary Profile (Gemini)
    │                                           │
    │                                           └─ All Failed? → FailoverError
    │
    └─ Context Overflow? → Auto-compaction → Retry
```

**Features**:
- **Cooldown Tracking**: Não martela APIs com erro (exponential backoff)
- **Rate Limit Detection**: Parse error messages para identificar rate limits
- **Context Overflow**: Compacta automaticamente quando atinge limite
- **Model Fallback**: Muda de modelo se profile não suportar

#### Session Lane Concurrency ⭐⭐⭐⭐⭐

**Um dos padrões mais elegantes do projeto!**

```typescript
// Dupla proteção contra overload:
enqueueSession(sessionKey, async () => {     // Por-usuário
  return enqueueGlobal(async () => {          // Global
    return executarAgente();
  });
});
```

**Por que isso é genial:**

1. **Session Lane** (por-usuário):
   - Garante fairness: cada usuário tem sua fila
   - Previne monopolização: um usuário não bloqueia outros
   - Serializa requests do mesmo usuário

2. **Global Lane** (sistema):
   - Previne overload: limita concorrência total
   - Protege recursos: CPU, memória, API rate limits
   - Configurable: ajusta via `applyGatewayLaneConcurrency()`

3. **Thundering Herd Prevention**:
   - Sem filas: 1000 mensagens simultâneas → crash
   - Com filas: 1000 mensagens → processadas de forma controlada

#### Tool Infrastructure

**Split Pattern**:

```typescript
// SDK Tools (core tools)
- Read, Write, Edit
- Bash, Exec
- Memory (search, get)
- Web (fetch, search)

// Channel Tools (platform-specific)
- Send message
- Auth user
- Get thread
- Upload media
```

**Execution Flow**:
```
Tool Request
    ↓
Tool Split (SDK vs Channel)
    ↓
├─ SDK Tool                    ├─ Channel Tool
│   ├─ Validation             │   ├─ Gating (allowlist)
│   ├─ Execution              │   ├─ Execution
│   └─ Result formatting      │   └─ Ack feedback
    ↓                              ↓
Combined Results
```

---

### 3. Channel Integration System ⭐⭐⭐⭐

**Localização**: `src/channels/`, `extensions/`

Sistema sofisticado de plugins para integrar plataformas de mensagens.

#### Canais Suportados

**Core Channels** (built-in):
- **WhatsApp** (Web via Baileys) - `src/web/`
- **Telegram** (Bot API via grammY) - `src/telegram/`
- **Discord** (Bot API via discord.js) - `src/discord/`
- **Slack** (Socket Mode via Bolt) - `src/slack/`
- **Google Chat** (HTTP webhook) - `src/googlechat/`
- **Signal** (signal-cli bridge) - `src/signal/`
- **iMessage** (experimental) - `src/imessage/`

**Extension Channels** (plugins):
- BlueBubbles, LINE, Matrix, Mattermost
- MS Teams, Nextcloud Talk, Nostr
- Zalo, Zalo Personal
- E mais...

#### Plugin Architecture

```typescript
interface ChannelPlugin {
  id: string;                    // e.g., "telegram"

  meta: {
    order?: number;              // Display order
    aliases?: string[];          // Alternative names
  };

  capabilities: {
    messaging: boolean;          // Can send/receive messages
    auth: boolean;               // Supports authentication
    group: boolean;              // Supports group chats
    directory: boolean;          // Has contact directory
    threading: boolean;          // Supports threads
    reactions: boolean;          // Supports reactions
    media: boolean;              // Supports media uploads
    // ... mais capabilities
  };

  handlers: {
    poll: PollHandler;           // Receive messages
    send: SendHandler;           // Send messages
    auth?: AuthAdapter[];        // Auth methods
  };

  gatewayMethods?: (context) => GatewayRequestHandler[];
}
```

#### Plugin Registry Pattern ⭐⭐⭐⭐

**Localização**: `src/plugins/runtime.ts`

**Truque genial** para evitar dependências circulares:

```typescript
// Global singleton via Symbol.for()
const REGISTRY_STATE = Symbol.for("moltbot.pluginRegistryState");

if (!global[REGISTRY_STATE]) {
  global[REGISTRY_STATE] = {
    plugins: new Map(),
    initialized: false
  };
}

// Garante único registry no processo inteiro
// Funciona mesmo com múltiplos imports
```

**Features**:
- **Lazy Loading**: Plugins importados apenas quando necessário
- **Two-tier Normalization**:
  - Light: `normalizeChatChannelId()` (sem registry)
  - Heavy: `normalizeAnyChannelId()` (com registry)
- **Auto-enable**: Plugins ativados baseado em config
- **Capability Queries**: `getPluginsByCapability("messaging")`

---

### 4. Routing & Binding System ⭐⭐⭐⭐

**Localização**: `src/routing/`

Sistema sofisticado de roteamento com **hierarquia de precedência**.

#### Binding Hierarchy

```
Mensagem → Binding Resolution
    ↓
Precedência (maior para menor):
1. binding.peer         → DM específico (user@telegram)
2. binding.guild        → Servidor/Guild (server-id@discord)
3. binding.team         → Team workspace (team-id@slack)
4. binding.account      → Account específico (account@whatsapp)
5. binding.channel      → Canal inteiro (telegram, discord)
6. default              → Fallback para agente default
```

#### Route Resolution Flow

```typescript
// 1. Normalize message
const normalized = {
  channel: "telegram",
  account: "bot-token",
  peer: "user-id",
  guild: null
};

// 2. Build lookup keys (em ordem de precedência)
const keys = [
  `user-id@telegram`,              // peer binding
  `server-id@discord`,             // guild binding (se aplicável)
  `team-id@slack`,                 // team binding (se aplicável)
  `account@whatsapp`,              // account binding
  `telegram`,                      // channel binding
  `default`                        // fallback
];

// 3. Match primeiro binding que existe
for (const key of keys) {
  const binding = config.bindings[key];
  if (binding) {
    return {
      agentId: binding.agent || "main",
      accountId: binding.account
    };
  }
}

// 4. Fallback para default
return { agentId: "main", accountId: null };
```

#### Session Key Generation

```typescript
// Session key = normalized, lowercase, stable identifier
function buildSessionKey(route) {
  const parts = [
    route.agentId,           // e.g., "main"
    route.channel,           // e.g., "telegram"
    route.peer || route.guild // e.g., "user-123"
  ];

  return parts.join(":").toLowerCase();
  // → "main:telegram:user-123"
}
```

**Por que isso importa:**
- Session keys persistem através de restarts
- Mesmo usuário = mesma sessão = contexto preservado
- Case-insensitive para evitar duplicatas

#### Use Cases

```yaml
# Exemplo 1: Rota DM específico para agente "work"
bindings:
  "alice@telegram":
    agent: work

# Exemplo 2: Rota servidor Discord inteiro para agente "gaming"
bindings:
  "123456789@discord":
    agent: gaming

# Exemplo 3: Fallback para agente default
bindings:
  default:
    agent: main
```

---

## 🎯 Subsistemas Principais

### 1. Memory System com Hybrid Search ⭐⭐⭐⭐⭐

**Localização**: `src/memory/`

Sistema de memória persistente com busca híbrida (semantic + keyword).

#### Arquitetura

```
Memory Storage
├── Source Files (Markdown)
│   ├── ~/clawd/MEMORY.md           # Long-term curated
│   └── ~/clawd/memory/
│       ├── 2026-01-26.md           # Daily logs
│       ├── 2026-01-25.md
│       └── ...
│
└── Index Database (SQLite)
    └── ~/.clawdbot/memory/
        ├── main.sqlite             # Vector index para agent "main"
        └── work.sqlite             # Vector index para agent "work"
```

#### Two-Layer Memory System

**Layer 1: Daily Logs** (`memory/YYYY-MM-DD.md`)
- Append-only logs do dia
- Agent escreve quando quer lembrar algo
- Estrutura livre (Markdown)

```markdown
# 2026-01-26

## 10:30 AM - API Discussion
Discussed REST vs GraphQL with user. Decision: use REST for simplicity.
Key endpoints: /users, /auth, /projects.

## 2:15 PM - Deployment
Deployed v2.3.0 to production. No issues.

## 4:00 PM - User Preference
User mentioned they prefer TypeScript over JavaScript.
```

**Layer 2: Long-term Memory** (`MEMORY.md`)
- Conhecimento curado e persistente
- Decisões importantes, preferências, aprendizados
- Estruturado para busca rápida

```markdown
# Long-term Memory

## User Preferences
- Prefers TypeScript over JavaScript
- Likes concise explanations
- Working on project "Acme Dashboard"

## Important Decisions
- 2026-01-15: Chose PostgreSQL for database
- 2026-01-20: Adopted REST over GraphQL
- 2026-01-26: Using Tailwind CSS for styling

## Key Contacts
- Alice (alice@acme.com) - Design lead
- Bob (bob@acme.com) - Backend engineer
```

#### Indexing Pipeline

```
[1] File Saved
    ~/clawd/memory/2026-01-26.md
        ↓
[2] File Watcher (Chokidar)
    Debounced 1.5s para batch writes
        ↓
[3] Chunking
    Split em ~400 token chunks
    80 token overlap (preserva contexto)
        ↓
[4] Embedding
    OpenAI/Gemini/Local → vectors (1536 dims)
        ↓
[5] Storage
    SQLite com sqlite-vec + FTS5
    ├─ chunks (id, path, lines, text, hash)
    ├─ chunks_vec (id, embedding) → sqlite-vec
    ├─ chunks_fts (text) → FTS5 full-text
    └─ embedding_cache (hash, vector) → dedupe
```

#### Hybrid Search ⭐⭐⭐⭐⭐

**O diferencial do sistema:**

```typescript
// Busca paralela em dois índices:

// 1. Vector Search (semântica)
vectorResults = sqliteVec.search(queryEmbedding, {
  limit: 20,
  metric: "cosine"
});

// 2. BM25 Search (keyword)
bm25Results = fts5.search(queryText, {
  limit: 20,
  rank: "bm25"
});

// 3. Combine com weighted scoring
finalScore = (0.7 * vectorScore) + (0.3 * bm25Score);

// 4. Filter por threshold
results = results.filter(r => r.score >= 0.35);
```

**Por que 70/30?**
- Semantic é primário (captura significado)
- BM25 pega exatos (nomes, IDs, datas)
- Juntos = melhor recall

**Por que 0.35 threshold?**
- Remove ruído (matches fracos)
- Mantém precision alta
- Configurável via config

#### Memory Tools

**1. memory_search**: Busca semântica

```typescript
{
  name: "memory_search",
  description: "Search MEMORY.md + memory/*.md semantically",
  parameters: {
    query: "What did we decide about the API?",
    maxResults: 6,
    minScore: 0.35
  }
}

// Response:
{
  results: [
    {
      path: "memory/2026-01-20.md",
      startLine: 45,
      endLine: 52,
      score: 0.87,
      snippet: "## API Discussion\nDecided to use REST...",
      source: "memory"
    }
  ],
  provider: "openai",
  model: "text-embedding-3-small"
}
```

**2. memory_get**: Read específico

```typescript
{
  name: "memory_get",
  description: "Read specific lines after memory_search",
  parameters: {
    path: "memory/2026-01-20.md",
    from: 45,
    lines: 15
  }
}

// Response:
{
  path: "memory/2026-01-20.md",
  text: "## API Discussion\n\nMet with team...\n..."
}
```

#### Multi-Agent Memory Isolation

```
State Directory (indexes):
~/.clawdbot/memory/
├── main.sqlite              # Agent "main"
└── work.sqlite              # Agent "work"

Workspaces (source files):
~/clawd/                     # Agent "main"
├── MEMORY.md
└── memory/

~/clawd-work/                # Agent "work"
├── MEMORY.md
└── memory/
```

**Isolation**:
- Cada agent tem workspace próprio
- Indexes separados (não há cross-search)
- Soft sandbox (working directory, não chroot)
- Agent pode ler outro workspace com paths absolutos

---

### 2. Session Compaction & Memory Flush ⭐⭐⭐⭐⭐

**Localização**: `src/agents/pi-embedded-runner/compaction.ts`

Sistema inteligente para lidar com overflow de contexto.

#### O Problema

```
Context Window: 200K tokens
Current Context: 180K tokens (90%)
    ↓
Próxima mensagem: +30K tokens
    ↓
Total: 210K tokens → OVERFLOW! ❌
```

#### A Solução: Two-Phase Approach

**Phase 1: Memory Flush** (Preventivo)

```
Context: 75% full (150K/200K)
    ↓
Soft Threshold Crossed!
    ↓
[Silent Memory Flush Turn]
    System: "Pre-compaction memory flush.
             Store durable memories now.
             Reply NO_REPLY when done."
    ↓
Agent: reviews conversation
       writes important facts to memory/YYYY-MM-DD.md
       → NO_REPLY (user não vê nada!)
    ↓
Important info now safe on disk ✅
```

**Phase 2: Compaction** (Quando necessário)

```
Context: 95% full (190K/200K)
    ↓
[Automatic Compaction]
    ↓
Summarize turns 1-140 → compact summary
Keep turns 141-150 → recent context intact
    ↓
Context: 45K/200K tokens ✅
    ↓
Original request retried com contexto compactado
```

#### Compaction Flow

```
BEFORE:
[Turn 1] User: "Let's build an API"
[Turn 2] Agent: "Sure! What endpoints?"
[Turn 3] User: "Users and auth"
[Turn 4] Agent: *creates 500-line schema*
[Turn 5] User: "Add rate limiting"
[Turn 6] Agent: *modifies code*
... (100 more turns) ...
[Turn 150] User: "What's the status?"

Context: 180,000 tokens ⚠️

        ↓ COMPACTION ↓

AFTER:
[SUMMARY] "Built REST API with /users, /auth.
           Implemented JWT auth, rate limiting.
           PostgreSQL database. Deployed v2.4.0.
           Current: production prep."

[Turn 141-150 preserved as-is]

Context: 45,000 tokens ✅
```

#### Configuration

```yaml
agents:
  defaults:
    compaction:
      reserveTokensFloor: 20000      # Reserve para resposta

      memoryFlush:
        enabled: true
        softThresholdTokens: 4000    # Quando disparar flush
        systemPrompt: "Session nearing compaction..."
        prompt: "Write to memory/YYYY-MM-DD.md; reply NO_REPLY"
```

#### Por Que Isso é Genial

1. **Memory Flush Preventivo**:
   - Salva info importante ANTES da compaction
   - Compaction é lossy, mas info já está no disco
   - Silencioso (user não vê)

2. **Compaction Automático**:
   - User nunca vê erro de overflow
   - Sessão continua funcionando
   - Request original é retriado

3. **Preserva Contexto Recente**:
   - Últimos N turns mantidos intactos
   - Summary tem overview geral
   - Melhor de ambos os mundos

---

### 3. Context Pruning ⭐⭐⭐⭐

**Localização**: `src/agents/pi-embedded-runner/pruning.ts`

Sistema para reduzir size de tool results antigos sem reescrever história.

#### O Problema

```
Tool Result (exec): [50,000 chars de npm install logs]
Tool Result (read): [Config file 10,000 chars]
Tool Result (exec): [Build logs 30,000 chars]
User: "Did the build succeed?"

Context: 100,000+ tokens só de tool results! 💸
```

#### Estratégias de Pruning

**1. Soft Trim**: Mantém início + fim

```typescript
softTrim: {
  maxChars: 4000,
  headChars: 1500,      // Keep first 1500 chars
  tailChars: 1500       // Keep last 1500 chars
}

// BEFORE:
"npm WARN deprecated ... [45,000 chars] ... Successfully installed."

// AFTER:
"npm WARN deprecated ... [truncated] ... Successfully installed."
```

**2. Hard Clear**: Remove completamente

```typescript
hardClear: {
  enabled: true,
  placeholder: "[Old tool result content cleared]"
}

// BEFORE:
Tool Result: [Large config file 10,000 chars]

// AFTER:
Tool Result: "[Old tool result content cleared]"
```

#### Cache-TTL Pruning Mode ⭐⭐⭐⭐

**O problema**: Anthropic cacheia prompt prefixes por 5 minutos:
- Cache hit: ~90% mais barato
- Cache miss: full "cache write" pricing

**A solução**: Prune após cache TTL expira

```typescript
contextPruning: {
  mode: "cache-ttl",           // Só prune após TTL
  ttl: 600,                     // 10 min (match cacheControlTtl)
  keepLastAssistants: 3,        // Protege N últimos turns

  softTrim: { ... },
  hardClear: { ... }
}
```

**Flow**:
```
Request 1 at t=0   → Cache MISS → Write cache (full price)
Request 2 at t=60  → Cache HIT  → Cheap! 💰
Request 3 at t=120 → Cache HIT  → Cheap! 💰
...
Request N at t=700 → Cache EXPIRED (TTL=600s)
    ↓
Prune old tool results antes do request
    ↓
Smaller prompt = cheaper re-cache ✅
```

---

### 4. Hooks System ⭐⭐⭐

**Localização**: `src/hooks/`

Sistema extensível de callbacks para lifecycle events.

#### Hook Types

```typescript
type HookType =
  | "bundled"    // Shipped com Moltbot
  | "npm"        // External package
  | "git";       // Git repository
```

#### Hook Events

```typescript
// Command lifecycle
"command:new"           // /new command
"command:exec"          // Command execution

// Session lifecycle
"session:start"         // Session começou
"session:end"           // Session terminou
"session:memory"        // Memory hook (save context)

// Message lifecycle
"message:received"      // Mensagem recebida
"message:sent"          // Mensagem enviada

// Agent lifecycle
"agent:start"           // Agent iniciando
"agent:end"             // Agent terminou
"agent:error"           // Agent erro

// System lifecycle
"gateway:start"         // Gateway iniciou
"gateway:stop"          // Gateway parou
```

#### Hook Structure

**Markdown file** com YAML frontmatter:

```markdown
---
id: session-memory-hook
type: bundled
events:
  - session:memory
handler: ./handlers/session-memory.js
requirements:
  platform: ["darwin", "linux"]
  binaries: ["jq"]
  config: ["agent.sessionMemory.enabled"]
---

# Session Memory Hook

Saves conversation context when session ends.

## Behavior

1. Extract last N messages
2. Generate descriptive slug
3. Save to memory/YYYY-MM-DD-slug.md
```

**Handler module**:

```typescript
// handlers/session-memory.js
export default async function handler(context) {
  const { session, messages, agentId } = context;

  // Extract context
  const lastMessages = messages.slice(-15);

  // Generate slug
  const slug = await generateSlug(lastMessages);

  // Save to memory
  const filename = `memory/${date}-${slug}.md`;
  await writeFile(filename, formatMessages(lastMessages));

  return { saved: filename };
}
```

#### Eligibility Tracking

```typescript
// Hook só executa se requirements atendidos:
requirements: {
  platform: ["darwin", "linux"],     // OS check
  binaries: ["jq", "ffmpeg"],        // Binary check
  env: ["OPENAI_API_KEY"],           // Env var check
  config: ["hooks.enabled"]          // Config check
}
```

---

### 5. Canvas Host ⭐⭐⭐⭐

**Localização**: `src/canvas-host/`

Sistema de rendering visual interativo para mobile apps.

#### Arquitetura

```
Canvas Host Server
├── HTTP Server (static files)
├── WebSocket Server (live reload)
├── File Watcher (chokidar)
└── A2UI Bridge (iOS/Android)
```

#### Features

**1. Live Reload**

```typescript
// Watch workspace/canvas/
chokidar.watch("workspace/canvas/**/*", {
  ignored: /(^|[\/\\])\../,
  persistent: true
}).on("change", debounce((path) => {
  // Broadcast reload to all connected clients
  broadcast({ type: "reload", path });
}, 75)); // 75ms debounce
```

**2. Safe Path Traversal**

```typescript
// fs-safe.js
function safeReadFile(requestPath, baseDir) {
  const normalized = path.normalize(requestPath);
  const resolved = path.resolve(baseDir, normalized);

  // Reject symlinks
  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink()) {
    throw new Error("Symlinks not allowed");
  }

  // Ensure within baseDir
  if (!resolved.startsWith(baseDir)) {
    throw new Error("Path traversal detected");
  }

  return fs.readFileSync(resolved);
}
```

**3. A2UI Bridge**

JavaScript bridge para iOS/Android:

```javascript
// iOS (WebKit)
window.webkit.messageHandlers.moltbotCanvasA2UIAction.postMessage({
  action: "navigate",
  url: "/dashboard"
});

// Android (Custom Bridge)
window.AndroidBridge.executeAction(JSON.stringify({
  action: "navigate",
  url: "/dashboard"
}));

// Listen for responses
window.addEventListener("moltbot:a2ui:response", (event) => {
  console.log("Response:", event.detail);
});
```

**4. MIME Type Detection**

```typescript
import { fileTypeFromBuffer } from "file-type";

async function detectMimeType(buffer) {
  const type = await fileTypeFromBuffer(buffer);
  return type?.mime || "application/octet-stream";
}
```

#### Canvas Tools

Agent pode controlar canvas via tools:

```typescript
// Push new content
canvas.push({
  html: "<div>Hello World</div>",
  css: "div { color: blue; }",
  js: "console.log('loaded');"
});

// Reset canvas
canvas.reset();

// Take snapshot
const screenshot = await canvas.snapshot();

// Eval JavaScript
const result = await canvas.eval("document.title");
```

---

### 6. Cron Service ⭐⭐⭐

**Localização**: `src/cron/`, `src/gateway/server-cron.ts`

Sistema de tarefas agendadas usando croner library.

#### Features

```typescript
interface CronJob {
  id: string;
  expression: string;        // Cron expression
  agentId: string;           // Qual agent executar
  message: string;           // Mensagem para agent
  enabled: boolean;
  timezone?: string;

  // Metadata
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
}
```

#### Cron Expression Examples

```bash
"0 9 * * *"           # Daily at 9 AM
"*/15 * * * *"        # Every 15 minutes
"0 */2 * * *"         # Every 2 hours
"0 9 * * 1"           # Every Monday at 9 AM
"0 0 1 * *"           # First day of month
```

#### Execution Flow

```
Cron Trigger
    ↓
Create Isolated Session
    ↓
Execute Agent with message
    ↓
Log result (success/error)
    ↓
Update job metadata (lastRun, runCount)
    ↓
Schedule next run
```

#### Configuration

```yaml
cron:
  enabled: true
  jobs:
    - id: daily-standup
      expression: "0 9 * * 1-5"
      agentId: work
      message: "Generate daily standup report"
      timezone: America/New_York

    - id: backup
      expression: "0 2 * * *"
      agentId: main
      message: "Run backup routine"
```

---

## 🎨 Padrões Arquiteturais Únicos

### 1. Global Singleton via Symbol.for() ⭐⭐⭐⭐

**Problema**: Plugin registry precisa ser singleton global, mas evitar poluição do `global` namespace.

**Solução**:

```typescript
// src/plugins/runtime.ts
const REGISTRY_STATE = Symbol.for("moltbot.pluginRegistryState");

if (!global[REGISTRY_STATE]) {
  global[REGISTRY_STATE] = {
    plugins: new Map(),
    channels: new Set(),
    initialized: false
  };
}

export const registry = global[REGISTRY_STATE];
```

**Por que Symbol.for()?**
- Cria símbolo global compartilhado
- Mesmo símbolo em múltiplos imports
- Não polui namespace (não é string)
- Type-safe

---

### 2. Two-Phase Normalization ⭐⭐⭐⭐

**Problema**: Normalizar channel IDs requer plugin registry, mas registry causa circular dependencies.

**Solução**: Split em duas fases

```typescript
// Phase 1: Light (sem registry)
export function normalizeChatChannelId(channel: string): string {
  return channel.toLowerCase().trim();
}

// Phase 2: Heavy (com registry)
export function normalizeAnyChannelId(channel: string): string {
  const light = normalizeChatChannelId(channel);

  // Consulta registry para aliases
  const plugin = registry.getPlugin(light);
  if (plugin?.meta.aliases) {
    return plugin.meta.aliases[0];
  }

  return light;
}
```

**Quando usar**:
- Routing inicial: Phase 1 (fast, no deps)
- Display/logging: Phase 2 (accurate, com aliases)

---

### 3. Request/Response Correlation ⭐⭐⭐⭐

**Problema**: WebSocket é bidirectional - como correlacionar responses com requests?

**Solução**: UUID-based correlation

```typescript
// Client side
const requestId = uuid();
const promise = new Promise((resolve, reject) => {
  pendingRequests.set(requestId, { resolve, reject });

  // Timeout após 30s
  setTimeout(() => {
    pendingRequests.delete(requestId);
    reject(new Error("Request timeout"));
  }, 30000);
});

ws.send(JSON.stringify({
  id: requestId,
  method: "agent.send",
  params: { message: "Hello" }
}));

return promise;

// Server side
ws.on("message", (data) => {
  const request = JSON.parse(data);

  const result = await handleRequest(request);

  ws.send(JSON.stringify({
    id: request.id,    // Same ID!
    ok: true,
    payload: result
  }));
});

// Client receives response
ws.on("message", (data) => {
  const response = JSON.parse(data);

  const pending = pendingRequests.get(response.id);
  if (pending) {
    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      pending.reject(new Error(response.error.message));
    }
    pendingRequests.delete(response.id);
  }
});
```

---

### 4. Tick-Based Health Monitoring ⭐⭐⭐⭐

**Problema**: Como detectar conexões WebSocket mortas/stalled?

**Solução**: Server envia ticks periódicos

```typescript
// Server: enviar tick a cada 30s
setInterval(() => {
  broadcast({
    event: "tick",
    data: {
      timestamp: Date.now(),
      sequence: tickSequence++
    }
  });
}, 30000);

// Client: monitorar gaps
let lastTickTime = Date.now();
let lastTickSequence = 0;

ws.on("message", (data) => {
  const msg = JSON.parse(data);

  if (msg.event === "tick") {
    const now = Date.now();
    const gap = now - lastTickTime;
    const seqGap = msg.data.sequence - lastTickSequence;

    // Detectar stall
    if (gap > 45000) { // 45s sem tick
      console.error("Connection stalled, reconnecting...");
      reconnect();
    }

    // Detectar missing ticks
    if (seqGap > 1) {
      console.warn(`Missed ${seqGap - 1} ticks`);
    }

    lastTickTime = now;
    lastTickSequence = msg.data.sequence;
  }
});
```

---

### 5. Dependency Injection via createDefaultDeps() ⭐⭐⭐

**Localização**: `src/cli/deps.ts`

**Problema**: Muitos services precisam ser compartilhados (sessionManager, configManager, etc.)

**Solução**: Factory function que cria todos os deps

```typescript
export function createDefaultDeps(): Dependencies {
  const configManager = new ConfigManager();
  const sessionManager = new SessionManager();
  const authManager = new AuthManager();

  return {
    // Core services
    configManager,
    sessionManager,
    authManager,
    gaService: new GoogleAnalyticsService(),
    webhookService: new WebhookService(),

    // Channel services
    telegramService: new TelegramService({ configManager }),
    discordService: new DiscordService({ configManager }),

    // Tool services
    browserService: new BrowserService(),
    canvasService: new CanvasService(),

    // Infra services
    loggerService: new LoggerService(),
    metricService: new MetricService(),

    // ... 20+ services
  };
}

// Usage em CLI commands
const deps = createDefaultDeps();
await startGateway(deps);
```

**Benefits**:
- Single source of truth
- Easy testing (mock deps)
- Clear dependencies
- Type-safe

---

### 6. Dedup Map Pattern ⭐⭐⭐

**Problema**: Múltiplos requests simultâneos para mesmo chat (e.g., spam)

**Solução**: Dedup map com Promise sharing

```typescript
const runningChats = new Map<string, Promise<void>>();

async function handleChatMessage(sessionKey: string, message: string) {
  // Check if já está rodando
  if (runningChats.has(sessionKey)) {
    console.log("Chat já em progresso, aguardando...");
    await runningChats.get(sessionKey);
    return;
  }

  // Create promise e armazena
  const promise = (async () => {
    try {
      await executeChatRun(sessionKey, message);
    } finally {
      runningChats.delete(sessionKey);
    }
  })();

  runningChats.set(sessionKey, promise);
  await promise;
}
```

---

## 🚀 Otimizações de Performance

### 1. Embedding Batching ⭐⭐⭐⭐

**Localização**: `src/memory/batch-openai.ts`, `src/memory/batch-gemini.ts`

**Problema**: Embeddings são caros - cada request tem overhead

**Solução**: Batch API

```typescript
// Collect requests
const batch: string[] = [];
const promises: Promise<number[]>[] = [];

function requestEmbedding(text: string): Promise<number[]> {
  return new Promise((resolve) => {
    const index = batch.length;
    batch.push(text);
    promises[index] = resolve;

    // Flush after 100ms idle
    scheduleBatchFlush();
  });
}

async function flushBatch() {
  if (batch.length === 0) return;

  const texts = [...batch];
  const resolvers = [...promises];

  batch.length = 0;
  promises.length = 0;

  // Single batch request
  const embeddings = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts  // All at once!
  });

  // Resolve individual promises
  embeddings.data.forEach((emb, i) => {
    resolvers[i](emb.embedding);
  });
}
```

**Savings**:
- 100 individual requests: ~10s + 100 API calls
- 1 batch request: ~1s + 1 API call
- **10x faster + 10x cheaper!**

---

### 2. Debounced File Watching ⭐⭐⭐

**Problema**: Salvar arquivo causa re-index, que causa write, que causa re-index... (loop!)

**Solução**: Debounce com trailing edge

```typescript
import { debounce } from "lodash-es";

const reindex = debounce(async (path: string) => {
  console.log("Reindexing:", path);
  await indexFile(path);
}, 1500, { trailing: true });

chokidar.watch("memory/**/*.md").on("change", (path) => {
  reindex(path);
});

// Multiple rapid saves → single reindex
// Write at t=0    → schedule reindex at t=1500
// Write at t=100  → reschedule to t=1600
// Write at t=200  → reschedule to t=1700
// ...idle...
// Execute at t=1700 ✅
```

---

### 3. Health Cache with Versioning ⭐⭐⭐

**Problema**: Health snapshots são caros (query all services)

**Solução**: Cache com version-based invalidation

```typescript
let healthCache: HealthSnapshot | null = null;
let healthVersion = 0;

function invalidateHealth() {
  healthVersion++;
  healthCache = null;
}

async function getHealth(): Promise<HealthSnapshot> {
  const currentVersion = healthVersion;

  if (healthCache && healthCache.version === currentVersion) {
    return healthCache; // Cache hit!
  }

  // Compute fresh
  const health = await computeHealthSnapshot();
  health.version = currentVersion;

  healthCache = health;
  return health;
}

// Invalidate on state changes
gateway.on("channel:connected", invalidateHealth);
gateway.on("channel:disconnected", invalidateHealth);
gateway.on("config:changed", invalidateHealth);
```

---

### 4. Session Lane Queuing ⭐⭐⭐⭐⭐

Já descrito acima, mas vale repetir pois é crítico:

```typescript
// Prevents thundering herd
const sessionQueues = new Map<string, Queue>();
const globalQueue = new Queue({ concurrency: 10 });

async function enqueueSession(key: string, fn: () => Promise<void>) {
  if (!sessionQueues.has(key)) {
    sessionQueues.set(key, new Queue({ concurrency: 1 }));
  }

  return sessionQueues.get(key).add(() =>
    globalQueue.add(fn)
  );
}
```

**Result**:
- Sem queues: 1000 requests simultâneos → crash
- Com session queue: 1000 users × 1 concurrent = OK
- Com global queue: 10 concurrent total = stable
- Com both: fairness + stability ✅

---

### 5. Atomic Batch Memory Indexing ⭐⭐⭐

**Problema**: Re-indexar muitos files é lento e pode falhar no meio

**Solução**: Atomic transaction

```typescript
async function reindexAll(files: string[]) {
  const db = openDatabase();

  await db.transaction(async (tx) => {
    // Clear old chunks
    await tx.run("DELETE FROM chunks WHERE path IN (?)",
                 files.join(","));

    // Insert new chunks (batch)
    const chunks = await Promise.all(
      files.map(f => chunkFile(f))
    ).then(results => results.flat());

    await tx.batchInsert("chunks", chunks);

    // Generate embeddings (batch)
    const embeddings = await batchEmbed(
      chunks.map(c => c.text)
    );

    // Insert vectors (batch)
    await tx.batchInsert("chunks_vec", embeddings);
  });

  // All or nothing ✅
}
```

---

## 🔌 Pontos de Extensão

### 1. Channel Plugins

```typescript
// extensions/my-channel/index.ts
export const plugin: ChannelPlugin = {
  id: "my-channel",

  capabilities: {
    messaging: true,
    auth: true,
    group: false
  },

  handlers: {
    poll: async (context) => {
      // Poll for messages
      const messages = await fetchMessages();
      return messages.map(normalizeMessage);
    },

    send: async (context, message) => {
      // Send message
      await sendMessage(message);
    }
  },

  gatewayMethods: (ctx) => [
    {
      method: "my-channel.custom-action",
      handler: async (params) => {
        // Custom gateway method
        return await doCustomAction(params);
      }
    }
  ]
};
```

---

### 2. Tool Plugins

```typescript
// tools/my-tool.ts
export const tool = {
  name: "my_tool",
  description: "Does something useful",

  parameters: {
    type: "object",
    properties: {
      input: { type: "string" }
    }
  },

  execute: async (params, context) => {
    const result = await doWork(params.input);
    return { result };
  }
};

// Register
registry.registerTool(tool);
```

---

### 3. Hook Plugins

```markdown
---
id: my-hook
type: bundled
events: [message:received]
handler: ./my-handler.js
---

# My Hook

Custom hook that does X when message received.
```

```typescript
// my-handler.js
export default async function handler(context) {
  const { message, channel } = context;

  // Do something
  console.log("Message received:", message);

  return { processed: true };
}
```

---

### 4. Memory Providers

```typescript
// memory/providers/my-provider.ts
export const provider: EmbeddingProvider = {
  name: "my-provider",

  embed: async (texts: string[]) => {
    // Generate embeddings
    const embeddings = await myAPI.embed(texts);
    return embeddings;
  },

  dimensions: 1536
};

// Register
registry.registerMemoryProvider(provider);
```

---

### 5. Custom Gateway Methods

```typescript
// plugins/my-plugin/gateway-methods.ts
export function createGatewayMethods(context): GatewayMethod[] {
  return [
    {
      method: "my-plugin.action",
      handler: async (params) => {
        // Custom RPC method
        return await performAction(params);
      }
    }
  ];
}
```

---

## 🤔 Decisões Arquiteturais Interessantes

### 1. Por Que WebSocket Over REST?

**Escolha**: Gateway usa WebSocket, não REST API

**Razões**:
1. **Bidirectional**: Server pode push eventos (ticks, presence)
2. **Stateful**: Connection mantém estado (authed, subscriptions)
3. **Efficient**: Menos overhead que HTTP polling
4. **Real-time**: Latência baixa para updates
5. **Natural RPC**: Request/response pattern com correlation

**Trade-offs**:
- ❌ Mais complexo que REST
- ❌ Requer connection management
- ✅ Melhor performance
- ✅ Melhor UX (real-time)

---

### 2. Por Que Markdown para Memory?

**Escolha**: Memory é plain Markdown, não JSON/DB proprietário

**Razões**:
1. **Human-readable**: Você pode ler e editar
2. **Version control**: Git-friendly
3. **Transparent**: No black box
4. **Portable**: Funciona com qualquer editor
5. **Searchable**: Grep, ack, ripgrep funcionam

**Trade-offs**:
- ❌ Precisa parsing (frontmatter, sections)
- ❌ Menos structured que JSON
- ✅ Melhor DX (developer experience)
- ✅ Ownership (user owns data)

---

### 3. Por Que Session Compaction Instead of Rejection?

**Escolha**: Auto-compact sessões grandes, não rejeitar

**Razões**:
1. **Better UX**: Sessão continua funcionando
2. **Transparent**: User nem percebe
3. **Preserves context**: Summary + recent messages
4. **Handles edge cases**: Long conversations work

**Trade-offs**:
- ❌ Compaction é lossy (info perdida)
- ❌ Mais complexo que reject
- ✅ Melhor UX
- ✅ Memory flush mitiga loss

---

### 4. Por Que Binding Hierarchy?

**Escolha**: Multi-level bindings (peer > guild > channel > default)

**Razões**:
1. **Granular control**: Rota DM específico
2. **Flexible**: Casos de uso variados
3. **No combinatorial explosion**: Não precisa config para cada combinação
4. **Natural fallback**: Hierarchy óbvia

**Trade-offs**:
- ❌ Mais complexo que single-level
- ❌ User precisa entender precedência
- ✅ Muito mais flexível
- ✅ Cobre todos os casos de uso

---

### 5. Por Que Lane-Based Concurrency?

**Escolha**: Nested queues (session + global)

**Razões**:
1. **Fairness**: Cada user tem chance igual
2. **Stability**: Global limit previne overload
3. **Simple**: Fácil de entender e debugar
4. **Effective**: Resolve thundering herd

**Trade-offs**:
- ❌ Adiciona latência (queuing)
- ❌ Precisa tuning (concurrency limits)
- ✅ Previne crashes
- ✅ Melhor throughput real

---

### 6. Por Que Hybrid Search (Vector + BM25)?

**Escolha**: Combinar semantic + keyword search

**Razões**:
1. **Best of both**: Semantic pega significado, BM25 pega exatos
2. **Better recall**: Menos misses
3. **Better precision**: Weighted scoring filtra ruído
4. **Handles variety**: "that database thing" + "POSTGRES_URL"

**Trade-offs**:
- ❌ Mais complexo que single search
- ❌ Dois índices para manter
- ✅ Muito melhor accuracy
- ✅ Cobre mais casos de uso

---

## 🛠️ Stack Técnico Completo

### Backend

**Runtime**
- Node.js 22+ (LTS)
- TypeScript (ESM, strict mode)
- Bun (dev TS execution)

**Package Management**
- pnpm (primary)
- npm (supported)
- bun (supported)

**WebSocket**
- ws (WebSocket server)
- Custom protocol with validation

**Database**
- SQLite (primary storage)
- sqlite-vec (vector search)
- FTS5 (full-text search)

**Testing**
- Vitest (test runner)
- V8 coverage (70% threshold)
- Playwright (e2e, browser)

**Linting/Formatting**
- Oxlint (ultra-fast)
- Oxfmt (formatting)
- prek (pre-commit hooks)

---

### AI/ML

**LLM Providers**
- Anthropic Claude (primary)
- OpenAI GPT (secondary)
- Google Gemini (alternative)

**Embeddings**
- OpenAI text-embedding-3-small
- Google Gemini embeddings
- node-llama (local)

**Vector Search**
- sqlite-vec (SQLite extension)
- Cosine similarity

**Keyword Search**
- SQLite FTS5
- BM25 ranking

---

### Messaging Platforms

**Core Integrations**
- grammY (Telegram Bot API)
- Baileys (WhatsApp Web)
- discord.js (Discord Bot)
- @slack/bolt (Slack Socket Mode)
- signal-cli (Signal bridge)

**Extensions**
- BlueBubbles, LINE, Matrix
- Mattermost, MS Teams
- Zalo, Nextcloud Talk

---

### Mobile

**iOS**
- Swift 5.9+
- SwiftUI (Observation framework)
- WebKit (Canvas host)

**Android**
- Kotlin 1.9+
- Jetpack Compose
- WebView (Canvas host)

**macOS**
- Swift 5.9+
- SwiftUI
- AppKit (menubar)

---

### Web

**Frontend**
- Vanilla JS (no framework)
- Web Components (Lit-inspired)
- WebSocket client

**Backend**
- Express.js (HTTP server)
- ws (WebSocket server)
- chokidar (file watching)

---

### DevOps

**CI/CD**
- GitHub Actions
- Docker (multi-stage builds)
- Nix (declarative config)

**Monitoring**
- Structured logging (pino)
- Diagnostic events
- Health endpoints

---

## 📂 Estrutura de Arquivos Detalhada

```
moltbot/
├── src/
│   ├── gateway/                 # Control plane (WebSocket)
│   │   ├── server.impl.ts      # Gateway server
│   │   ├── client.ts           # Gateway client
│   │   ├── protocol/           # RPC protocol
│   │   └── server-*.ts         # Services (cron, canvas, etc.)
│   │
│   ├── agents/                  # Agent runtime
│   │   ├── pi-embedded-runner/ # Execution engine
│   │   │   ├── run.ts          # Run manager (700+ LOC)
│   │   │   ├── compaction.ts   # Session compaction
│   │   │   ├── pruning.ts      # Context pruning
│   │   │   └── failover.ts     # Auth failover
│   │   └── pi-protocol/        # Agent protocol
│   │
│   ├── channels/                # Channel integrations
│   │   ├── telegram/           # Telegram (grammY)
│   │   ├── discord/            # Discord (discord.js)
│   │   ├── slack/              # Slack (Bolt)
│   │   └── web/                # WhatsApp Web (Baileys)
│   │
│   ├── routing/                 # Message routing
│   │   ├── bindings.ts         # Binding resolution
│   │   ├── normalize.ts        # ID normalization
│   │   └── session-key.ts      # Session key generation
│   │
│   ├── memory/                  # Memory system
│   │   ├── manager.ts          # Memory manager
│   │   ├── hybrid.ts           # Hybrid search
│   │   ├── batch-openai.ts     # Embedding batching
│   │   └── sqlite-vec.ts       # Vector storage
│   │
│   ├── hooks/                   # Lifecycle hooks
│   │   ├── manager.ts          # Hook manager
│   │   ├── loader.ts           # Hook loader
│   │   └── bundled/            # Bundled hooks
│   │
│   ├── canvas-host/             # Visual workspace
│   │   ├── server.ts           # HTTP + WebSocket
│   │   ├── fs-safe.ts          # Safe file access
│   │   └── a2ui/               # A2UI bridge
│   │
│   ├── cron/                    # Scheduled tasks
│   │   ├── manager.ts          # Cron manager
│   │   └── executor.ts         # Job executor
│   │
│   ├── security/                # Security layer
│   │   ├── allowlist.ts        # Allowlist resolution
│   │   ├── gating.ts           # Permission gating
│   │   └── approval.ts         # Approval workflow
│   │
│   ├── cli/                     # CLI commands
│   │   ├── deps.ts             # Dependency injection
│   │   ├── progress.ts         # Progress indicators
│   │   └── palette.ts          # Color palette
│   │
│   ├── commands/                # CLI command handlers
│   │   ├── agent.ts            # Agent commands
│   │   ├── gateway.ts          # Gateway commands
│   │   └── onboard.ts          # Onboarding wizard
│   │
│   ├── tui/                     # Terminal UI
│   │   ├── components/         # UI components
│   │   └── theme.ts            # Theme system
│   │
│   ├── logging/                 # Structured logging
│   │   ├── subsystems.ts       # Subsystem loggers
│   │   └── transport.ts        # Log transport
│   │
│   ├── infra/                   # Infrastructure
│   │   ├── config/             # Configuration
│   │   ├── session/            # Session management
│   │   └── auth/               # Authentication
│   │
│   └── media/                   # Media pipeline
│       ├── images.ts           # Image processing
│       ├── audio.ts            # Audio handling
│       └── video.ts            # Video handling
│
├── extensions/                  # Plugin channels
│   ├── msteams/                # MS Teams
│   ├── matrix/                 # Matrix
│   ├── zalo/                   # Zalo
│   └── voice-call/             # Voice calls
│
├── apps/                        # Mobile apps
│   ├── macos/                  # Mac menubar app
│   │   └── Sources/Moltbot/    # Swift code
│   ├── ios/                    # iOS node app
│   │   └── Sources/            # Swift code
│   └── android/                # Android node app
│       └── app/src/            # Kotlin code
│
├── docs/                        # Documentation (Mintlify)
│   ├── channels/               # Channel guides
│   ├── gateway/                # Gateway docs
│   ├── concepts/               # Core concepts
│   └── platforms/              # Platform guides
│
├── scripts/                     # Build/dev scripts
│   ├── committer               # Scoped git commits
│   ├── package-mac-app.sh      # Mac app builder
│   └── clawlog.sh              # macOS log viewer
│
└── article/                     # Technical articles
    ├── memory.md               # Memory system deep-dive
    └── architecture-deep-dive.md  # This file!
```

---

## 🎓 Conclusão

O Moltbot é um projeto **arquiteturalmente sofisticado** que combina:

### Pontos Fortes

1. **WebSocket-based Control Plane** ✅
   - Real-time, bidirectional, efficient
   - Protocol versioning e validation
   - Health monitoring com ticks

2. **Lane-Based Concurrency** ✅
   - Fairness entre usuários
   - Proteção contra overload
   - Simple yet effective

3. **Plugin Architecture** ✅
   - Extensível (channels, tools, hooks)
   - Registry singleton pattern
   - Two-phase normalization

4. **Hybrid Memory Search** ✅
   - Vector + BM25 combinados
   - Markdown-based (transparent)
   - Multi-agent isolation

5. **Session Management** ✅
   - Auto-compaction (não rejeita)
   - Memory flush (previne loss)
   - Context pruning (otimiza cache)

6. **Routing System** ✅
   - Multi-level bindings
   - Precedence hierarchy
   - Flexible use cases

7. **Resilience** ✅
   - Auth profile failover
   - Auto-recovery
   - Error handling

### Aprendizados

Este projeto demonstra **excelência em**:

- **Distributed Systems**: WebSocket control plane, node registry
- **Concurrency Control**: Lane-based queuing, dedup maps
- **Memory Management**: Compaction, pruning, hybrid search
- **Plugin Architecture**: Registry pattern, lazy loading
- **Developer Experience**: Markdown storage, hot-reload, CLI
- **Performance**: Batching, caching, debouncing
- **Security**: TLS fingerprinting, allowlists, gating

---

**Autor**: Análise arquitetural via engenharia reversa
**Data**: 2026-01-28
**Versão**: 1.0
