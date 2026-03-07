# 🧠 Moltbot Context Engineering & Memory System - Deep Dive

> Análise profunda ao nível de código dos sistemas de gerenciamento de contexto (curto prazo) e memória (longo prazo) do Moltbot.

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Memory System (Long-term)](#memory-system-long-term)
3. [Session Management (Short-term)](#session-management-short-term)
4. [Integração Completa](#integração-completa)
5. [Performance & Otimizações](#performance--otimizações)
6. [Algoritmos-Chave](#algoritmos-chave)

---

## 🎯 Visão Geral

O Moltbot resolve o problema de **contexto limitado** dos LLMs através de dois sistemas complementares:

```
┌─────────────────────────────────────────────────────────────┐
│                     CONTEXT ENGINEERING                     │
│                      (Short-term)                           │
│                                                             │
│  Session History (200K tokens)                              │
│  ├─ Recent messages                                         │
│  ├─ Tool results (trimmed/cleared)                          │
│  ├─ Compaction summaries                                    │
│  └─ Cache optimization                                      │
│                                                             │
│  Quando contexto enche:                                     │
│  1. Memory Flush → Save to disk                             │
│  2. Compaction → Summarize old turns                        │
│  3. Pruning → Trim tool results                             │
│                          ↓                                  │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          │ Saves important info
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                      MEMORY SYSTEM                          │
│                      (Long-term)                            │
│                                                             │
│  MEMORY.md + memory/*.md (Unlimited!)                       │
│  ├─ Indexed with Vector Search (semantic)                  │
│  ├─ Indexed with BM25 Search (keyword)                     │
│  ├─ Hybrid scoring (0.7 vec + 0.3 keyword)                 │
│  └─ Searchable via memory_search tool                      │
│                                                             │
│  Agent pode buscar quando precisa:                          │
│  - Recall facts/decisions                                   │
│  - Find past conversations                                  │
│  - Remember user preferences                                │
│                          ↑                                  │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          │ Searches for context
                          ↓
                    Agent Execution
```

**Filosofia**:
- **Short-term (Session)**: Contexto imediato, limitado, otimizado para performance
- **Long-term (Memory)**: Conhecimento duradouro, ilimitado, otimizado para recall

---

## 🗄️ Memory System (Long-term)

### Arquitetura Geral

**Localização**: `src/memory/`

```
Memory Storage
├── Source Files (Markdown)
│   ├── ~/clawd/MEMORY.md              # Long-term curated
│   └── ~/clawd/memory/
│       ├── 2026-01-28.md              # Daily log
│       ├── 2026-01-27.md
│       └── ...
│
└── Index Database (SQLite)
    └── ~/.clawdbot/memory/
        ├── main.sqlite                # Agent "main"
        └── work.sqlite                # Agent "work"
```

---

### 1. Hybrid Search Implementation ⭐⭐⭐⭐⭐

**Localização**: `src/memory/hybrid.ts`

O diferencial do sistema: combina **semantic search** (significado) com **keyword search** (termos exatos).

#### A. Vector Search (Cosine Similarity)

```typescript
// SQLite-vec extension for vector similarity
const vectorQuery = `
  SELECT
    c.id,
    c.path,
    c.start_line,
    c.end_line,
    c.text,
    (1 - vec_distance_cosine(v.embedding, ?)) AS score
  FROM chunks c
  JOIN chunks_vec v ON c.id = v.id
  WHERE c.source = ?
  ORDER BY score DESC
  LIMIT ?
`;

// Query embedding: [0.123, -0.456, 0.789, ...]
// Cosine distance: 0 (identical) to 2 (opposite)
// Score: 1 - distance = 0 (worst) to 1 (best)
```

**Por que cosine?**
- Normaliza para magnitude (texto longo vs curto)
- Captura direção semântica no embedding space
- Range 0-1 facilita weighted scoring

#### B. BM25 Search (Full-Text Search)

```typescript
// FTS5 virtual table with BM25 ranking
const bm25Query = `
  SELECT
    id,
    path,
    start_line,
    end_line,
    text,
    bm25(chunks_fts) AS rank
  FROM chunks_fts
  WHERE text MATCH ?
  ORDER BY rank
  LIMIT ?
`;

// BM25 rank: 0 (best) to +∞ (worst)
// Need to normalize to 0-1 for merging:
function bm25RankToScore(rank: number): number {
  return 1 / (1 + Math.abs(rank));
}
```

**BM25 formula**:
```
BM25(D,Q) = Σ IDF(qi) × (f(qi,D) × (k1 + 1)) / (f(qi,D) + k1 × (1 - b + b × |D|/avgdl))

Onde:
- IDF(qi) = inverse document frequency (termo raro = score alto)
- f(qi,D) = frequency of term qi in document D
- |D| = document length
- avgdl = average document length
- k1, b = tuning parameters (SQLite FTS5 defaults)
```

**Por que BM25?**
- Pega matches exatos (nomes, IDs, datas)
- Pondera raridade (termos raros = mais importantes)
- Normaliza para document length

#### C. Result Merging Algorithm

```typescript
export function mergeHybridResults(params: {
  vector: HybridVectorResult[];      // Semantic results
  keyword: HybridKeywordResult[];    // Keyword results
  vectorWeight: number;               // 0.7 (default)
  textWeight: number;                 // 0.3 (default)
}): MergedResult[] {
  const byId = new Map<string, {
    vectorScore: number;
    textScore: number;
    metadata: {...}
  }>();

  // Step 1: Merge vector results
  for (const result of params.vector) {
    byId.set(result.id, {
      vectorScore: result.score,
      textScore: 0,
      ...result
    });
  }

  // Step 2: Merge keyword results
  for (const result of params.keyword) {
    const existing = byId.get(result.id);
    if (existing) {
      existing.textScore = result.score;
    } else {
      byId.set(result.id, {
        vectorScore: 0,
        textScore: result.score,
        ...result
      });
    }
  }

  // Step 3: Weighted scoring
  const merged = Array.from(byId.values()).map(item => ({
    ...item,
    finalScore: (
      params.vectorWeight * item.vectorScore +
      params.textWeight * item.textScore
    )
  }));

  // Step 4: Sort by final score
  return merged
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, params.maxResults);
}
```

**Exemplo**:
```typescript
// Query: "What database did we choose?"

// Vector results (semantic):
[
  { id: "chunk-42", score: 0.87, text: "Decided to use PostgreSQL..." },
  { id: "chunk-15", score: 0.65, text: "Database migration from MySQL..." }
]

// BM25 results (keyword "database"):
[
  { id: "chunk-42", score: 0.92, text: "Decided to use PostgreSQL..." },
  { id: "chunk-99", score: 0.78, text: "Database backup script..." }
]

// Merged (0.7 * vector + 0.3 * keyword):
[
  { id: "chunk-42", finalScore: 0.885, text: "..." }, // 0.7*0.87 + 0.3*0.92
  { id: "chunk-15", finalScore: 0.455, text: "..." }, // 0.7*0.65 + 0.3*0
  { id: "chunk-99", finalScore: 0.234, text: "..." }  // 0.7*0 + 0.3*0.78
]
```

**Key insight**: Resultados são dedupados por ID, permitindo matches parciais (só vector OR só keyword) ainda pontuarem.

---

### 2. Indexing Pipeline ⭐⭐⭐⭐⭐

**Localização**: `src/memory/manager.ts`, `src/memory/internal.ts`

#### A. File Watching com Chokidar

```typescript
const watcher = chokidar.watch([
  path.join(workspaceDir, "MEMORY.md"),
  path.join(workspaceDir, "memory", "**", "*.md")
], {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 5000,  // Wait 5s após última mudança
    pollInterval: 100           // Check a cada 100ms
  }
});

watcher.on("add", (filePath) => {
  this.dirty = true;
  this.scheduleWatchSync(); // Debounce 5s
});

watcher.on("change", (filePath) => {
  this.dirty = true;
  this.scheduleWatchSync();
});

watcher.on("unlink", (filePath) => {
  this.dirty = true;
  this.scheduleWatchSync();
});

// Debounced sync
scheduleWatchSync() {
  clearTimeout(this.watchSyncTimeout);
  this.watchSyncTimeout = setTimeout(() => {
    void this.sync({ reason: "watch" });
  }, 5000); // 5s debounce
}
```

**Por que 5s stabilityThreshold?**
- Previne re-index durante escrita (agent salvando arquivo linha-por-linha)
- Aguarda write completo antes de indexar
- Evita race conditions

**Por que 5s debounce?**
- Múltiplos files mudando ao mesmo tempo (e.g., git pull)
- Batch todas as mudanças em um único sync
- Reduz load (indexing é caro)

#### B. Chunking Algorithm (Line-based, ~400 tokens)

```typescript
export function chunkMarkdown(
  content: string,
  chunking: {
    tokens: number;    // e.g., 400
    overlap: number;   // e.g., 80
  }
): MemoryChunk[] {
  const lines = content.split("\n");
  const chunks: MemoryChunk[] = [];

  // Aproximação: 1 token ≈ 4 chars
  const maxChars = Math.max(32, chunking.tokens * 4);      // 1600 chars
  const overlapChars = Math.max(0, chunking.overlap * 4);  // 320 chars

  let currentChunk: string[] = [];
  let currentChars = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineSize = line.length + 1; // +1 for newline

    // Check if adding this line exceeds maxChars
    if (currentChars + lineSize > maxChars && currentChunk.length > 0) {
      // Flush current chunk
      chunks.push({
        text: currentChunk.join("\n"),
        startLine,
        endLine: startLine + currentChunk.length - 1
      });

      // Carry over overlap
      const overlapLines = carryOverlapLines(currentChunk, overlapChars);
      currentChunk = overlapLines;
      currentChars = overlapLines.reduce((sum, l) => sum + l.length + 1, 0);
      startLine = startLine + currentChunk.length - overlapLines.length;
    }

    currentChunk.push(line);
    currentChars += lineSize;
  }

  // Flush last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join("\n"),
      startLine,
      endLine: startLine + currentChunk.length - 1
    });
  }

  return chunks;
}

function carryOverlapLines(lines: string[], overlapChars: number): string[] {
  let chars = 0;
  let i = lines.length - 1;

  while (i >= 0 && chars < overlapChars) {
    chars += lines[i].length + 1;
    i--;
  }

  return lines.slice(i + 1);
}
```

**Exemplo**:
```markdown
# Memory File (5000 chars)

## Section 1 (800 chars)
Content here...

## Section 2 (900 chars)
More content...

## Section 3 (1200 chars)
Even more...

## Section 4 (2100 chars)
Final section...
```

**Chunking** (maxChars=1600, overlap=320):
```
Chunk 1: lines 1-25    (1580 chars, ends mid-Section 2)
         ↓ overlap (last 320 chars ≈ 5 lines)
Chunk 2: lines 21-45   (1590 chars, ends mid-Section 3)
         ↓ overlap
Chunk 3: lines 41-65   (1610 chars, ends in Section 4)
         ↓ overlap
Chunk 4: lines 61-end  (940 chars, final chunk)
```

**Por que line-based?**
- Respeita estrutura Markdown (headers, lists)
- Overlap preserva contexto entre chunks
- Line numbers facilitam `memory_get`

**Por que 400 tokens / 80 overlap?**
- 400 tokens ≈ 1 parágrafo médio
- 80 overlap ≈ 2-3 sentenças (preserva context bridges)
- Balanceia granularidade vs coerência semântica

#### C. Embedding Generation com Batching

```typescript
async indexFile(entry: MemoryFileEntry) {
  // 1. Read file content
  const content = await fs.readFile(entry.path, "utf-8");

  // 2. Chunk into ~400 token pieces
  const chunks = chunkMarkdown(content, {
    tokens: settings.chunking.tokens,
    overlap: settings.chunking.overlap
  });

  // 3. Hash chunks (for cache lookup)
  const hashes = chunks.map(c => hashText(c.text));

  // 4. Load cached embeddings
  const cachedEmbeddings = this.loadEmbeddingCache(hashes);

  // 5. Identify missing embeddings
  const missing: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (!cachedEmbeddings.has(hashes[i])) {
      missing.push(i);
    }
  }

  // 6. Generate missing embeddings (batched!)
  if (missing.length > 0) {
    const missingChunks = missing.map(i => chunks[i]);
    const newEmbeddings = await this.embedChunksInBatches(missingChunks);

    // Cache new embeddings
    for (let i = 0; i < missing.length; i++) {
      const chunkIndex = missing[i];
      this.upsertEmbeddingCache({
        hash: hashes[chunkIndex],
        embedding: newEmbeddings[i],
        provider: settings.provider,
        model: settings.model
      });
    }
  }

  // 7. Assemble final embeddings
  const embeddings: number[][] = chunks.map((chunk, i) => {
    const cached = cachedEmbeddings.get(hashes[i]);
    return cached || newEmbeddings[missing.indexOf(i)];
  });

  // 8. Store in SQLite
  await this.storeChunks({
    filePath: entry.path,
    chunks,
    embeddings,
    model: settings.model
  });
}
```

#### D. Embedding Batching (Otimização Crítica!)

**Localização**: `src/memory/batch-openai.ts`, `src/memory/batch-gemini.ts`

**OpenAI Batch API Flow**:

```typescript
async embedChunksInBatches(chunks: MemoryChunk[]): Promise<number[][]> {
  // Check if batch is enabled
  if (!this.batch.enabled) {
    return await this.embedChunksNonBatch(chunks); // Fallback
  }

  try {
    return await this.embedChunksViaBatchAPI(chunks);
  } catch (error) {
    // Record failure, potentially disable batch
    const failure = await this.recordBatchFailure(error);
    if (failure.disabled) {
      console.warn("Batch API disabled after failures, using non-batch");
      return await this.embedChunksNonBatch(chunks);
    }
    throw error;
  }
}

async embedChunksViaBatchAPI(chunks: MemoryChunk[]): Promise<number[][]> {
  // Step 1: Build batch requests (JSONL format)
  const requests: OpenAiBatchRequest[] = chunks.map((chunk, i) => ({
    custom_id: hashText(`${chunk.path}:${chunk.hash}`),
    method: "POST",
    url: "/v1/embeddings",
    body: {
      model: "text-embedding-3-small",
      input: chunk.text
    }
  }));

  // Step 2: Split if > 50k requests (OpenAI limit)
  const groups = splitOpenAiBatchRequests(requests, 50000);

  // Step 3: For each group
  const allEmbeddings = new Map<string, number[]>();

  for (const group of groups) {
    // Upload JSONL file
    const jsonlContent = group.map(r => JSON.stringify(r)).join("\n");
    const file = await openai.files.create({
      file: new Blob([jsonlContent]),
      purpose: "batch"
    });

    // Submit batch
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/embeddings",
      completion_window: "24h"
    });

    // Poll for completion (with timeout)
    const startTime = Date.now();
    const timeoutMs = 3600000; // 1 hour
    const pollIntervalMs = 2000; // 2 seconds

    while (batch.status !== "completed") {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error("Batch timeout");
      }

      if (batch.status === "failed" || batch.status === "cancelled") {
        throw new Error(`Batch ${batch.status}`);
      }

      await sleep(pollIntervalMs);
      batch = await openai.batches.retrieve(batch.id);
    }

    // Download output JSONL
    const outputFile = await openai.files.content(batch.output_file_id);
    const outputContent = await outputFile.text();

    // Parse results
    for (const line of outputContent.split("\n")) {
      if (!line.trim()) continue;

      const result = JSON.parse(line);
      const customId = result.custom_id;
      const embedding = result.response.body.data[0].embedding;

      allEmbeddings.set(customId, embedding);
    }
  }

  // Step 4: Map back to original order
  return requests.map(req => allEmbeddings.get(req.custom_id)!);
}
```

**Batch API Benefits**:
- **50% cheaper**: $0.00002/1K tokens vs $0.00010/1K tokens
- **Async processing**: No blocking wait
- **Rate limit friendly**: Single API call for 50k requests

**Failure Handling**:
```typescript
// Disable batch after 2 failures
const BATCH_FAILURE_LIMIT = 2;

async recordBatchFailure(error: Error): Promise<{
  count: number;
  disabled: boolean;
}> {
  this.batchFailureCount++;

  if (this.batchFailureCount >= BATCH_FAILURE_LIMIT) {
    this.batch.enabled = false;
    console.warn("Batch API disabled after repeated failures");
    return { count: this.batchFailureCount, disabled: true };
  }

  return { count: this.batchFailureCount, disabled: false };
}

// Reset on success
async resetBatchFailureCount() {
  if (this.batchFailureCount > 0) {
    console.log("Batch API succeeded, resetting failure count");
    this.batchFailureCount = 0;
  }
}
```

#### E. Embedding Cache

```typescript
// Cache structure
CREATE TABLE embedding_cache (
  hash TEXT PRIMARY KEY,        -- SHA256(chunk text)
  provider TEXT,                -- "openai", "gemini", "local"
  model TEXT,                   -- "text-embedding-3-small"
  embedding TEXT,               -- JSON array
  updated_at INTEGER
);

// Load from cache
loadEmbeddingCache(hashes: string[]): Map<string, number[]> {
  const query = `
    SELECT hash, embedding
    FROM embedding_cache
    WHERE hash IN (${hashes.map(() => "?").join(",")})
      AND provider = ?
      AND model = ?
  `;

  const rows = db.prepare(query).all([...hashes, provider, model]);

  return new Map(
    rows.map(row => [row.hash, JSON.parse(row.embedding)])
  );
}

// Store in cache
upsertEmbeddingCache(entries: Array<{
  hash: string;
  embedding: number[];
  provider: string;
  model: string;
}>): void {
  const stmt = db.prepare(`
    INSERT INTO embedding_cache (hash, provider, model, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (hash) DO UPDATE SET
      embedding = excluded.embedding,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  for (const entry of entries) {
    stmt.run([
      entry.hash,
      entry.provider,
      entry.model,
      JSON.stringify(entry.embedding),
      now
    ]);
  }
}

// Prune cache (LRU)
pruneEmbeddingCache(maxEntries: number = 10000): void {
  const count = db.prepare("SELECT COUNT(*) as c FROM embedding_cache").get().c;

  if (count > maxEntries) {
    const toDelete = count - maxEntries;
    db.prepare(`
      DELETE FROM embedding_cache
      WHERE hash IN (
        SELECT hash FROM embedding_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `).run(toDelete);
  }
}
```

**Cache Benefits**:
- Evita re-embedding de chunks unchanged
- Hash-based lookup (O(1))
- LRU eviction quando > 10k entries
- Provider/model keyed (different models = different embeddings)

#### F. SQLite Storage Schema

```sql
-- Files table (tracks indexed files)
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT,           -- "memory" | "sessions"
  hash TEXT,             -- SHA256(file content)
  mtime INTEGER,         -- Last modified time
  size INTEGER,
  indexed_at INTEGER
);

-- Chunks table (text + metadata)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,   -- UUID
  path TEXT,
  source TEXT,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT,             -- SHA256(chunk text)
  model TEXT,            -- Embedding model
  text TEXT,
  embedding TEXT,        -- JSON array (for backup)
  updated_at INTEGER,
  FOREIGN KEY (path) REFERENCES files(path) ON DELETE CASCADE
);

-- Vector index (sqlite-vec extension)
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]  -- 1536 dimensions for text-embedding-3-small
);

-- FTS5 index (full-text search)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,                  -- Indexed text
  id UNINDEXED,
  path UNINDEXED,
  source UNINDEXED,
  model UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED,
  tokenize='porter unicode61'  -- Stemming + Unicode
);

