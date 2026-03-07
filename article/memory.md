Clawdbot is an open-source personal AI assistant (MIT licensed) created by

that has quickly gained traction with over 32,600 stars on

at the time of writing this blog. Unlike ChatGPT or Claude, which run in the cloud, Clawdbot runs locally on your machine and integrates with chat platforms you already use, like Discord, WhatsApp, Telegram, and more.

What sets Clawdbot apart is its ability to handle real-world tasks autonomously: managing emails, scheduling calendar events, handling flight check-ins, and running background jobs on a schedule. But what caught my attention was its persistent memory system, which maintains 24/7 context retention, remembering conversations and building upon previous interactions indefinitely.

If you’ve read my previous posts on

and

, you know I am fascinated by how different AI products approach memory. Clawdbot takes a fundamentally different approach: instead of cloud-based, company controlled memory, it keeps everything local, giving users full ownership of their context and skills.

Let’s dive into how it works.

## 

How Context is Built

Before diving into memory, let’s understand what the model sees on each request:

```scss
[0] System Prompt (static + conditional instructions)
[1] Project Context (bootstrap files: AGENTS.md, SOUL.md, etc.)
[2] Conversation History (messages, tool calls, compaction summaries)
[3] Current Message
```

The system prompt defines the agent’s capabilities and available tools. What’s relevant for memory is Project Context, which includes user-editable Markdown files injected into every request:

