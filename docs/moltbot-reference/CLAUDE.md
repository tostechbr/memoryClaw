# Moltbot Reference Documentation

> This folder contains reference documentation extracted from [Moltbot](https://github.com/moltbot/moltbot) to guide the implementation of Akashic Context.

## Purpose

Akashic Context is being built based on Moltbot's memory and context management systems. These documents serve as the **source of truth** for implementation decisions.

## Documents

| File | Description | Use For |
|------|-------------|---------|
| `memory.md` | Blog post about Moltbot's memory system | High-level understanding |
| `context-engineering-deep-dive.md` | Deep technical analysis with code | Implementation details |
| `architecture-deep-dive.md` | Architecture overview | System design |

## Quick Reference: Key Files in Moltbot

### Memory System (Long-term)
```
src/memory/
├── manager.ts              # Memory Manager (entry point)
├── internal.ts             # Indexing pipeline, chunking
├── hybrid.ts               # Hybrid search (vector + BM25)
├── sqlite.ts               # SQLite storage schema
├── sqlite-vec.ts           # Vector extension loading
├── batch-openai.ts         # OpenAI Batch API (50% cheaper)
├── batch-gemini.ts         # Gemini Batch API
├── embeddings.ts           # Embedding provider interface
├── embeddings-openai.ts    # OpenAI embeddings
├── search-manager.ts       # Search orchestration
└── sync-memory-files.ts    # File sync logic
```

### Context Management (Short-term)
```
src/agents/
├── compaction.ts                           # Session compaction
├── context-window-guard.ts                 # Context limits
└── pi-extensions/
    └── context-pruning/
        ├── pruner.ts                       # Pruning algorithm
        ├── extension.ts                    # Pi integration
        └── settings.ts                     # Configuration

src/agents/pi-embedded-runner/
├── cache-ttl.ts                            # Cache-TTL pruning
├── compact.ts                              # Compaction runner
└── run.ts                                  # Session execution
```

### Memory Flush
```
src/auto-reply/reply/
├── memory-flush.ts                         # Pre-compaction flush
└── agent-runner-memory.ts                  # Memory integration
```

## Implementation Mapping

| Moltbot Feature | Moltbot File | Akashic Phase |
|-----------------|--------------|---------------|
| Memory Storage | `src/memory/sqlite.ts` | Phase 1 ✅ |
| Chunking | `src/memory/internal.ts` | Phase 1 ✅ |
| BM25 Search | `src/memory/hybrid.ts` | Phase 1 ✅ |
| Embedding Cache | `src/memory/sqlite.ts` | Phase 1 ✅ |
| File Watcher | `src/memory/manager.ts` | Phase 1 ✅ |
| sqlite-vec | `src/memory/sqlite-vec.ts` | Phase 1.5 |
| Vector Search | `src/memory/hybrid.ts` | Phase 1.5 |
| Hybrid Merge | `src/memory/hybrid.ts` | Phase 1.5 |
| Batch API | `src/memory/batch-openai.ts` | Phase 1.5 |
| Token Counting | `src/agents/context-window-guard.ts` | Phase 2 |
| Memory Flush | `src/auto-reply/reply/memory-flush.ts` | Phase 2 |
| Compaction | `src/agents/compaction.ts` | Phase 2 |
| Pruning | `src/agents/pi-extensions/context-pruning/pruner.ts` | Phase 2 |
| Cache-TTL | `src/agents/pi-embedded-runner/cache-ttl.ts` | Phase 3 |
| Session Lifecycle | `src/agents/pi-embedded-runner/run.ts` | Phase 3 |

## Key Algorithms

### 1. Hybrid Search Scoring
```
finalScore = (0.7 * vectorScore) + (0.3 * keywordScore)
```

### 2. Chunking Parameters
```
tokens: 400       # ~1600 chars
overlap: 80       # ~320 chars
```

### 3. Context Thresholds (200K context window)
```
softThreshold = 176,000 tokens  # Trigger memory flush
hardThreshold = 190,000 tokens  # Trigger compaction
reserveTokens = 20,000 tokens   # Reserved for response
```

### 4. Pruning Thresholds
```
softTrimRatio = 0.3    # Start soft trim at 30% of context
hardClearRatio = 0.5   # Start hard clear at 50% of context
keepLastAssistants = 3 # Protect recent 3 turns
```

## How to Use This Reference

1. **Before implementing a feature**: Read the corresponding section in `context-engineering-deep-dive.md`
2. **When stuck**: Check the Moltbot source code at the paths listed above
3. **For testing**: Use the mathematical tests defined in the deep dive
4. **For configuration**: Follow the default values from Moltbot

## Links

- **Moltbot Repo**: https://github.com/moltbot/moltbot
- **Akashic Context**: https://github.com/tostechbr/akashic-context
- **MCP Protocol**: https://modelcontextprotocol.io