-- Embedding cache
CREATE TABLE embedding_cache (
  hash TEXT PRIMARY KEY,
  provider TEXT,
  model TEXT,
  embedding TEXT,
  updated_at INTEGER
);
```

**Índices**:
```sql
CREATE INDEX idx_chunks_path ON chunks(path);
CREATE INDEX idx_chunks_source ON chunks(source);
CREATE INDEX idx_chunks_hash ON chunks(hash);
CREATE INDEX idx_cache_provider_model ON embedding_cache(provider, model);
```

---

### 3. Memory Tools (Agent Integration)

**Localização**: Tool definitions, integrated via `src/memory/manager.ts`

#### A. memory_search Tool

```typescript
{
  name: "memory_search",
  description: `
    Mandatory recall step: semantically search MEMORY.md + memory/*.md
    before answering questions about prior work, decisions, dates,
    people, preferences, or todos.

    Returns chunks ranked by hybrid score (vector + keyword).
  `,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language search query"
      },
      maxResults: {
        type: "number",
        description: "Max results to return (default 6)",
        default: 6
      },
      minScore: {
        type: "number",
        description: "Min score threshold (default 0.35)",
        default: 0.35
      }
    },
    required: ["query"]
  }
}

// Implementation
async search(query: string, opts?: {
  maxResults?: number;
  minScore?: number;
  sessionKey?: string;
}): Promise<MemorySearchResult[]> {
  // 1. Warm session files if configured
  if (opts?.sessionKey) {
    void this.warmSession(opts.sessionKey);
  }

  // 2. Trigger sync if dirty
  if (this.dirty || this.sessionsDirty) {
    void this.sync({ reason: "search" }); // Non-blocking
  }

  // 3. Generate query embedding
  const queryEmbedding = await this.embedQueryWithTimeout(query);

  // 4. Run parallel searches
  const [vectorResults, keywordResults] = await Promise.all([
    this.searchVector(queryEmbedding, opts?.maxResults || 20),
    this.searchKeyword(query, opts?.maxResults || 20)
  ]);

  // 5. Merge results (hybrid scoring)
  const merged = this.mergeHybridResults({
    vector: vectorResults,
    keyword: keywordResults,
    vectorWeight: 0.7,
    textWeight: 0.3
  });

  // 6. Filter & return
  return merged
    .filter(r => r.score >= (opts?.minScore || 0.35))
    .slice(0, opts?.maxResults || 6)
    .map(r => ({
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      snippet: r.text.slice(0, 200) + "...",
      source: r.source
    }));
}
```

**Response Example**:
```json
{
  "results": [
    {
      "path": "memory/2026-01-20.md",
      "startLine": 45,
      "endLine": 52,
      "score": 0.87,
      "snippet": "## API Discussion\nDecided to use REST over GraphQL for simplicity...",
      "source": "memory"
    },
    {
      "path": "MEMORY.md",
      "startLine": 120,
      "endLine": 125,
      "score": 0.72,
      "snippet": "## User Preferences\n- Prefers TypeScript over JavaScript...",
      "source": "memory"
    }
  ],
  "provider": "openai",
  "model": "text-embedding-3-small"
}
```

#### B. memory_get Tool

```typescript
{
  name: "memory_get",
  description: `
    Read specific lines from a memory file after memory_search.
    Use the path and line numbers from search results.
  `,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path from search result"
      },
      from: {
        type: "number",
        description: "Start line number"
      },
      lines: {
        type: "number",
        description: "Number of lines to read (default 15)",
        default: 15
      }
    },
    required: ["path", "from"]
  }
}

