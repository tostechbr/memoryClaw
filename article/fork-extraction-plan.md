# 🔀 Option D: Fork & Extraction Plan

> Plano detalhado para extrair Memory & Context systems do Moltbot e criar biblioteca standalone

## 🎯 Objetivo

Extrair código **battle-tested** do Moltbot e adaptar para criar `memory-context-engine`:
- 🧠 Memory System (hybrid search, indexing, embeddings)
- ⏱️ Context Manager (compaction, pruning, flush)
- 🔌 API standalone (desacoplada do gateway)

---

## 📋 Análise de Dependências

### Módulos a Extrair (Core)

| Módulo | Arquivos Source | Dependências | Prioridade |
|--------|----------------|--------------|------------|
| **Memory System** | `src/memory/` | SQLite, embeddings | ⭐⭐⭐⭐⭐ |
| **Context Manager** | `src/agents/pi-embedded-runner/` | Session storage | ⭐⭐⭐⭐⭐ |
| **Session Storage** | `src/infra/session/` | Filesystem | ⭐⭐⭐⭐ |
| **Config System** | `src/infra/config/` | Zod validation | ⭐⭐⭐ |
| **Token Counting** | Token estimation utils | tiktoken | ⭐⭐⭐ |

### Dependências Externas

**NPM Packages a Manter**:
```json
{
  "better-sqlite3": "^11.0.0",      // SQLite driver
  "sqlite-vec": "^0.1.0",           // Vector search
  "chokidar": "^4.0.0",             // File watching
  "tiktoken": "^1.0.0",             // Token counting
  "openai": "^4.0.0",               // Embeddings API
  "zod": "^3.0.0"                   // Schema validation
}
```

**Remover** (acopladas ao Moltbot):
- Gateway dependencies
- Channel plugins
- Canvas/A2UI
- Browser control
- Cron service

---

## 🏗️ Estrutura do Novo Projeto

```
memory-context-engine/
├── packages/
│   └── core/
│       ├── src/
│       │   ├── memory/              # Extracted from src/memory/
│       │   │   ├── manager.ts       # MemoryIndexManager
│       │   │   ├── hybrid.ts        # Hybrid search
│       │   │   ├── indexer.ts       # File indexing
│       │   │   ├── embeddings/
│       │   │   │   ├── base.ts      # Provider interface
│       │   │   │   ├── openai.ts    # OpenAI provider
│       │   │   │   └── batch.ts     # Batching logic
│       │   │   └── storage/
│       │   │       ├── sqlite.ts    # SQLite storage
│       │   │       └── markdown.ts  # Markdown files
│       │   │
│       │   ├── context/             # Extracted from src/agents/
│       │   │   ├── manager.ts       # ContextManager
│       │   │   ├── session.ts       # Session storage
│       │   │   ├── compaction.ts    # Compaction logic
│       │   │   ├── pruning.ts       # Context pruning
│       │   │   └── flush.ts         # Memory flush
│       │   │
│       │   ├── engine.ts            # Main API (NEW)
│       │   ├── config.ts            # Configuration
│       │   ├── types.ts             # TypeScript types
│       │   └── utils/
│       │       ├── tokens.ts        # Token estimation
│       │       ├── hash.ts          # Hashing utils
│       │       └── logger.ts        # Simple logger
│       │
│       ├── tests/
│       │   ├── memory.test.ts
│       │   ├── context.test.ts
│       │   └── integration.test.ts
│       │
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
│
├── examples/
│   ├── simple-chatbot/
│   ├── rag-system/
│   └── multi-user/
│
├── docs/
├── .github/
└── README.md
```

---

## 📂 Mapeamento de Arquivos

### Phase 1: Memory System

| Source (Moltbot) | Destination (Engine) | Adaptações Necessárias |
|------------------|----------------------|------------------------|
| `src/memory/manager.ts` | `src/memory/manager.ts` | ✅ Remover gateway deps |
| `src/memory/hybrid.ts` | `src/memory/hybrid.ts` | ✅ Keep as-is (standalone) |
| `src/memory/internal.ts` | `src/memory/indexer.ts` | ✅ Rename + cleanup |
| `src/memory/batch-openai.ts` | `src/memory/embeddings/openai.ts` | ✅ Extract batch logic |
| `src/memory/batch-gemini.ts` | `src/memory/embeddings/gemini.ts` | ✅ Extract batch logic |
| `src/memory/sqlite-vec.ts` | `src/memory/storage/sqlite.ts` | ✅ Simplify schema |

