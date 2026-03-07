# Akashic Context

Open-source library for adding persistent memory and context management to AI agents.

**Reference**: Architecture based on [Moltbot](https://github.com/moltbot/moltbot) memory system.

## Project Status

```
Phase 1: Memory Search      ✅ COMPLETE (MCP + n8n working)
Phase 1.5-n8n: Quick Wins   ✅ COMPLETE (2026-02-06)
                            - memory_store/delete tools ✅
                            - 20 unit tests (100%) ✅
                            - 3 n8n workflows ✅
                            - Architecture docs ✅
Phase 1.5-QA: Tests & Bugs  ✅ COMPLETE (2026-02-06)
                            - 2 bugs fixed (sync orphans, force reindex) ✅
                            - Integration tests (15 tests) ✅
                            - QA scenarios (17 assertions) ✅
                            - 140 total tests passing ✅
Sprint 0: Multi-User        🎯 NEXT (userId isolation — CRITICAL GAP)
Phase 1.5: Vector Search    📋 AFTER SPRINT 0 (sqlite-vec, hybrid merge)
Phase 2: Context Management 🚧 PLANNED
Phase 3: Session Lifecycle  📋 FUTURE
```

**Current Focus**: Sprint 0 — Multi-User Isolation (userId per tool call)

### ⚠️ CRITICAL ARCHITECTURAL GAP: Multi-User Isolation

**Problema descoberto**: O sistema atual não tem isolamento por usuário.
Todas as chamadas MCP compartilham o mesmo workspace e banco de dados.

**Exemplo do problema**:
```
WhatsApp Bot com 100 usuários
→ Todos escrevem no MESMO memory/
→ Usuário A busca e encontra dados do Usuário B
→ Zero privacidade, zero isolamento
```

**Solução planejada (Sprint 0)**:
```
ANTES:  memory_search({ query: "projetos" })
DEPOIS: memory_search({ query: "projetos", userId: "user_123" })

Estrutura de dados:
{dataDir}/
├── users/
│   ├── user_123/
│   │   ├── memory.db          ← DB isolado
│   │   ├── MEMORY.md
│   │   └── memory/*.md
│   ├── user_456/
│   │   ├── memory.db
│   │   ├── MEMORY.md
│   │   └── memory/*.md
│   └── ...
└── shared/                    ← (futuro) memória compartilhada
```

**Impacto**: Todas as 4 MCP tools precisam receber `userId`:
- `memory_search({ query, userId, ... })`
- `memory_get({ path, userId })`
- `memory_store({ path, content, userId })`
- `memory_delete({ path, userId })`

## Next Steps (Hybrid Approach - n8n Focus)

**Strategy**: Multi-user isolation → Vector search quality → Context management → Cloud deployment

**Context**: Multi-user isolation é PRÉ-REQUISITO para qualquer uso em produção (WhatsApp, chatbots, etc).

### Sprint 0: Multi-User Isolation 🎯 NEXT

**Objetivo**: Cada usuário tem seu próprio espaço de memória isolado.

**Tarefas**:

1. **userId em todas as MCP tools**
   - Arquivo: `packages/mcp-server/src/index.ts`
   - Adicionar parâmetro `userId` (string) em memory_search, memory_get, memory_store, memory_delete
   - Se `userId` não fornecido → usar `"default"` (backward compatible)

2. **Per-user workspace**
   - Arquivo: `packages/core/src/memory/manager.ts`
   - Workspace muda de `{dataDir}/` para `{dataDir}/users/{userId}/`
   - Cada userId tem seu próprio MEMORY.md e memory/*.md

3. **Per-user database**
   - Arquivo: `packages/core/src/memory/storage.ts`
   - DB muda de `{dataDir}/memory.db` para `{dataDir}/users/{userId}/memory.db`
   - Total isolamento — zero vazamento entre usuários

4. **Testes de isolamento**
   - User A armazena → User B não encontra
   - User A deleta → User B não é afetado
   - Default user funciona sem userId (backward compatible)

5. **n8n Workflow com userId**
   - WhatsApp webhook → extrair phone number como userId
   - Passar userId em todas as chamadas MCP
   - Exemplo: `memory_search({ query: "...", userId: "5511999999999" })`

6. **Working Memory (scratchpad JSON por usuário)**
   - Inspirado em: [memclawz QMD](https://github.com/yoniassia/memclawz) — scratchpad JSON que persiste entre sessões
   - Arquivo: `packages/core/src/memory/working-memory.ts`
   - Cada usuário tem `{dataDir}/users/{userId}/context.json` com estado ativo:
     ```json
     {
       "session_id": "whatsapp-2026-03-01",
       "active_topic": "Negociação contrato X",
       "last_interaction": "2026-03-01T22:00:00Z",
       "pending_decisions": ["Aprovar proposta?"],
       "entities_seen": ["Empresa ABC", "João Silva"],
       "updated_at": "2026-03-01T22:30:00Z"
     }
     ```
   - Nova MCP tool: `memory_context` (read/write do scratchpad ativo)
   - Camada 0 — lida ANTES de qualquer busca (<1ms)
   - Agente lê context.json no início → tem contexto instantâneo sem busca

**Entregáveis**:
- [ ] userId em todas as 4 MCP tools
- [ ] Per-user workspace e database
- [ ] Working Memory (context.json por usuário)
- [ ] MCP tool `memory_context` (get/set working memory)
- [ ] Testes de isolamento (mínimo 10 tests)
- [ ] Backward compatible (sem userId = "default")
- [ ] Exemplo de workflow n8n com WhatsApp

---

### Fase 1: Quick Wins n8n ✅ COMPLETA (2026-02-06)

**Objetivo**: Tornar n8n integration production-ready

**Tarefas Implementadas**:

1. ✅ **memory_store tool**
   - Arquivo: `packages/mcp-server/src/index.ts`
   - Implementado: `handleMemoryStore(path, content)`
   - Features: Criar/atualizar arquivos `.md`, auto-create directories
   - Segurança: Path traversal protection, file type validation, 10MB limit
   - Testes: 8 unit tests (100% coverage)

2. ✅ **memory_delete tool**
   - Arquivo: `packages/mcp-server/src/index.ts`
   - Implementado: `handleMemoryDelete(path)`
   - Features: Deletar arquivos obsoletos, proteger MEMORY.md
   - Segurança: Path traversal protection, MEMORY.md protection
   - Testes: 5 unit tests (100% coverage)

3. ✅ **Workflows n8n completos**
   - Básico: `examples/n8n-chatbot-basic.json` (search only)
   - Completo: `examples/n8n-chatbot-complete.json` (search + store)
   - Avançado: `examples/n8n-chatbot-advanced.json` (full CRUD)
   - Documentação: `examples/README.md`

4. ✅ **Testes e documentação**
   - Unit tests: `packages/mcp-server/src/index.test.ts` (20 tests, 100% coverage)
   - Integration tests: Reorganizados em `tests/integration/`
   - Arquitetura: `docs/ARCHITECTURE.md`
   - Guia de testes: `docs/TESTING-LOCAL.md`

**Entregáveis**:
- ✅ MCP server com 4 tools: search, get, store, delete
- ✅ 20 unit tests (100% coverage) - Vitest
- ✅ 3 workflows n8n (basic, complete, advanced)
- ✅ Documentação completa (4 novos docs)
- ✅ Arquitetura padronizada seguindo packages/core

---

### Fase 1.5-QA: Bug Fixes & Testing ✅ COMPLETA (2026-02-06)

**Objetivo**: Corrigir bugs e criar testes de integração + QA

**Bugs corrigidos**:

1. ✅ **sync() não removia chunks de arquivos deletados**
   - Arquivo: `packages/core/src/memory/storage.ts` + `manager.ts`
   - Problema: `sync()` indexava arquivos existentes mas nunca removia chunks de deletados
   - Fix: Adicionado `getAllFilePaths()` ao storage, sync agora compara indexados vs disco

2. ✅ **memory_store/delete não reindexava**
   - Arquivo: `packages/mcp-server/src/index.ts`
   - Problema: `handleMemoryStore` e `handleMemoryDelete` chamavam `sync()` sem `force: true`
   - Fix: Alterado para `sync({ force: true })` para garantir reindexação

**Testes criados**:

3. ✅ **Integration tests** — `packages/mcp-server/src/integration.test.ts`
   - 15 testes end-to-end cobrindo 7 fluxos
   - Store → Search → encontra resultado
   - Update → Search → encontra atualizado
   - Delete → Search → não encontra mais
   - Segurança (path traversal, tipos inválidos)

4. ✅ **QA scenarios** — `packages/mcp-server/src/qa-scenarios.ts`
   - 4 cenários reais de usuário (assistente pessoal, suporte, notas diárias, multilingual)
   - 17 assertions

**Entregáveis**:
- ✅ 2 bugs corrigidos
- ✅ 15 integration tests (100% passing)
- ✅ 17 QA assertions (100% passing)
- ✅ 140 total tests no projeto

---

### Fase 2: Vector Search (2-3 semanas) 🚀 APÓS SPRINT 0

**Objetivo**: Melhorar qualidade da busca (Phase 1.5 oficial)

**Tarefas**:

1. **sqlite-vec Extension**
   - Carregar extensão `vec0.dylib`
   - Criar tabela virtual `chunks_vec`
   - Dimensões: 1536 (text-embedding-3-small)

2. **Vector Search**
   - Implementar busca por cosine similarity
   - Query: `vec_distance_cosine(embedding, ?)`
   - Retornar top-K resultados semânticos

3. **Hybrid Merge Algorithm**
   - Mesclar resultados: 70% vector + 30% keyword
   - Função: `mergeHybridResults()`
   - Deduplicate por chunk ID

4. **Embedding Batch API**
   - OpenAI Batch API (50% mais barato)
   - Workflow: Upload JSONL → Submit batch → Poll → Download
   - Implementar: `batch-openai.ts`

5. **Multi-User Isolation** ✅ Movido para Sprint 0
   - DB separado por usuário: `{dataDir}/users/{userId}/memory.db`
   - Isolar memórias entre diferentes usuários
   - Backward compatible: sem userId = user "default"

**Entregáveis**:
- ✅ Busca semântica funcionando
- ✅ Hybrid search (melhor qualidade)
- ✅ Economia de 50% em embeddings
- ✅ Testes matemáticos validados

---

### Fase 3: Cloud Ready (1 semana) ☁️ DEPLOY

**Objetivo**: Preparar para n8n cloud e produção

**Tarefas**:

1. **HTTP Adapter**
   - REST API para MCP tools
   - Endpoints: `/search`, `/store`, `/get`, `/delete`
   - Auth: API key

2. **Deploy para cloud**
   - Opções: Railway, Fly.io, Render
   - Postgres ou SQLite remoto
   - Environment variables

3. **Testes em n8n cloud**
   - Configurar HTTP webhook
   - Validar performance
   - Documentar limitações

**Entregáveis**:
- ✅ HTTP API funcionando
- ✅ Deploy em cloud provider
- ✅ Documentação de deploy
- ✅ n8n cloud testado

---

### Critérios de Sucesso

**Fase 1 (Quick Wins)** ✅ COMPLETA:
- [x] memory_store implementado e testado (8 unit tests)
- [x] memory_delete implementado e testado (5 unit tests)
- [x] Workflow n8n completo funcionando (3 workflows)
- [x] 3 casos de uso documentados (examples/README.md)
- [x] Testes locais validados (20 tests passing)
- [x] Arquitetura padronizada (docs/ARCHITECTURE.md)

**Fase 2 (Vector Search)**:
- [ ] sqlite-vec carregando corretamente
- [ ] Busca vetorial retorna resultados relevantes
- [ ] Hybrid merge > 80% de precisão
- [ ] Batch API economizando 50%

**Fase 3 (Cloud)**:
- [ ] API HTTP respondendo < 500ms
- [ ] Deploy funcionando 24/7
- [ ] n8n cloud conectado
- [ ] Documentação completa

---

## Project Structure

```
packages/
├── core/                    # Core library
│   └── src/
│       ├── memory/          # Memory system
│       │   ├── chunking.ts  # Markdown chunking (~400 tokens, 80 overlap)
│       │   ├── hybrid.ts    # Hybrid search (BM25 + Vector)
│       │   ├── storage.ts   # SQLite + FTS5 + embedding_cache
│       │   ├── manager.ts   # Memory Manager
│       │   └── providers/   # Embedding providers
│       │       ├── index.ts
│       │       └── openai.ts
│       ├── utils/           # Utilities (hash, tokens, files)
│       ├── types.ts         # Core type definitions
│       └── index.ts         # Main exports
│
└── mcp-server/              # MCP Server adapter
    └── src/
        ├── index.ts         # MCP Server implementation
        └── cli.ts           # CLI entry point
```

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test             # Run tests (Vitest)
pnpm test -- --run    # Run tests without watch mode
```

## Complete Roadmap (Based on Moltbot)

### Phase 1: Memory Search ✅ CURRENT

| Feature | Status | File | Moltbot Reference |
|---------|--------|------|-------------------|
| Memory Storage | ✅ | `storage.ts` | MEMORY.md + memory/*.md |
| Markdown Chunking | ✅ | `chunking.ts` | ~400 tokens, 80 overlap |
| SQLite + FTS5 | ✅ | `storage.ts` | Keyword indexing |
| BM25 Search | ✅ | `hybrid.ts` | `bm25(chunks_fts)` |
| Embedding Cache | ✅ | `storage.ts` | Hash-based deduplication |
| File Watcher | ✅ | `manager.ts` | Chokidar (5s debounce) |
| MCP Server | ✅ | `mcp-server/` | memory_search, memory_get |
| OpenAI Provider | ✅ | `providers/openai.ts` | text-embedding-3-small |

### Phase 1.5: Memory Foundation 📋 NEXT

| Feature | Status | Description | Moltbot Reference |
|---------|--------|-------------|-------------------|
| **Multi-User Isolation** | 🎯 Sprint 0 | userId per tool, per-user DB/workspace | `{userId}.sqlite` |
| sqlite-vec Extension | 📋 | Load vector extension | `chunks_vec` table |
| Vector Search | 📋 | Cosine similarity | `vec_distance_cosine()` |
| Hybrid Merge | 📋 | 70% vec + 30% keyword | `mergeHybridResults()` |
| Embedding Batch API | 📋 | OpenAI Batch (50% cheaper) | `batch-openai.ts` |

### Phase 2: Context Management 🚧 PLANNED

| Feature | Status | Description | Reference |
|---------|--------|-------------|-------------------|
| Token Counting | 📋 | Measure context usage | Moltbot: `estimateTokensForMessages()` |
| Context Window Guard | 📋 | Warn/block thresholds | Moltbot: `context-window-guard.ts` |
| Memory Flush | 📋 | Save before compaction | Moltbot: `memory-flush.ts` |
| Compaction | 📋 | Summarize old turns | Moltbot: `compact.ts` |
| **Auto-Compaction** | 📋 | **Tasks concluídas → daily log → MEMORY.md** | **memclawz: `qmd-compact.py`** |
| Soft Trim Pruning | 📋 | Keep head + tail | Moltbot: `pruner.ts` |
| Hard Clear Pruning | 📋 | Replace with placeholder | Moltbot: `pruner.ts` |

### Phase 3: Session Lifecycle 📋 FUTURE

| Feature | Status | Description | Moltbot Reference |
|---------|--------|-------------|-------------------|
| Session Management | 📋 | Reset rules (daily, manual) | `session-manager.ts` |
| Session Transcripts | 📋 | JSONL storage | `sessions/*.jsonl` |
| Session Memory Hook | 📋 | Auto-save on /new | `session-memory-hook.ts` |
| Cache-TTL Pruning | 📋 | Anthropic cache optimization | `cache-ttl.ts` |
| Lane-Based Queuing | 📋 | Prevent deadlocks | `enqueueCommandInLane()` |
| HTTP Adapter | 📋 | Cloud n8n support | REST API |

---

## Phase 1.5 Implementation Details

### Vector Search (sqlite-vec)

```typescript
// Load extension
db.loadExtension('/path/to/vec0.dylib');

// Create virtual table
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]  // 1536 dims for text-embedding-3-small
);

// Search query
SELECT
  c.id, c.path, c.text,
  (1 - vec_distance_cosine(v.embedding, ?)) AS score
FROM chunks c
JOIN chunks_vec v ON c.id = v.id
ORDER BY score DESC
LIMIT ?;
```

### Hybrid Merge Algorithm

```typescript
function mergeHybridResults(params: {
  vector: VectorResult[];      // Semantic results
  keyword: KeywordResult[];    // BM25 results
  vectorWeight: number;        // 0.7 (default)
  textWeight: number;          // 0.3 (default)
}): MergedResult[] {
  const byId = new Map();

  // Merge vector results
  for (const r of params.vector) {
    byId.set(r.id, { vectorScore: r.score, textScore: 0, ...r });
  }

  // Merge keyword results (dedupe by ID)
  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.score;
    } else {
      byId.set(r.id, { vectorScore: 0, textScore: r.score, ...r });
    }
  }

  // Weighted scoring
  return Array.from(byId.values())
    .map(item => ({
      ...item,
      finalScore: params.vectorWeight * item.vectorScore +
                  params.textWeight * item.textScore
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
}
```

### Embedding Batch API

```typescript
// OpenAI Batch API (50% cheaper)
async embedChunksViaBatchAPI(chunks: Chunk[]): Promise<number[][]> {
  // 1. Build JSONL requests
  const requests = chunks.map((chunk, i) => ({
    custom_id: hash(chunk.text),
    method: "POST",
    url: "/v1/embeddings",
    body: { model: "text-embedding-3-small", input: chunk.text }
  }));

  // 2. Upload JSONL file
  const file = await openai.files.create({
    file: new Blob([requests.map(r => JSON.stringify(r)).join("\n")]),
    purpose: "batch"
  });

  // 3. Submit batch
  const batch = await openai.batches.create({
    input_file_id: file.id,
    endpoint: "/v1/embeddings",
    completion_window: "24h"
  });

  // 4. Poll for completion
  while (batch.status !== "completed") {
    await sleep(2000);
    batch = await openai.batches.retrieve(batch.id);
  }

  // 5. Download and parse results
  const output = await openai.files.content(batch.output_file_id);
  return parseEmbeddings(output);
}
```

---

## Phase 2 Implementation Details

### Token Counting

```typescript
interface TokenMetrics {
  contextWindow: number;      // e.g., 200000 (Claude)
  currentUsage: number;       // Tokens used now
  reserveTokens: number;      // e.g., 20000 (for response)
  softThreshold: number;      // Trigger for memory flush
  hardThreshold: number;      // Trigger for compaction
}

// Thresholds (Moltbot defaults)
const softThreshold = contextWindow - reserveTokens - 4000;  // 176K
const hardThreshold = contextWindow * 0.95;                   // 190K
```

### Memory Flush (Pre-Compaction Safety)

```typescript
// When to trigger
function shouldRunMemoryFlush(params: {
  totalTokens: number;
  contextWindow: number;      // 200000
  reserveTokens: number;      // 20000
  softThreshold: number;      // 4000
}): boolean {
  const threshold = params.contextWindow - params.reserveTokens - params.softThreshold;
  // 200000 - 20000 - 4000 = 176000
  return params.totalTokens > threshold;
}

// Prompt
const MEMORY_FLUSH_PROMPT = `
Pre-compaction memory flush.
Store durable memories now (use memory/YYYY-MM-DD.md).
If nothing to store, reply with __SILENT__.
`;
```

### Compaction

```typescript
interface CompactionConfig {
  enabled: boolean;
  reserveTokensFloor: number;  // 20000
  keepLastTurns: number;       // 10
}

// Result
interface CompactionResult {
  summary: string;           // LLM-generated summary
  tokensBefore: number;      // 182000
  tokensAfter: number;       // 55000
  compressionRatio: number;  // 0.30 (70% savings)
}
```

### Auto-Compaction (inspirado em memclawz)

Lógica de compactação automática do working memory:

```typescript
// Ref: https://github.com/yoniassia/memclawz (scripts/qmd-compact.py)
//
// Fluxo de compactação:
// 1. context.json (working memory) → tasks concluídas movem para daily log
// 2. Daily logs antigos → resumidos e arquivados no MEMORY.md
// 3. context.json mantém apenas tasks ativas

interface AutoCompactionConfig {
  enabled: boolean;
  archiveCompletedAfterHours: number;  // 24h — move completed to daily log
  summarizeDailyLogsAfterDays: number; // 7d — summarize old daily logs
  maxActiveItems: number;              // 10 — max items in context.json
}

function autoCompact(userId: string, config: AutoCompactionConfig): CompactionResult {
  // 1. Read context.json
  // 2. Move completed items → memory/YYYY-MM-DD.md
  // 3. Summarize old daily logs → append to MEMORY.md
  // 4. Save cleaned context.json with active items only
}
```

### Context Pruning

```typescript
interface PruningConfig {
  mode: 'always' | 'cache-ttl';
  keepLastAssistants: number;   // 3 (protect recent turns)

  softTrim: {                   // Context > 30%
    maxChars: number;           // 4000
    headChars: number;          // 1500
    tailChars: number;          // 1500
  };

  hardClear: {                  // Context > 50%
    enabled: boolean;
    placeholder: string;        // "[Old tool result cleared]"
  };

  minPrunableToolChars: number; // 50000
}

// Two-pass algorithm
function pruneContext(messages, config): Message[] {
  // Pass 1: Soft trim (context > 30%)
  // Keep head (1500) + tail (1500) of large tool results

  // Pass 2: Hard clear (context > 50%)
  // Replace old tool results with placeholder
}
```

---

## Phase 3 Implementation Details

### Session Lifecycle

```typescript
type SessionResetMode =
  | 'daily'     // Reset at midnight
  | 'manual'    // Reset on /new command
  | 'never';    // Never reset (continuous)

interface SessionConfig {
  resetMode: SessionResetMode;
  maxIdleMinutes: number;      // 30
  maxTurns: number;            // 500
}
```

### Cache-TTL Pruning (Anthropic Optimization)

```typescript
// Anthropic prompt caching:
// - Cache TTL: 5 minutes
// - Cache hit: 10% cost
// - Cache miss: 100% cost (re-cache)

interface CacheTtlConfig {
  enabled: boolean;
  ttlMs: number;              // 300000 (5 min)
}

// Before each request
if (Date.now() - lastCacheTouchAt > ttlMs) {
  // TTL expired → prune to invalidate cache
  // Smaller context = cheaper re-cache
  pruneContext(messages, config);
  lastCacheTouchAt = Date.now();
}
```

---

## Mathematical Tests Required

### Phase 1.5 Tests

1. **Vector search accuracy**
   - Input: query embedding
   - Expected: top-K results by cosine similarity
   - Validate: score = 1 - cosine_distance

2. **Hybrid merge correctness**
   - Input: vector results + keyword results
   - Expected: merged by ID, weighted scoring
   - Validate: finalScore = 0.7 * vec + 0.3 * keyword

3. **Batch API cost savings**
   - Input: 1000 chunks
   - Expected: 50% cheaper than individual calls
   - Validate: API cost comparison

### Phase 2 Tests

1. **Token counting accuracy**
   - Input: conversation with N messages
   - Expected: correct token count
   - Validate: compare with tiktoken

2. **Memory flush trigger**
   - Input: context at 176K tokens
   - Expected: flush triggered
   - Validate: files saved in memory/

3. **Compaction effectiveness**
   - Input: 182K tokens
   - Expected: reduced to ~55K tokens
   - Validate: compression ratio ≥ 70%

4. **Pruning effectiveness**
   - Input: tool result with 50K chars
   - Expected: reduced to 4K chars (soft trim)
   - Validate: tokens saved

### Phase 3 Tests

1. **Cache-TTL optimization**
   - Input: requests at t=0, t=2min, t=6min
   - Expected: cache hit at t=2min, prune at t=6min
   - Validate: cost reduction

---

## Code Conventions

- **Language**: TypeScript ESM, strict mode
- **Runtime**: Node 18+
- **Files**: Keep under ~500 LOC when possible
- **Tests**: Colocated as `*.test.ts`
- **Imports**: Use `.js` extension (ESM)
- **Types**: Avoid `any`, prefer explicit types

---

## Troubleshooting

### "Could not locate the bindings file" (better-sqlite3)

```bash
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
npm run build-release
```

### Vector search not working

sqlite-vec extension not loaded. Currently only keyword search works.
Phase 1.5 will add: `db.loadExtension('/path/to/vec0.dylib')`

### Search returns 0 results

1. Check if MEMORY.md or memory/*.md files exist
2. Use `minScore: 0` to see all results
3. Delete database: `rm -f memory.db`

---

## Links

- **Repo**: https://github.com/tostechbr/akashic-context
- **Docs**: [README.md](./README.md)
- **Testing**: [docs/TESTING.md](./docs/TESTING.md)
- **MCP Protocol**: https://modelcontextprotocol.io
- **Moltbot Reference**: https://github.com/moltbot/moltbot