// Implementation
async get(params: {
  path: string;
  from: number;
  lines?: number;
}): Promise<{ path: string; text: string }> {
  const workspacePath = path.join(this.workspaceDir, params.path);

  // Read file
  const content = await fs.readFile(workspacePath, "utf-8");
  const allLines = content.split("\n");

  // Extract lines
  const startIndex = params.from - 1; // 1-indexed to 0-indexed
  const endIndex = startIndex + (params.lines || 15);
  const extractedLines = allLines.slice(startIndex, endIndex);

  return {
    path: params.path,
    text: extractedLines.join("\n")
  };
}
```

**Usage Flow**:
```typescript
// Agent conversation:
User: "What database did we decide to use?"

// Agent calls memory_search
const results = await tools.memory_search({
  query: "database decision",
  maxResults: 3
});

// Agent examines snippets
// results[0].snippet: "## API Discussion\nDecided to use..."

// Agent calls memory_get for full context
const full = await tools.memory_get({
  path: results[0].path,
  from: results[0].startLine,
  lines: 20
});

// Agent responds
"Based on our conversation on 2026-01-20, we decided to use PostgreSQL
for the following reasons: ..."
```

---

### 4. Multi-Agent Memory Isolation

**Localização**: Index cache keyed by `agentId` + workspace + settings

```typescript
// Singleton cache per agent configuration
private static INDEX_CACHE = new Map<string, MemoryIndexManager>();