**Adaptações**:
```typescript
// BEFORE (Moltbot - acoplado ao config)
const settings = resolveMemorySearchConfig(cfg, agentId);

// AFTER (Engine - config direto)
const settings = config.memory;
```

### Phase 2: Context Manager

| Source (Moltbot) | Destination (Engine) | Adaptações Necessárias |
|------------------|----------------------|------------------------|
| `src/agents/pi-embedded-runner/compact.ts` | `src/context/compaction.ts` | ✅ Remove Pi-specific logic |
| `src/agents/pi-embedded-runner/pruning.ts` | `src/context/pruning.ts` | ✅ Keep algorithm |
| `src/auto-reply/reply/memory-flush.ts` | `src/context/flush.ts` | ✅ Simplify trigger logic |
| `src/infra/session/manager.ts` | `src/context/session.ts` | ✅ Remove gateway deps |
| `src/agents/context-window-guard.ts` | `src/context/window.ts` | ✅ Keep as-is |

**Adaptações**:
```typescript
// BEFORE (Moltbot - usa SessionManager complexo)
const sessionManager = SessionManager.open(params.sessionFile);
const session = sessionManager.getSession();

// AFTER (Engine - session storage simples)
const session = await loadSession(sessionId);
```

### Phase 3: Utils & Helpers

| Source (Moltbot) | Destination (Engine) | Adaptações Necessárias |
|------------------|----------------------|------------------------|
| Token estimation utils | `src/utils/tokens.ts` | ✅ Extract tiktoken logic |
| Hash utils | `src/utils/hash.ts` | ✅ SHA256 hashing |
| Config loader | `src/config.ts` | ✅ Simplified config |

---

## 🔧 Adaptações Necessárias

### 1. Remover Acoplamentos ao Gateway

**ANTES** (Moltbot):
```typescript
// src/memory/manager.ts
import { getStateDir } from "../infra/paths";
import { resolveMemorySearchConfig } from "../config/memory";

const dbPath = path.join(getStateDir(), "memory", `${agentId}.sqlite`);
const settings = resolveMemorySearchConfig(cfg, agentId);
```

**DEPOIS** (Engine):
```typescript
// src/memory/manager.ts
import path from "node:path";

const dbPath = path.join(config.dataDir, "memory", `${userId}.sqlite`);
const settings = config.memory;
```

### 2. Simplificar Session Manager

**ANTES** (Moltbot - complexo):
```typescript
// SessionManager com JSONL, custom entries, metadata, etc.
class SessionManager {
  appendCustomEntry(type: string, data: any) { ... }
  flushPendingToolResults() { ... }
  getEntries() { ... }
  // ... 20+ métodos
}
```

**DEPOIS** (Engine - simples):
```typescript
// Session storage básico
interface Session {
  id: string;
  userId: string;
  messages: Message[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    totalTokens: number;
    compactionCount: number;
  };
}

async function loadSession(id: string): Promise<Session>;
async function saveSession(session: Session): Promise<void>;
```

### 3. Config Simplificado

**ANTES** (Moltbot - config complexo com Zod):
```typescript
const config = await loadConfig(); // 100+ options
const memorySettings = resolveMemorySearchConfig(config, agentId);
const contextSettings = resolveAgentConfig(config, agentId);
```

**DEPOIS** (Engine - config simples):
```typescript
interface EngineConfig {
  userId: string;
  dataDir: string;

  memory: {
    enabled: boolean;
    provider: "openai" | "gemini" | "local";
    model: string;
    chunkSize: number;
    chunkOverlap: number;
  };

  context: {
    maxTokens: number;
    reserveTokens: number;
    compactionEnabled: boolean;
    pruningEnabled: boolean;
  };
}
```

### 4. Remover Lane Queuing (Opcional)