[

![Image](https://pbs.twimg.com/media/G_l6OxEXIAIUC-x?format=png&name=900x900)



](https://x.com/manthanguptaa/article/2015780646770323543/media/2015776702333394946)

These files live in the agent’s workspace alongside memory files, making the entire agent configuration transparent and editable.

## 

Context vs Memory

Understanding the distinction between context and memory is fundamental to understanding Clawdbot.

Context is everything the model sees for a single request:

```ini
Context = System Prompt + Conversation History + Tool Results + Attachments
```

-   Ephemeral - exists only for this request
    
-   Bounded - limited by the model’s context window (e.g., 200K tokens)
    
-   Expensive - every token counts toward API costs and speed
    

Memory is what’s stored on disk:

```ini
Memory = MEMORY.md + memory/*.md + Session Transcripts
```

-   Persistent - survives restarts, days, months
    
-   Unbounded - can grow indefinitely
    
-   Cheap - no API cost to store
    
-   Searchable - indexed for semantic retrieval
    

## 

The Memory Tools

The agent accesses memory through two specialized tools:

## 

1\. memory\_search

Purpose: Find relevant memories across all files

```json
{
  "name": "memory_search",
  "description": "Mandatory recall step: semantically search MEMORY.md + memory/*.md before answering questions about prior work, decisions, dates, people, preferences, or todos",
  "parameters": {
    "query": "What did we decide about the API?",
    "maxResults": 6,
    "minScore": 0.35
  }
}
```

```css
{
  "results": [
    {
      "path": "memory/2026-01-20.md",
      "startLine": 45,
      "endLine": 52,
      "score": 0.87,
      "snippet": "## API Discussion\nDecided to use REST over GraphQL for simplicity...",
      "source": "memory"
    }
  ],
  "provider": "openai",
  "model": "text-embedding-3-small"
}
```

## 

2\. memory\_get

Purpose: Read specific content after finding it

```css
{
  "name": "memory_get",
  "description": "Read specific lines from a memory file after memory_search",
  "parameters": {
    "path": "memory/2026-01-20.md",
    "from": 45,
    "lines": 15
  }
}
```

```swift
{
  "path": "memory/2026-01-20.md",
  "text": "## API Discussion\n\nMet with the team to discuss API architecture.\n\n### Decision\nWe chose REST over GraphQL for the following reasons:\n1. Simpler to implement\n2. Better caching\n3. Team familiarity\n\n### Endpoints\n- GET /users\n- POST /auth/login\n- GET /projects/:id"
}
```

## 

Writing to Memory

There is no dedicated memory\_write tool. The agent writes to memory using the standard write and edit tools which it uses for any file. Since memory is just Markdown, you can manually edit these files too (they will be re-indexed automatically).

The decision of where to write is prompt-driven via

:

[

![Image](https://pbs.twimg.com/media/G_l62FfbYAAe439?format=png&name=900x900)



](https://x.com/manthanguptaa/article/2015780646770323543/media/2015777377830526976)

Automatic writes also occur during pre-compaction flush and session end (covered in later sections).

## 

Memory Storage

Clawdbot’s memory system is built on the principle that “Memory is plain Markdown in the agent workspace.”

## 

Two-Layer Memory System

Memory lives in the agent’s workspace (default: ~/clawd/):

```vbnet
~/clawd/
├── MEMORY.md              - Layer 2: Long-term curated knowledge
└── memory/
    ├── 2026-01-26.md      - Layer 1: Today's notes
    ├── 2026-01-25.md      - Yesterday's notes
    ├── 2026-01-24.md      - ...and so on
    └── ...
```

Layer 1: Daily Logs (memory/YYYY-MM-DD.md)

These are append-only daily notes that the agent writes here throughout the day. The agent writes this when the agent wants to remember something or when explicitly told to remember something.

```bash
# 2026-01-26

## 10:30 AM - API Discussion
Discussed REST vs GraphQL with user. Decision: use REST for simplicity.
Key endpoints: /users, /auth, /projects.

## 2:15 PM - Deployment
Deployed v2.3.0 to production. No issues.

## 4:00 PM - User Preference
User mentioned they prefer TypeScript over JavaScript.
```

Layer 2: Long-term Memory (

)

This is curated, persistent knowledge. Agent writes to this when significant events, thoughts, decisions, opinions, and lessons are learned.

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

## 

How the Agent Knows to Read Memory

The

file (which is automatically loaded) contains instructions:

```csharp
## Every Session

Before doing anything else:
1. Read SOUL.md - this is who you are
2. Read USER.md - this is who you are helping
3. Read memory/YYYY-MM-DD.md (today and yesterday) for recent context
4. If in MAIN SESSION (direct chat with your human), also read MEMORY.md

Don't ask permission, just do it.
```

## 

How Memory Gets Indexed

When you save a memory file, here’s what happens behind the scenes:

```sql
┌─────────────────────────────────────────────────────────────┐
│  1. File Saved                                              │
│     ~/clawd/memory/2026-01-26.md                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  2. File Watcher Detects Change                             │
│     Chokidar monitors MEMORY.md + memory/**/*.md            │
│     Debounced 1.5 seconds to batch rapid writes             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Chunking                                                │
│     Split into ~400 token chunks with 80 token overlap      │
│                                                             │
│     ┌────────────────┐                                      │
│     │ Chunk 1        │                                      │
│     │ Lines 1-15     │──────┐                               │
│     └────────────────┘      │                               │
│     ┌────────────────┐      │ (80 token overlap)            │
│     │ Chunk 2        │◄─────┘                               │
│     │ Lines 12-28    │──────┐                               │
│     └────────────────┘      │                               │
│     ┌────────────────┐      │                               │
│     │ Chunk 3        │◄─────┘                               │
│     │ Lines 25-40    │                                      │
│     └────────────────┘                                      │
│                                                             │
│     Why 400/80? Balances semantic coherence vs granularity. │
│     Overlap ensures facts spanning chunk boundaries are     │
│     captured in both. Both values are configurable.         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Embedding                                               │
│     Each chunk -> embedding provider -> vector              │
│                                                             │
│     "Discussed REST vs GraphQL" ->                          │
│         OpenAI/Gemini/Local ->                              │
│         [0.12, -0.34, 0.56, ...]  (1536 dimensions)         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Storage                                                 │
│     ~/.clawdbot/memory/<agentId>.sqlite                     │
│                                                             │
│     Tables:                                                 │
│     - chunks (id, path, start_line, end_line, text, hash)   │
│     - chunks_vec (id, embedding)      -> sqlite-vec         │
│     - chunks_fts (text)               -> FTS5 full-text     │
│     - embedding_cache (hash, vector)  -> avoid re-embedding │
└─────────────────────────────────────────────────────────────┘
```

> sqlite-vec is a SQLite extension that enables vector similarity search directly in SQLite, no external vector database required.

> FTS5 is SQLite’s built-in full-text search engine that powers the BM25 keyword matching. Together, they allow Clawdbot to run hybrid search (semantic + keyword) from a single lightweight database file.

## 

How Memory is Searched

When you search memory, Clawdbot runs two search strategies in parallel. Vector search (semantic) finds content that means the same thing and BM25 search (keyword) finds content with exact tokens.

The results are combined with weighted scoring:

```ini
finalScore = (0.7 * vectorScore) + (0.3 * textScore)
```

Why 70/30? Semantic similarity is the primary signal for memory recall, but BM25 keyword matching catches exact terms that vectors might miss (names, IDs, dates). Results below a minScore threshold (default 0.35) are filtered out. All these values are configurable.

This ensures you get good results whether you are searching for concepts (“that database thing”) or specifics (“POSTGRES\_URL”).

## 

Multi-Agent Memory

Clawdbot supports multiple agents, each with complete memory isolation:

```perl
~/.clawdbot/memory/              # State directory (indexes)
├── main.sqlite                  # Vector index for "main" agent
└── work.sqlite                  # Vector index for "work" agent

~/clawd/                         # "main" agent workspace (source files)
├── MEMORY.md
└── memory/
    └── 2026-01-26.md

~/clawd-work/                    # "work" agent workspace (source files)
├── MEMORY.md
└── memory/
    └── 2026-01-26.md
```

The Markdown files (source of truth) live in each workspace, while the SQLite indexes (derived data) live in the state directory. Each agent gets its own workspace and index. The memory manager is keyed by agentId + workspaceDir, so no cross-agent memory search happens automatically.

Can agents read each other’s memories? Not by default. Each agent only sees its own workspace. However, the workspace is a soft sandbox (default working directory), not a hard boundary. An agent could theoretically access another workspace using absolute paths unless you enable strict sandboxing.

This isolation is useful for separating contexts. A “personal” agent for WhatsApp and a “work” agent for Slack, each with distinct memories and personalities.

## 

Compaction

Every AI model has a context window limit. Claude has 200K tokens, GPT-5.1 has 1M. Long conversations eventually hit this wall.

When that happens, Clawdbot uses compaction: summarizing older conversation into a compact entry while keeping recent messages intact.

```sql
┌─────────────────────────────────────────────────────────────┐
│  Before Compaction                                          │
│  Context: 180,000 / 200,000 tokens                          │
│                                                             │
│  [Turn 1] User: "Let's build an API"                        │
│  [Turn 2] Agent: "Sure! What endpoints do you need?"        │
│  [Turn 3] User: "Users and auth"                            │
│  [Turn 4] Agent: *creates 500-line schema*                  │
│  [Turn 5] User: "Add rate limiting"                         │
│  [Turn 6] Agent: *modifies code*                            │
│  ... (100 more turns) ...                                   │
│  [Turn 150] User: "What's the status?"                      │
│                                                             │
│  ⚠️ APPROACHING LIMIT                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Compaction Triggered                                       │
│                                                             │
│  1. Summarize turns 1-140 into a compact summary            │
│  2. Keep turns 141-150 intact (recent context)              │
│  3. Persist summary to JSONL transcript                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  After Compaction                                           │
│  Context: 45,000 / 200,000 tokens                           │
│                                                             │
│  [SUMMARY] "Built REST API with /users, /auth endpoints.    │
│   Implemented JWT auth, rate limiting (100 req/min),        │
│   PostgreSQL database. Deployed to staging v2.4.0.          │
│   Current focus: production deployment prep."               │
│                                                             │
│  [Turn 141-150 preserved as-is]                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 

Automatic vs Manual Compaction

Automatic: Triggers when approaching context limit

-   You will see: 🧹 Auto-compaction complete in verbose mode
    
-   The original request will retry with compacted context
    

Manual: Use /compact command

\`/compact\` Focus on decisions and open questions

Unlike some optimizations, compaction persists to disk. The summary is written to the session’s JSONL transcript file, so future sessions start with the compacted history.

## 

The Memory Flush

LLM-based compaction is a lossy process. Important information may be summarized away and potentially lost. To counter that, Clawdbot uses the pre-compaction memory flush.

```sql
┌─────────────────────────────────────────────────────────────┐
│  Context Approaching Limit                                  │
│                                                             │
│  ████████████████████████████░░░░░░░░  75% of context       │
│                              ↑                              │
│                    Soft threshold crossed                   │
│                    (contextWindow - reserve - softThreshold)│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Silent Memory Flush Turn                                   │
│                                                             │
│  System: "Pre-compaction memory flush. Store durable        │
│           memories now (use memory/YYYY-MM-DD.md).          │
│           If nothing to store, reply with NO_REPLY."        │
│                                                             │
│  Agent: reviews conversation for important info           │
│         writes key decisions/facts to memory files        │
│         -> NO_REPLY (user sees nothing)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Compaction Proceeds Safely                                 │
│                                                             │
│  Important information is now on disk                       │
│  Compaction can proceed without losing knowledge            │
└─────────────────────────────────────────────────────────────┘
```

The memory flush is configurable in clawdbot.yaml file or clawdbot.json file.

```yaml
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write lasting notes to memory/YYYY-MM-DD.md; reply NO_REPLY if nothing to store."
        }
      }
    }
  }
}
```

## 

Pruning

Tool results can be huge. A single exec command might output 50,000 characters of logs. Pruning trims these old outputs without rewriting history. It is a lossy process and the old outputs are not recoverable.

```sql
┌─────────────────────────────────────────────────────────────┐
│  BEFORE PRUNING (in-memory)                                 │
│                                                             │
│  Tool Result (exec): [50,000 chars of npm install output]   │
│  Tool Result (read): [Large config file, 10,000 chars]      │
│  Tool Result (exec): [Build logs, 30,000 chars]             │
│  User: "Did the build succeed?"                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Soft trim + hard clear)
┌─────────────────────────────────────────────────────────────┐
│  AFTER PRUNING (sent to model)                              │
│                                                             │
│  Tool Result (exec): "npm WARN deprecated...[truncated]     │
│                       ...Successfully installed."           │
│  Tool Result (read): "[Old tool result content cleared]"    │
│  Tool Result (exec): [Kept - too recent to prune]           │
│  User: "Did the build succeed?"                             │
└─────────────────────────────────────────────────────────────┘
```

JSONL file on disk: UNCHANGED (full outputs still there)

## 

Cache-TTL Pruning

Anthropic caches prompt prefixes for up to 5 minutes to reduce latency and cost on repeated calls. When the same prompt prefix is sent within the TTL window, cached tokens cost ~90% less. After the TTL expires, the next request must re-cache the entire prompt.

The problem: if a session goes idle past the TTL, the next request loses the cache and must re-cache the full conversation history at full “cache write” pricing.

Cache-TTL pruning solves this by detecting when the cache has expired and trimming old tool results before the next request. Smaller prompt to re-cache means lower cost:

```yaml
{
  agent: {
    contextPruning: {
      mode: "cache-ttl",      // Only prune after cache expires
      ttl: "600",              // Match your cacheControlTtl
      keepLastAssistants: 3,  // Protect recent tool results
      softTrim: {
        maxChars: 4000,
        headChars: 1500,
        tailChars: 1500
      },
      hardClear: {
        enabled: true,
        placeholder: "[Old tool result content cleared]"
      }
    }
  }
}
```

## 

Session Lifecycle

Sessions don’t last forever. They reset based on configurable rules, creating natural boundaries for memory. The default behaviour is reset everyday. But there are other modes available.

[

![Image](https://pbs.twimg.com/media/G_l8JPUWoAA1FpY?format=png&name=900x900)



](https://x.com/manthanguptaa/article/2015780646770323543/media/2015778806397575168)

## 

Session Memory Hook

When you run /new to start a fresh session, the session memory hook can automatically save context:

```vbnet
/new
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  SESSION-MEMORY HOOK TRIGGERED                              │
│                                                             │
│  1. Extract last 15 messages from ending session            │
│  2. Generate descriptive slug via LLM                       │
│  3. Save to ~/clawd/memory/2026-01-26-api-design.md         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  NEW SESSION STARTS                                         │
│                                                             │
│  Previous context is now searchable via memory_search       │
└─────────────────────────────────────────────────────────────┘
```

## 

Conclusion

Clawdbot’s memory system succeeds because it embraces several key principles:

1\. Transparency Over Black Boxes

Memory is plain Markdown. You can read it, edit it, and version control it. No opaque databases or proprietary formats.

Rather than stuffing context with everything, the agent searches for what’s relevant. This keeps context focused and costs down.

3\. Persistence Over Session

Important information survives in files on disk, not just in conversation history. Compaction can’t destroy what’s already saved.

Vector search alone misses exact matches. Keyword search alone misses semantics. Hybrid gives you both.

## 

References

-   \- Official docs covering setup, configuration, and all features
    
-   \- Source code, issues, and community contributions
    

If you found this interesting, I would love to hear your thoughts. Share it on

,

, or reach out at guptaamanthan01\[at\]gmail\[dot\]com.

You can find more blogs from me on