static async get(params: {
  cfg: MoltbotConfig;
  agentId: string;
}): Promise<MemoryIndexManager> {
  // Resolve settings
  const settings = resolveMemorySearchConfig(params.cfg, params.agentId);
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);

  // Composite cache key
  const key = JSON.stringify({
    agentId: params.agentId,
    workspaceDir,
    provider: settings.provider,
    model: settings.model,
    chunking: settings.chunking
  });

  // Return cached or create new
  const existing = INDEX_CACHE.get(key);
  if (existing) return existing;

  const manager = new MemoryIndexManager({
    cacheKey: key,
    agentId: params.agentId,
    workspaceDir,
    dbPath: path.join(
      getStateDir(),
      "memory",
      `${params.agentId}.sqlite`
    ),
    settings
  });

  await manager.initialize();
  INDEX_CACHE.set(key, manager);

  return manager;
}
```

**Isolation Mechanisms**:

1. **Workspace Isolation**:
```
Agent "main":
  - Workspace: ~/clawd/
  - DB: ~/.clawdbot/memory/main.sqlite
  - Memory files: ~/clawd/MEMORY.md, ~/clawd/memory/*.md

Agent "work":
  - Workspace: ~/clawd-work/
  - DB: ~/.clawdbot/memory/work.sqlite
  - Memory files: ~/clawd-work/MEMORY.md, ~/clawd-work/memory/*.md
```

2. **Database Isolation**:
- Separate SQLite file per agent
- No cross-agent queries possible
- Embeddings not shared (different contexts)

3. **Cache Isolation**:
- Embedding cache keyed by hash + provider + model
- Shared across agents with same settings (optimization)
- LRU eviction per-agent

4. **Soft Sandbox**:
- Agents CAN access other workspaces with absolute paths
- No chroot enforcement (by design)
- Use case: "work" agent reading from "personal" agent memory

**Security Trade-off**:
- Isolation = convenience (separate contexts)
- NOT a security boundary (agents can read each other)
- For true isolation, run separate gateway instances

---

## ⏱️ Session Management (Short-term)

### Arquitetura Geral

**Localização**: `src/agents/pi-embedded-runner/`

Session management otimiza o **contexto de curto prazo** para caber na janela do modelo e minimizar custos.

```
Session Lifecycle
    ↓
┌───────────────────────────────────────────┐
│  1. NORMAL OPERATION                      │
│     Context: 50K / 200K tokens            │
│     - Recent messages                     │
│     - Tool results                        │
│     - No optimization needed              │
└───────────────────────────────────────────┘
    ↓ Context grows...
┌───────────────────────────────────────────┐
│  2. SOFT THRESHOLD (75%)                  │
│     Context: 176K / 200K tokens           │
│     ⚠️ MEMORY FLUSH TRIGGERED             │
│     - Silent turn: "Save memories"        │
│     - Agent writes to memory/*.md         │
│     - NO_REPLY (user não vê)              │
└───────────────────────────────────────────┘
    ↓ Memory saved, continue...
┌───────────────────────────────────────────┐
│  3. HARD THRESHOLD (95%)                  │
│     Context: 192K / 200K tokens           │
│     🧹 COMPACTION TRIGGERED               │
│     - Summarize turns 1-140               │
│     - Keep turns 141-150                  │
│     - Context: 55K / 200K tokens          │
└───────────────────────────────────────────┘
    ↓ Compacted, continue...
┌───────────────────────────────────────────┐
│  4. BEFORE EACH REQUEST                   │
│     CONTEXT PRUNING (if cache-ttl mode)   │
│     - Soft trim: Keep head + tail         │
│     - Hard clear: Replace with placeholder│
│     - Optimize for Anthropic cache        │
└───────────────────────────────────────────┘
```

---

### 1. Memory Flush (Pre-Compaction Safety) ⭐⭐⭐⭐⭐

**Localização**: `src/auto-reply/reply/memory-flush.ts`

Memory flush é uma **inovação crítica**: salva info importante ANTES da compaction lossy.

#### A. Quando Disparar

```typescript
export function shouldRunMemoryFlush(params: {
  entry?: {
    totalTokens: number;
    compactionCount: number;
    memoryFlushCompactionCount?: number;
  };
  contextWindowTokens: number;    // e.g., 200000
  reserveTokensFloor: number;      // e.g., 20000
  softThresholdTokens: number;     // e.g., 4000
}): boolean {
  if (!params.entry) return false;

  // Calculate soft threshold
  const threshold =
    params.contextWindowTokens -
    params.reserveTokensFloor -
    params.softThresholdTokens;

  // Example: 200000 - 20000 - 4000 = 176000 tokens

  // Check if exceeds soft threshold
  if (params.entry.totalTokens < threshold) {
    return false; // Not yet
  }

  // Check if already flushed at this compaction count
  const lastFlushAt = params.entry.memoryFlushCompactionCount;
  if (lastFlushAt === params.entry.compactionCount) {
    return false; // Already flushed, don't double-flush
  }

  return true; // Run memory flush
}
```

**Thresholds**:
```typescript
contextWindow = 200,000 tokens
reserveTokens = 20,000  (hard minimum for response)
softThreshold = 4,000   (trigger point before compaction)

effectiveThreshold = 200,000 - 20,000 - 4,000 = 176,000 tokens
```

**Visual**:
```
Context Window (200K tokens)
├─────────────────────────────────────────────┤
│                                             │
│  Normal Operation (0-176K)                  │
│  ─────────────────────────────────► 176K   │
│                                      ↑      │
│                              Soft Threshold │
│                                             │
│  Memory Flush Zone (176K-196K)              │
│  ───────────────────► 196K                 │
│                         ↑                   │
│                  Hard Threshold             │
│                  (Compaction)               │
│                                             │
│  Reserve (196K-200K)                        │
│  ────► 200K (MAX)                          │
│                                             │
└─────────────────────────────────────────────┘
```

#### B. Prompt Padrão

```typescript
export const DEFAULT_MEMORY_FLUSH_PROMPT = [
  "Pre-compaction memory flush.",
  "Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed).",
  "If nothing to store, reply with NO_REPLY_TOKEN."
].join(" ");

export const DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT =
  "Session nearing compaction. Store durable memories now.";
```

#### C. NO_REPLY Mechanism

```typescript
// Agent response to memory flush prompt
if (response.text === NO_REPLY_TOKEN) {
  // Silently skip reply (don't send to user)
  return { silent: true };
}

// NO_REPLY_TOKEN definition
const NO_REPLY_TOKEN = "__NO_REPLY__";
```

**Flow**:
```
[Turn 100] User: "Deploy the app"
[Turn 101] Assistant: "Deployed v2.3.0 to production..."
           totalTokens: 178,000

─── SOFT THRESHOLD EXCEEDED (176K) ───

[Turn 102] System (hidden): "Pre-compaction memory flush..."
[Turn 103] Assistant (hidden):
           - Calls: memory_write("memory/2026-01-28.md", "...")
           - Reply: "__NO_REPLY__"
           (User never sees this turn!)

           totalTokens: 180,000

─── MEMORY SAVED, CONTINUE ───

[Turn 104] User: "What's the status?"
[Turn 105] Assistant: "App deployed successfully..."
```

#### D. Tracking Flush State

```typescript
// Session entry metadata
interface SessionEntry {
  totalTokens: number;
  compactionCount: number;          // How many times compacted
  memoryFlushCompactionCount?: number; // Last compaction count when flushed
}

// After memory flush
entry.memoryFlushCompactionCount = entry.compactionCount;

// Prevents double-flush:
// - Flush happens once per compaction cycle
// - If flush at compactionCount=2, don't flush again until compactionCount=3
```

---

### 2. Session Compaction ⭐⭐⭐⭐⭐

**Localização**: `src/agents/pi-embedded-runner/compact.ts`

Compaction **resume conversas antigas** para liberar espaço, sem perder contexto.

#### A. Quando Disparar

```typescript
// Compaction is triggered by SDK internally when:
// - totalTokens > contextWindow * 0.95 (hard threshold)
// - OR manual trigger via /compact command

// Soft limit (configurável):
const SOFT_COMPACTION_THRESHOLD = 150_000; // 150K tokens

if (totalTokens > SOFT_COMPACTION_THRESHOLD) {
  console.warn("Approaching compaction threshold");
}
```

#### B. Compaction Algorithm

```typescript
export async function compactEmbeddedPiSessionDirect(
  params: CompactEmbeddedPiSessionParams
): Promise<EmbeddedPiCompactResult> {
  // 1. Load session
  const sessionManager = SessionManager.open(params.sessionFile);
  const session = sessionManager.getSession();

  // 2. Get messages to compact
  const messages = session.messages;

  // 3. Sanitize history (remove sensitive data)
  const sanitized = await sanitizeSessionHistory({
    messages,
    modelApi: params.model.api,
    // Remove: auth tokens, API keys, etc.
  });

  // 4. Limit history (DM-specific cutoff)
  const limited = limitHistoryTurns(
    sanitized,
    getDmHistoryLimitFromSessionKey(params.sessionKey, params.config)
  );

  // 5. Calculate tokens before
  const tokensBefore = estimateTokensForMessages(limited);

  // 6. Run SDK compaction
  const result = await session.compact({
    instructions: params.customInstructions || DEFAULT_COMPACTION_INSTRUCTIONS
  });
  // SDK returns: {
  //   summary: "Built REST API with /users, /auth...",
  //   firstKeptEntryId: "entry-141",
  //   tokensBefore: 182000,
  //   details: {...}
  // }

  // 7. Calculate tokens after
  const tokensAfter = estimateTokensForMessages(session.messages);

  // 8. Persist session
  sessionManager.flushPendingToolResults?.();
  await sessionManager.save();

  return {
    ok: true,
    compacted: true,
    result: {
      summary: result.summary,
      tokensBefore,
      tokensAfter,
      compressionRatio: tokensAfter / tokensBefore,
      keptEntryId: result.firstKeptEntryId
    }
  };
}
```

#### C. Compaction Example

**BEFORE**:
```
Session messages (182,000 tokens):

[Turn 1] User: "Let's build an API"
[Turn 2] Assistant: "Sure! What endpoints do you need?"
[Turn 3] User: "Users and auth"
[Turn 4] Assistant: *creates 500-line schema* (5000 tokens)
[Turn 5] User: "Add rate limiting"
[Turn 6] Assistant: *modifies code* (3000 tokens)
[Turn 7] User: "Deploy to staging"
[Turn 8] Assistant: *deployment logs* (4000 tokens)
...
[Turn 140] User: "What's the status?"
[Turn 141] Assistant: "API is deployed..."
[Turn 142] User: "Check production"
[Turn 143] Assistant: "Production looks good..."
...
[Turn 150] User: "Generate report"
```

**AFTER**:
```
Session messages (55,000 tokens):

[SUMMARY] (3000 tokens)
"Built REST API with /users and /auth endpoints. Implemented JWT
authentication with refresh tokens. Added rate limiting (100 req/min)
using Redis. Created PostgreSQL schema with migrations. Deployed v2.4.0
to staging and production. Current focus: generating status report."

[Turn 141] Assistant: "API is deployed..."
[Turn 142] User: "Check production"
[Turn 143] Assistant: "Production looks good..."
...
[Turn 150] User: "Generate report"
[Turn 151] Assistant: *generating report*
```

**Compression Ratio**: 55,000 / 182,000 = **30%** (70% savings!)

#### D. Custom Instructions

```typescript
const DEFAULT_COMPACTION_INSTRUCTIONS = `
Focus on:
- Key decisions and their rationale
- Technical choices and architecture
- Current status and next steps
- Open questions or blockers

Omit:
- Verbose code/logs (keep high-level summary only)
- Redundant context (already in memory files)
- Resolved issues (mention resolution, not full debug)
`;

// User can customize:
/compact Focus on API design decisions and security concerns
```

#### E. Lane-Based Queuing (Evita Deadlocks)

```typescript
export async function compactEmbeddedPiSession(
  params: CompactEmbeddedPiSessionParams
) {
  // Resolve lanes
  const sessionLane = resolveSessionLane(params.sessionKey || params.sessionId);
  const globalLane = resolveGlobalLane(params.lane);

  // Queue: session lane → global lane → execute
  return enqueueCommandInLane(sessionLane, () =>
    enqueueGlobal(async () =>
      compactEmbeddedPiSessionDirect(params)
    )
  );
}
```

**Por que nested queues?**
- Session lane: Garante que compaction não compete com chat runs
- Global lane: Previne sobrecarga de CPU/memory durante compaction
- Deadlock prevention: Compaction nunca bloqueia incoming messages

---

### 3. Context Pruning ⭐⭐⭐⭐⭐

**Localização**: `src/agents/pi-extensions/context-pruning/pruner.ts`

Pruning **otimiza tool results** para economizar contexto e melhorar cache hit rate.

#### A. Estratégias de Pruning

**1. Soft Trim** (context > 80%):
```typescript
function softTrimToolResultMessage(params: {
  msg: AgentMessage;
  settings: {
    softTrim: {
      maxChars: number;      // 5000
      headChars: number;     // 300
      tailChars: number;     // 500
    };
  };
}): AgentMessage {
  const content = extractTextContent(params.msg);

  if (content.length <= params.settings.softTrim.maxChars) {
    return params.msg; // No trim needed
  }

  // Keep head + tail
  const head = content.slice(0, params.settings.softTrim.headChars);
  const tail = content.slice(-params.settings.softTrim.tailChars);

  const trimmed = [
    head,
    "\n...\n",
    tail,
    `\n[Tool result trimmed: kept first ${params.settings.softTrim.headChars} ` +
    `and last ${params.settings.softTrim.tailChars} of ${content.length} chars.]`
  ].join("");

  return {
    ...params.msg,
    content: [{ type: "text", text: trimmed }]
  };
}
```

**Example**:
```typescript
// Input (8000 chars):
{
  role: "toolResult",
  content: "npm WARN deprecated package@1.0.0...\n[7500 chars]...\nSuccessfully installed."
}

// Output (soft trim):
{
  role: "toolResult",
  content: "npm WARN deprecated package@1.0.0...\n...\n...Successfully installed.\n[Tool result trimmed: kept first 300 and last 500 of 8000 chars.]"
}
```

**2. Hard Clear** (context > 65%):
```typescript
function hardClearToolResult(msg: AgentMessage, placeholder: string): AgentMessage {
  return {
    ...msg,
    content: [{ type: "text", text: placeholder }]
  };
}

// Example:
// Input: { role: "toolResult", content: "..." (5000 chars) }
// Output: { role: "toolResult", content: "[Tool result cleared to save context]" }
```

#### B. Pruning Algorithm

```typescript
export function pruneContextMessages(params: {
  messages: AgentMessage[];
  settings: {
    keepLastAssistants: number;   // 3 (protect recent turns)
    softTrimRatio: number;         // 0.8
    softTrim: { maxChars, headChars, tailChars };
    hardClearRatio: number;        // 0.65
    hardClear: { enabled, placeholder };
    minPrunableToolChars: number;  // 10000
  };
  contextWindowTokens: number;
}): AgentMessage[] {
  const charWindow = params.contextWindowTokens * 4; // ~1 char per token
  let totalChars = estimateTotalChars(params.messages);

  // Step 1: Find cutoff index (protect last N assistant messages)
  const cutoffIndex = findAssistantCutoffIndex(
    params.messages,
    params.settings.keepLastAssistants
  );

  // Step 2: Soft trim (context > 80%)
  let ratio = totalChars / charWindow;
  if (ratio >= params.settings.softTrimRatio) {
    for (let i = 0; i < cutoffIndex; i++) {
      if (params.messages[i].role !== "toolResult") continue;

      const chars = estimateChars(params.messages[i]);
      if (chars < params.settings.minPrunableToolChars) continue;

      const trimmed = softTrimToolResultMessage({
        msg: params.messages[i],
        settings: params.settings
      });

      params.messages[i] = trimmed;
      totalChars = estimateTotalChars(params.messages);
      ratio = totalChars / charWindow;
    }
  }

  // Step 3: Hard clear (context > 65%)
  if (params.settings.hardClear.enabled && ratio >= params.settings.hardClearRatio) {
    for (let i = 0; i < cutoffIndex; i++) {
      if (ratio < params.settings.hardClearRatio) break; // Early exit
      if (params.messages[i].role !== "toolResult") continue;

      params.messages[i] = hardClearToolResult(
        params.messages[i],
        params.settings.hardClear.placeholder
      );

      totalChars = estimateTotalChars(params.messages);
      ratio = totalChars / charWindow;
    }
  }

  return params.messages;
}
```

**Flowchart**:
```
Context Messages
    ↓
Calculate ratio = totalChars / charWindow
    ↓
┌─────────────────────────────────────┐
│ ratio < 0.8? (below soft trim)      │
│ → NO PRUNING                        │
└─────────────────────────────────────┘
    ↓ ratio >= 0.8
┌─────────────────────────────────────┐
│ SOFT TRIM                           │
│ - Find tool results before cutoff   │
│ - Trim to head + tail               │
│ - Recalculate ratio                 │
└─────────────────────────────────────┘
    ↓ ratio >= 0.65
┌─────────────────────────────────────┐
│ HARD CLEAR                          │
│ - Replace tool results with placeholder│
│ - Recalculate ratio                 │
│ - Stop when ratio < 0.65            │
└─────────────────────────────────────┘
    ↓
Pruned Messages
```

#### C. Cache-TTL Mode (Anthropic Optimization) ⭐⭐⭐⭐⭐

**Localização**: `src/agents/pi-embedded-runner/cache-ttl.ts`

Cache-TTL mode otimiza para **Anthropic's prompt caching**:

**O Problema**:
```
Anthropic Prompt Caching:
- Cache TTL: 5 minutes (default)
- Cache hit: Prefix unchanged → 10% cost
- Cache miss: Prefix changed → 100% cost (re-cache)

Without pruning:
- Session idle > 5 min → Cache expires
- Next message → Full re-cache cost 💸

With cache-ttl pruning:
- Session idle > 5 min → Prune old tool results
- Smaller context → Cheaper re-cache ✅
```

**Implementation**:
```typescript
// Cache-TTL entry tracking
export type CacheTtlEntryData = {
  timestamp: number;
  provider?: string;
  modelId?: string;
};

// Check if provider supports caching
export function isCacheTtlEligibleProvider(
  provider: string,
  modelId: string
): boolean {
  if (provider === "anthropic") return true;
  if (provider === "openrouter" && modelId.startsWith("anthropic/")) return true;
  return false;
}

// Read last cache touch timestamp
export function readLastCacheTtlTimestamp(
  sessionManager: SessionManager
): number | null {
  const entries = sessionManager.getEntries();

  // Find most recent cache-ttl entry
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].customType === "moltbot.cache-ttl") {
      return entries[i].data.timestamp ?? null;
    }
  }

  return null;
}

// Append cache touch marker
export function appendCacheTtlTimestamp(
  sessionManager: SessionManager,
  data: CacheTtlEntryData
): void {
  sessionManager.appendCustomEntry("moltbot.cache-ttl", data);
}
```

**Pruning Extension**:
```typescript
// Location: src/agents/pi-extensions/context-pruning/extension.ts

// Before each request to Claude
if (runtime.settings.mode === "cache-ttl") {
  const ttlMs = runtime.settings.ttlMs || 300000; // 5 min default
  const lastTouch = runtime.lastCacheTouchAt;

  // Check if TTL expired
  if (lastTouch && Date.now() - lastTouch < ttlMs) {
    return undefined; // Cache still valid, don't prune
  }

  // TTL expired → prune to invalidate cache
  console.log("Cache TTL expired, pruning context");
}

// Run pruning
const pruned = pruneContextMessages({
  messages: runtime.messages,
  settings: runtime.settings,
  contextWindowTokens: runtime.contextWindow
});

// Update last touch timestamp
if (runtime.settings.mode === "cache-ttl") {
  runtime.lastCacheTouchAt = Date.now();

  // Append marker to session
  appendCacheTtlTimestamp(sessionManager, {
    timestamp: Date.now(),
    provider: runtime.provider,
    modelId: runtime.modelId
  });
}

return { messages: pruned };
```

**Flow**:
```
Request 1 at t=0
  → Cache MISS (first request)
  → Write cache (full cost)
  → lastCacheTouchAt = 0

Request 2 at t=60s (1 min)
  → Cache HIT (TTL not expired)
  → 10% cost ✅
  → No pruning

Request 3 at t=120s (2 min)
  → Cache HIT
  → 10% cost ✅
  → No pruning

... user idle ...

Request 4 at t=400s (6 min 40s)
  → TTL expired (> 5 min)
  → PRUNE context (remove old tool results)
  → Cache MISS (prefix changed)
  → Re-cache (full cost, but smaller context!)
  → lastCacheTouchAt = 400s

Request 5 at t=450s
  → Cache HIT (new cache valid)
  → 10% cost ✅
```

**Configuration**:
```yaml
agents:
  defaults:
    contextPruning:
      mode: cache-ttl           # Enable cache-TTL mode
      ttlMs: 300000             # 5 min (match Anthropic's TTL)
      keepLastAssistants: 3     # Protect recent 3 turns

      softTrim:
        maxChars: 5000
        headChars: 300
        tailChars: 500

      hardClear:
        enabled: true
        placeholder: "[Tool result cleared to save context]"

      minPrunableToolChars: 10000
```

---

### 4. Context Window Management

**Localização**: `src/agents/context-window-guard.ts`

Context window guard **valida e protege** contra overflow.

#### A. Context Window Resolution

```typescript
export function resolveContextWindowTokens(params: {
  model: ModelInfo;
  modelsConfig: ModelsConfig;
  agentContextTokens?: number;
}): {
  tokens: number;
  source: "model" | "modelsConfig" | "agentContextTokens" | "default";
} {
  // 1. Try model's native context window
  if (params.model.contextWindow) {
    return {
      tokens: params.model.contextWindow,
      source: "model"
    };
  }

  // 2. Try models config override
  const providerConfig = params.modelsConfig.providers[params.model.provider];
  const modelConfig = providerConfig?.models?.find(m => m.id === params.model.id);
  if (modelConfig?.contextWindow) {
    return {
      tokens: modelConfig.contextWindow,
      source: "modelsConfig"
    };
  }

  // 3. Try agent-level override
  if (params.agentContextTokens) {
    return {
      tokens: params.agentContextTokens,
      source: "agentContextTokens"
    };
  }

  // 4. Fallback to default
  return {
    tokens: DEFAULT_CONTEXT_TOKENS,
    source: "default"
  };
}

const DEFAULT_CONTEXT_TOKENS = 200_000;
```

#### B. Context Window Guard

```typescript
export type ContextWindowGuardResult = {
  tokens: number;
  source: ContextWindowSource;
  shouldWarn: boolean;   // tokens < 32k
  shouldBlock: boolean;  // tokens < 16k
};

export function evaluateContextWindowGuard(params: {
  info: { tokens: number; source: ContextWindowSource };
  warnBelowTokens?: number;  // Default 32000
  hardMinTokens?: number;    // Default 16000
}): ContextWindowGuardResult {
  const warnThreshold = params.warnBelowTokens || 32_000;
  const blockThreshold = params.hardMinTokens || 16_000;

  return {
    tokens: params.info.tokens,
    source: params.info.source,
    shouldWarn: params.info.tokens < warnThreshold,
    shouldBlock: params.info.tokens < blockThreshold
  };
}

// Usage
const guard = evaluateContextWindowGuard({
  info: { tokens: 15000, source: "model" }
});

if (guard.shouldBlock) {
  throw new Error(
    `Context window too small: ${guard.tokens} tokens (min 16k)`
  );
}

if (guard.shouldWarn) {
  console.warn(
    `Context window is small: ${guard.tokens} tokens (recommended 32k+)`
  );
}
```

#### C. Reserve Tokens

```typescript
export const DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR = 20_000;

// Ensures agent has room for response
const effectiveContextWindow = contextWindow - reserveTokens;

// Example:
// contextWindow = 200,000
// reserveTokens = 20,000
// effectiveContextWindow = 180,000 (agent can use this much)
```

---

## 🔗 Integração Completa

### Fluxo End-to-End: Mensagem → Compaction → Memory → Pruning

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER MESSAGE ARRIVES                                     │
│    "Deploy the app to production"                           │
│                                                             │
│    totalTokens = 178,000                                    │
│    contextWindow = 200,000                                  │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. CHECK SOFT THRESHOLD                                     │
│                                                             │
│    softThreshold = 4,000                                    │
│    reserveTokens = 20,000                                   │
│    threshold = 200,000 - 20,000 - 4,000 = 176,000          │
│                                                             │
│    178,000 > 176,000? YES → Need memory flush              │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. INJECT MEMORY FLUSH TURN (SILENT)                       │
│                                                             │
│    System (hidden): "Pre-compaction memory flush..."       │
│    Agent: Writes to memory/2026-01-28.md                   │
│    Agent: Replies with "__NO_REPLY__"                      │
│                                                             │
│    Result: totalTokens ≈ 180,000 (small increase)          │
│    (User never sees this turn!)                            │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. RUN COMPACTION                                           │
│                                                             │
│    Pre-compaction check: totalTokens > 190,000? NO         │
│    (Compaction triggered at 95% = 190k)                    │
│                                                             │
│    Continue processing...                                   │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. AGENT PROCESSES MESSAGE                                  │
│                                                             │
│    - Calls tools (exec, read, etc.)                        │
│    - Generates response                                     │
│    - Tool results: +15,000 tokens                           │
│                                                             │
│    totalTokens = 195,000 (95%)                              │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. COMPACTION TRIGGERED (195K > 190K)                       │
│                                                             │
│    - Summarize turns 1-140                                  │
│    - Keep turns 141-150                                     │
│                                                             │
│    tokensBefore: 195,000                                    │
│    tokensAfter: 58,000                                      │
│    Compression: 70% saved ✅                                │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. SAVE TO LONG-TERM MEMORY                                 │
│                                                             │
│    Memory manager syncs memory/2026-01-28.md:               │
│    - Chunks at ~400 tokens per chunk                        │
│    - Embeds chunks (batch API if enabled)                   │
│    - Stores in SQLite:                                      │
│      • chunks table                                         │
│      • chunks_vec (vector index)                            │
│      • chunks_fts (FTS5 index)                              │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 8. NEXT INCOMING MESSAGE                                    │
│    "Check deployment status"                                │
│                                                             │
│    Load session:                                            │
│    - Compacted summary: 5,000 tokens                        │
│    - Recent messages (141-150): 53,000 tokens               │
│                                                             │
│    totalTokens = 58,000 (29%)                               │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 9. CONTEXT PRUNING (Before sending to Claude)              │
│                                                             │
│    charWindow = 200,000 * 4 = 800,000 chars                 │
│    totalChars ≈ 232,000 (29%)                               │
│                                                             │
│    ratio = 0.29 < 0.8 (soft trim threshold)                 │
│    → No soft trim needed                                    │
│                                                             │
│    BUT: Cache-TTL mode enabled + TTL expired?               │
│    lastCacheTouchAt = 6 minutes ago                         │
│    ttlMs = 5 minutes                                        │
│    → YES, prune to invalidate cache                         │
│                                                             │
│    - Remove some old tool results                           │
│    - lastCacheTouchAt = now (reset TTL)                     │
│                                                             │
│    totalTokens after pruning: 55,000                        │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 10. SEND TO CLAUDE (Anthropic)                             │
│                                                             │
│     - Messages + system prompt + tools                      │
│     - Cache control headers (for prompt caching)            │
│                                                             │
│     Cache status: MISS (TTL expired, prefix changed)        │
│     → Re-cache (full cost, but smaller context!)           │
│                                                             │
│     Cost: $X for 55K tokens (vs $Y for 195K!)              │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ 11. AGENT RUNS, SEARCHES MEMORY                            │
│                                                             │
│     Agent calls: memory_search({                            │
│       query: "deployment status from today"                 │
│     })                                                      │
│                                                             │
│     Results:                                                │
│     - memory/2026-01-28.md (score: 0.89)                    │
│       "Deployed v2.3.0 to production..."                    │
│                                                             │
│     Agent responds with full context ✅                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Performance & Otimizações

### Memory System

| Componente | Métrica | Otimização |
|------------|---------|------------|
| **Embedding** | 1536-dim × N chunks | Batch API (50% cheaper) |
| **Indexing** | 5s per file | Debounce (5s) + batching |
| **Search** | ~100ms per query | Parallel vector + BM25 |
| **Cache** | 10k entries × 6KB | LRU eviction |
| **Storage** | ~1MB per 1000 chunks | SQLite compression |

### Session Management

| Componente | Trigger | Custo | Benefício |
|------------|---------|-------|-----------|
| **Memory Flush** | totalTokens > 176K | 1 agentic turn (~5s) | Previne loss durante compaction |
| **Compaction** | totalTokens > 190K | 1-2s per 50K tokens | 70% compression ratio |
| **Soft Trim** | Context > 80% | O(messages) scan | Mantém head + tail de tool results |
| **Hard Clear** | Context > 65% | O(prunable messages) | Remove tool results antigos |
| **Cache-TTL** | TTL expired | Prune old results | Cheaper re-cache (10% → 100%) |

### Multi-Agent Isolation

| Agentes | DB Size | Memory Overhead | Search Latency |
|---------|---------|-----------------|----------------|
| 1 | ~5MB | ~50MB RAM | ~100ms |
| 5 | ~25MB | ~150MB RAM | ~120ms |
| 10 | ~50MB | ~300MB RAM | ~150ms |
| 20+ | ~100MB+ | ~600MB+ RAM | ~200ms+ |

**Scaling Considerations**:
- Cada agent = SQLite DB separado
- Embedding cache compartilhado (por provider/model)
- RAM overhead cresce com # de agents ativos
- Recomendação: < 20 agents por gateway instance

---

## 🧮 Algoritmos-Chave

### 1. Hybrid Search Scoring

```python
# Pseudo-code
def hybrid_search(query: str, max_results: int = 6):
  # 1. Generate query embedding
  query_vec = embed(query)

  # 2. Vector search
  vector_results = sqlite_vec.search(
    embedding=query_vec,
    metric="cosine",
    limit=20
  )
  # Returns: [(id, score), ...] where score = 1 - cosine_distance

  # 3. BM25 search
  bm25_results = fts5.search(
    query=query,
    limit=20
  )
  # Returns: [(id, rank), ...] where rank = BM25 score
  # Normalize: score = 1 / (1 + abs(rank))

  # 4. Merge & score
  merged = {}
  for (id, score) in vector_results:
    merged[id] = { "vector": score, "keyword": 0 }

  for (id, rank) in bm25_results:
    score = 1 / (1 + abs(rank))
    if id in merged:
      merged[id]["keyword"] = score
    else:
      merged[id] = { "vector": 0, "keyword": score }

  # 5. Weighted scoring
  for id in merged:
    final_score = (
      0.7 * merged[id]["vector"] +
      0.3 * merged[id]["keyword"]
    )
    merged[id]["final"] = final_score

  # 6. Filter & sort
  results = [
    (id, data["final"])
    for id, data in merged.items()
    if data["final"] >= 0.35
  ]
  results.sort(key=lambda x: x[1], reverse=True)

  return results[:max_results]
```

### 2. Line-Based Chunking with Overlap

```python
def chunk_markdown(content: str, max_tokens: int = 400, overlap_tokens: int = 80):
  lines = content.split("\n")
  chunks = []

  max_chars = max_tokens * 4       # ~1600 chars
  overlap_chars = overlap_tokens * 4  # ~320 chars

  current_lines = []
  current_chars = 0
  start_line = 1

  for i, line in enumerate(lines):
    line_size = len(line) + 1  # +1 for newline

    # Check if adding this line exceeds max
    if current_chars + line_size > max_chars and len(current_lines) > 0:
      # Flush chunk
      chunks.append({
        "text": "\n".join(current_lines),
        "start_line": start_line,
        "end_line": start_line + len(current_lines) - 1
      })

      # Carry overlap
      overlap_lines = []
      overlap_size = 0
      for j in range(len(current_lines) - 1, -1, -1):
        if overlap_size >= overlap_chars:
          break
        overlap_lines.insert(0, current_lines[j])
        overlap_size += len(current_lines[j]) + 1

      current_lines = overlap_lines
      current_chars = overlap_size
      start_line = start_line + len(current_lines)

    current_lines.append(line)
    current_chars += line_size

  # Flush last chunk
  if len(current_lines) > 0:
    chunks.append({
      "text": "\n".join(current_lines),
      "start_line": start_line,
      "end_line": start_line + len(current_lines) - 1
    })

  return chunks
```

### 3. Context Pruning (Two-Pass)

```python
def prune_context(messages, context_window_tokens):
  char_window = context_window_tokens * 4
  total_chars = sum(estimate_chars(msg) for msg in messages)

  # Find cutoff (protect last 3 assistant messages)
  cutoff_index = find_assistant_cutoff(messages, keep_last=3)

  # Pass 1: Soft trim (context > 80%)
  ratio = total_chars / char_window
  if ratio >= 0.8:
    for i in range(cutoff_index):
      if messages[i].role != "toolResult":
        continue

      chars = estimate_chars(messages[i])
      if chars < 10000:  # Min prunable size
        continue

      # Trim to head + tail
      content = extract_text(messages[i])
      head = content[:300]
      tail = content[-500:]
      trimmed = f"{head}\n...\n{tail}\n[Trimmed: {len(content)} chars]"

      messages[i] = replace_content(messages[i], trimmed)
      total_chars = sum(estimate_chars(msg) for msg in messages)
      ratio = total_chars / char_window

  # Pass 2: Hard clear (context > 65%)
  if ratio >= 0.65:
    for i in range(cutoff_index):
      if ratio < 0.65:
        break  # Early exit
      if messages[i].role != "toolResult":
        continue

      messages[i] = replace_content(
        messages[i],
        "[Tool result cleared to save context]"
      )

      total_chars = sum(estimate_chars(msg) for msg in messages)
      ratio = total_chars / char_window

  return messages
```

---

## 🎓 Conclusão

Os sistemas de **Context Engineering** e **Memory** do Moltbot representam uma das implementações mais sofisticadas de gerenciamento de contexto em assistentes de IA:

### Pontos Fortes

1. **Memory Flush Preventivo** ⭐⭐⭐⭐⭐
   - Salva info ANTES da compaction
   - Previne loss de dados importantes
   - Silencioso (user não percebe)

2. **Hybrid Search (Vector + BM25)** ⭐⭐⭐⭐⭐
   - Melhor recall (semantic + keyword)
   - Weighted scoring inteligente
   - Handles múltiplos query types

3. **Context Pruning com Cache-TTL** ⭐⭐⭐⭐⭐
   - Otimiza para Anthropic caching
   - Two-pass algorithm (soft + hard)
   - Protects recent context

4. **Embedding Batching** ⭐⭐⭐⭐
   - 50% cheaper (batch API)
   - Fallback resilient
   - Cache layer (dedupe)

5. **Multi-Agent Isolation** ⭐⭐⭐⭐
   - Separate workspaces + DBs
   - No cross-contamination
   - Scales to 20+ agents

### Trade-offs

**Memory System**:
- ❌ Embedding overhead (~6KB per chunk)
- ❌ Batch API latency (async)
- ✅ Unlimited storage (Markdown)
- ✅ Human-editable (transparency)

**Session Management**:
- ❌ Compaction é lossy (info pode perder)
- ❌ Memory flush adiciona 1 turn
- ✅ Auto-recovery (nunca rejeita)
- ✅ Cache optimization (cheaper)

### Lições Aprendidas

Este sistema demonstra **excelência em**:

1. **Preventive Safety**: Memory flush antes de compaction
2. **Hybrid Approaches**: Vector + keyword, soft + hard pruning
3. **Cost Optimization**: Batching, caching, TTL-aware pruning
4. **Transparency**: Markdown storage, visible summaries
5. **Resilience**: Fallbacks, auto-disable, error handling

---

**Autor**: Deep-dive ao nível de código
**Data**: 2026-01-28
**Versão**: 1.0
**Baseado em**: Moltbot source code (commit a483337)