**ANTES** (Moltbot - lane-based concurrency):
```typescript
return enqueueSession(sessionKey, () =>
  enqueueGlobal(async () =>
    compactSession(params)
  )
);
```

**DEPOIS** (Engine - simples async):
```typescript
// Deixar concurrency control para o usuário
return await compactSession(params);
```

OU manter simplificado:
```typescript
// Simple mutex per session
const sessionLocks = new Map<string, Promise<void>>();

async function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  while (sessionLocks.has(sessionId)) {
    await sessionLocks.get(sessionId);
  }

  const promise = fn().finally(() => sessionLocks.delete(sessionId));
  sessionLocks.set(sessionId, promise);

  return promise;
}
```

---

## 🚀 Plano de Implementação

### **Week 1: Setup & Memory Extraction**

#### Day 1-2: Project Setup
```bash
# 1. Create repo
mkdir memory-context-engine
cd memory-context-engine
git init

# 2. Setup monorepo
pnpm init
pnpm add -D turbo typescript vitest

# 3. Create package structure
mkdir -p packages/core/src/{memory,context,utils}
mkdir -p examples tests docs
```

#### Day 3-4: Extract Memory System
```bash
# Copy files from Moltbot
cp ../moltbot/src/memory/manager.ts packages/core/src/memory/
cp ../moltbot/src/memory/hybrid.ts packages/core/src/memory/
cp ../moltbot/src/memory/internal.ts packages/core/src/memory/indexer.ts
cp ../moltbot/src/memory/batch-*.ts packages/core/src/memory/embeddings/

# Adapt files (remove gateway deps)
# ... manual editing
```

**Files to Extract**:
- ✅ `src/memory/manager.ts` → Memory index manager
- ✅ `src/memory/hybrid.ts` → Hybrid search
- ✅ `src/memory/internal.ts` → Chunking, indexing
- ✅ `src/memory/batch-openai.ts` → Batch embeddings
- ✅ `src/memory/sqlite-vec.ts` → SQLite storage

**Adaptations**:
1. Replace config resolution with direct config access
2. Remove gateway-specific paths
3. Simplify error handling
4. Add standalone tests

#### Day 5-7: Test Memory System
```typescript
// tests/memory.test.ts
import { MemoryManager } from "../src/memory/manager";

describe("Memory System", () => {
  it("should index markdown files", async () => {
    const memory = new MemoryManager({
      dataDir: "./test-data",
      userId: "test-user",
      provider: "openai",
      model: "text-embedding-3-small"
    });

    await memory.index();

    const results = await memory.search({
      query: "database decision",
      maxResults: 5
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0.5);
  });
});
```

---

### **Week 2: Context Manager Extraction**

#### Day 1-3: Extract Context Manager
```bash
# Copy files
cp ../moltbot/src/agents/pi-embedded-runner/compact.ts packages/core/src/context/compaction.ts
cp ../moltbot/src/agents/pi-embedded-runner/pruning.ts packages/core/src/context/pruning.ts
cp ../moltbot/src/auto-reply/reply/memory-flush.ts packages/core/src/context/flush.ts
```

**Files to Extract**:
- ✅ `src/agents/pi-embedded-runner/compact.ts`
- ✅ `src/agents/pi-embedded-runner/pruning.ts`
- ✅ `src/auto-reply/reply/memory-flush.ts`
- ✅ `src/agents/context-window-guard.ts`
- ✅ `src/infra/session/` (simplified)

**Adaptations**:
1. Remove Pi-specific logic (SDK calls)
2. Create simple LLM interface for compaction
3. Simplify session storage (just messages + metadata)
4. Extract token counting utils

#### Day 4-5: Session Storage
```typescript
// src/context/session.ts
export interface Session {
  id: string;
  userId: string;
  messages: Message[];
  metadata: SessionMetadata;
}

export async function loadSession(
  sessionId: string,
  dataDir: string
): Promise<Session> {
  const filePath = path.join(dataDir, "sessions", `${sessionId}.json`);
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

export async function saveSession(
  session: Session,
  dataDir: string
): Promise<void> {
  const filePath = path.join(dataDir, "sessions", `${session.id}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(session, null, 2));
}
```

#### Day 6-7: Test Context Manager
```typescript
// tests/context.test.ts
import { ContextManager } from "../src/context/manager";

describe("Context Manager", () => {
  it("should compact session when needed", async () => {
    const context = new ContextManager({
      sessionId: "test-session",
      dataDir: "./test-data",
      contextWindow: 10000,
      reserveTokens: 2000
    });

    // Add messages until compaction needed
    for (let i = 0; i < 100; i++) {
      await context.addMessage({
        role: i % 2 === 0 ? "user" : "assistant",
        content: "Test message ".repeat(100) // ~800 tokens
      });
    }

    const stats = context.getStats();
    expect(stats.compactionCount).toBeGreaterThan(0);
    expect(stats.totalTokens).toBeLessThan(10000);
  });
});
```

---

### **Week 3: Main Engine API**

#### Day 1-3: Create Engine Class
```typescript
// src/engine.ts
export class MemoryContextEngine {
  private memory: MemoryManager;
  private context: ContextManager;
  private config: EngineConfig;

  constructor(config: EngineConfig) {
    this.config = config;

    this.memory = new MemoryManager({
      dataDir: config.dataDir,
      userId: config.userId,
      ...config.memory
    });

    this.context = new ContextManager({
      sessionId: config.sessionId || "main",
      dataDir: config.dataDir,
      ...config.context
    });
  }

  async prepareContext(options?: {
    includeMemory?: boolean;
    memoryQuery?: string;
    maxMemories?: number;
  }): Promise<PreparedContext> {
    // 1. Get current session messages
    const messages = await this.context.getMessages({
      prune: this.config.context.pruningEnabled
    });

    // 2. Search memory if requested
    let relevantMemories = [];
    if (options?.includeMemory) {
      const query = options.memoryQuery ||
        this.extractQueryFromMessages(messages);

      relevantMemories = await this.memory.search({
        query,
        maxResults: options.maxMemories || 3
      });
    }

    // 3. Build system prompt with memories
    const systemPrompt = this.buildSystemPrompt(relevantMemories);

    // 4. Return prepared context
    return {
      messages,
      relevantMemories,
      systemPrompt,
      metadata: {
        totalTokens: this.context.getTotalTokens(),
        compacted: this.context.getStats().compactionCount > 0,
        memoriesFound: relevantMemories.length,
        pruned: this.context.getStats().pruned
      }
    };
  }

  async addMessage(message: Message): Promise<void> {
    // 1. Add to context
    await this.context.addMessage(message);

    // 2. Check if memory flush needed
    if (this.shouldFlushMemory()) {
      await this.flushMemory();
    }

    // 3. Check if compaction needed
    if (this.context.needsCompaction()) {
      await this.context.compact();
    }
  }

  async searchMemory(query: string, options?: SearchOptions) {
    return this.memory.search({ query, ...options });
  }

  async saveMemory(content: string, metadata?: any) {
    return this.memory.saveToDaily(content, metadata);
  }

  getStats() {
    return {
      session: this.context.getStats(),
      memory: this.memory.getStats()
    };
  }
}
```

#### Day 4-5: Integration Tests
```typescript
// tests/integration.test.ts
describe("MemoryContextEngine Integration", () => {
  it("should handle full conversation flow", async () => {
    const engine = new MemoryContextEngine({
      userId: "test-user",
      dataDir: "./test-data",
      memory: {
        enabled: true,
        provider: "openai",
        model: "text-embedding-3-small",
        chunkSize: 400,
        chunkOverlap: 80
      },
      context: {
        maxTokens: 10000,
        reserveTokens: 2000,
        compactionEnabled: true,
        pruningEnabled: true
      }
    });

    // User asks question
    await engine.addMessage({
      role: "user",
      content: "Let's build a REST API with PostgreSQL"
    });

    // Get context (with memory search)
    const context = await engine.prepareContext({
      includeMemory: true
    });

    // Simulate LLM response
    await engine.addMessage({
      role: "assistant",
      content: "Sure! I'll help you design the API..."
    });

    // Later: User asks about previous decision
    await engine.addMessage({
      role: "user",
      content: "What database did we choose?"
    });

    const context2 = await engine.prepareContext({
      includeMemory: true
    });

    // Should find "PostgreSQL" in memories
    expect(context2.relevantMemories.length).toBeGreaterThan(0);
    expect(
      context2.relevantMemories[0].content
    ).toContain("PostgreSQL");
  });
});
```

#### Day 6-7: Documentation
- API reference
- Getting started guide
- Configuration guide
- Migration from LangChain/LlamaIndex

---

### **Week 4: Examples & Polish**

#### Day 1-2: Simple Chatbot Example
```typescript
// examples/simple-chatbot/index.ts
import { MemoryContextEngine } from "memory-context-engine";
import OpenAI from "openai";

const engine = new MemoryContextEngine({
  userId: "user-1",
  dataDir: "./data"
});

const openai = new OpenAI();

async function chat(userMessage: string): Promise<string> {
  // Add user message
  await engine.addMessage({
    role: "user",
    content: userMessage
  });

  // Prepare context
  const context = await engine.prepareContext({
    includeMemory: true
  });

  // Call LLM
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: context.systemPrompt },
      ...context.messages
    ]
  });

  const reply = response.choices[0].message.content;

  // Save assistant response
  await engine.addMessage({
    role: "assistant",
    content: reply
  });

  return reply;
}

// Usage
const reply = await chat("Hello! What's the weather like?");
console.log(reply);
```

#### Day 3-4: RAG Example
```typescript
// examples/rag-system/index.ts
import { MemoryContextEngine } from "memory-context-engine";

const engine = new MemoryContextEngine({
  userId: "user-1",
  dataDir: "./data"
});

// Index documents
await engine.memory.indexDirectory("./docs");

// Query with memory
const context = await engine.prepareContext({
  includeMemory: true,
  memoryQuery: "How does authentication work?"
});

// context.relevantMemories contains relevant doc chunks
```

#### Day 5-6: Multi-User Example
```typescript
// examples/multi-user/index.ts
const engines = new Map<string, MemoryContextEngine>();

function getEngine(userId: string): MemoryContextEngine {
  if (!engines.has(userId)) {
    engines.set(userId, new MemoryContextEngine({
      userId,
      dataDir: `./data/${userId}`
    }));
  }
  return engines.get(userId)!;
}

// Each user has isolated memory + context
const user1Engine = getEngine("user-1");
const user2Engine = getEngine("user-2");
```

#### Day 7: Polish
- README with badges
- LICENSE (MIT)
- Contributing guide
- Code of conduct
- Issue templates

---

## ✅ Validation Checklist

### Memory System
- [ ] Markdown indexing works
- [ ] Chunking respects boundaries
- [ ] Embeddings generated correctly
- [ ] Vector search returns relevant results
- [ ] BM25 search returns relevant results
- [ ] Hybrid search combines scores correctly
- [ ] Cache works (no duplicate embeddings)
- [ ] Multi-user isolation works

### Context Manager
- [ ] Session storage works
- [ ] Token counting accurate
- [ ] Compaction triggers correctly
- [ ] Compaction reduces tokens (>60%)
- [ ] Memory flush saves to disk
- [ ] Pruning removes old tool results
- [ ] Context window guard blocks overflow

### Integration
- [ ] prepareContext() returns valid context
- [ ] addMessage() updates session
- [ ] searchMemory() finds relevant memories
- [ ] saveMemory() persists to disk
- [ ] getStats() returns accurate metrics
- [ ] Multi-turn conversations work
- [ ] Memory search finds previous context

### Examples
- [ ] Simple chatbot runs
- [ ] RAG system retrieves docs
- [ ] Multi-user isolation verified

---

## 📊 Success Metrics

### Functional
- ✅ All tests pass (>80% coverage)
- ✅ Examples run without errors
- ✅ Memory search accuracy >85%
- ✅ Compaction compression >60%

### Performance
- ✅ Search latency <200ms
- ✅ Indexing throughput >100 chunks/sec
- ✅ Memory overhead <100MB per user

### Developer Experience
- ✅ Setup time <5 minutes
- ✅ API calls <10 lines of code
- ✅ Clear error messages
- ✅ Comprehensive docs

---

## 🚦 Risk Mitigation

### Potential Issues

**1. Dependency Conflicts**
- **Risk**: Moltbot code depends on internal modules
- **Mitigation**: Identify all deps upfront, create adapters

**2. Breaking Changes**
- **Risk**: Adapting code breaks functionality
- **Mitigation**: Write tests BEFORE adapting, verify behavior

**3. Performance Regression**
- **Risk**: Simplified code is slower
- **Mitigation**: Benchmark against Moltbot, optimize hotspots

**4. API Complexity**
- **Risk**: API too complex for users
- **Mitigation**: User testing, iterate on API design

---

## 📝 File Extraction Order

### Priority 1 (Week 1)
```
src/memory/manager.ts          → Memory index manager
src/memory/hybrid.ts           → Hybrid search
src/memory/internal.ts         → Chunking/indexing
src/memory/batch-openai.ts     → Batch embeddings
src/memory/sqlite-vec.ts       → SQLite storage
```

### Priority 2 (Week 2)
```
src/agents/pi-embedded-runner/compact.ts    → Compaction
src/agents/pi-embedded-runner/pruning.ts    → Pruning
src/auto-reply/reply/memory-flush.ts        → Memory flush
src/agents/context-window-guard.ts          → Context guard
src/infra/session/                          → Session storage
```

### Priority 3 (Week 3)
```
Token estimation utils
Hash utils
Config loader (simplified)
Error handling
Logging
```

---

## 🎯 MVP Deliverables (4 Weeks)

### Week 1
- ✅ Memory System extracted & working
- ✅ Tests passing
- ✅ Basic documentation

### Week 2
- ✅ Context Manager extracted & working
- ✅ Integration tests passing
- ✅ Session storage working

### Week 3
- ✅ Engine API complete
- ✅ Full integration working
- ✅ End-to-end tests passing

### Week 4
- ✅ 3+ examples working
- ✅ Docs complete (API + guides)
- ✅ README polished
- ✅ Ready for v0.1.0 release! 🎉

---

## 🚀 Next Steps

### Immediate Actions:
1. **Create GitHub repo** (`memory-context-engine`)
2. **Setup project structure** (monorepo)
3. **Copy first batch of files** (memory system)
4. **Run initial tests** (verify extraction works)
5. **Iterate on adaptations** (remove gateway deps)

### First Command:
```bash
# Start extraction NOW!
cd /Users/tiago.santos/Documents/GitHub/
mkdir memory-context-engine
cd memory-context-engine
git init
pnpm init

# Copy files from Moltbot
mkdir -p packages/core/src/memory
cp ../moltbot/src/memory/manager.ts packages/core/src/memory/
cp ../moltbot/src/memory/hybrid.ts packages/core/src/memory/
cp ../moltbot/src/memory/internal.ts packages/core/src/memory/indexer.ts

# Start adapting!
code .
```

---

## ❓ Decisões a Tomar

### 1. **Compaction Strategy**
- **Option A**: Use LLM (requires API key setup)
- **Option B**: Simple truncation (no LLM needed)
- **Recomendação**: Start with B, add A as optional

### 2. **Session Storage Format**
- **Option A**: JSON (simple, human-readable)
- **Option B**: JSONL (append-only, efficient)
- **Recomendação**: A for MVP, B for optimization

### 3. **Config System**
- **Option A**: TypeScript config object (simple)
- **Option B**: Config file (YAML/JSON)
- **Recomendação**: A for MVP, B as optional

### 4. **Error Handling**
- **Option A**: Throw exceptions
- **Option B**: Return Result<T, E>
- **Recomendação**: A (standard JS pattern)

---

## 🎉 Ready to Start?

**Next Action**: Choose starting point

### Option 1: Eu faço a extração inicial (Recomendado!)
Eu crio o repo base, extraio os primeiros files, faço adaptações iniciais, e você continua a partir daí.

**Timeline**: 30-60 min para setup + primeira extração

### Option 2: Você faz do zero com meu guia
Você segue o plano passo-a-passo e eu te ajudo quando travar.

**Timeline**: 3-4 horas para primeira semana

---

**Qual opção você prefere?** 🚀
