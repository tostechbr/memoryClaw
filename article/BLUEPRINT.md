# Akashic Context — Product Blueprint

> Última atualização: 6 de fevereiro de 2026 (v2 — adicionado Sprint 0: Multi-User Isolation)

---

## 1. Visão do Produto

### O que é

**Akashic Context** é um motor de memória e contexto para agentes de IA.  
Resolve o problema fundamental: **agentes de IA não lembram de nada entre sessões.**

### A dor do mercado

```
Todo mundo conectando LLM ao n8n, Claude Desktop, Cursor...
Mas TODOS enfrentam o mesmo problema:

  ❌ O agente esquece o usuário entre sessões
  ❌ Conversas longas estouram a janela de contexto
  ❌ Não existe forma simples de dar memória a um agente
  ❌ Soluções existentes (Pinecone, Qdrant) são caras e complexas
```

### Proposta de valor

```
"Memória plug-and-play para agentes de IA.
 Instala em 2 minutos. Funciona com Markdown.
 Seu agente lembra de tudo."
```

### Público-alvo

| Persona | Dor | Como Akashic resolve |
|---------|-----|----------------------|
| Dev que usa n8n com IA | Agente não lembra do usuário | Memória persistente via MCP |
| Dev que usa Claude Desktop | CLAUDE.md é limitado e manual | Memória automática e buscável |
| Empresas com chatbots | Bot repete perguntas, frustra cliente | Histórico semântico do cliente |
| Makers/no-code | Não sabe configurar Pinecone | Markdown + SQLite, zero infra |

---

## 2. Estado Atual (Auditoria do Código)

### O que EXISTE e FUNCIONA

| Componente | Arquivo | Status | Observação |
|------------|---------|--------|------------|
| **Chunking Markdown** | `core/memory/chunking.ts` | ✅ Sólido | ~400 tokens, 80 overlap, com hash |
| **SQLite + FTS5** | `core/memory/storage.ts` | ✅ Sólido | Schema completo, embedding_cache, keyword search |
| **Busca BM25 (keyword)** | `core/memory/hybrid.ts` | ✅ Funcional | Merge ponderado (70/30), buildFtsQuery |
| **Memory Manager** | `core/memory/manager.ts` | ✅ Funcional | Sync, file watcher (chokidar), indexação |
| **OpenAI Provider** | `core/memory/providers/openai.ts` | ✅ Funcional | text-embedding-3-small |
| **MCP Server** | `mcp-server/src/index.ts` | ✅ Funcional | 4 tools: search, get, store, delete |
| **Path security** | `mcp-server/src/index.ts` | ✅ Sólido | Traversal protection, .md only, size limits |
| **Types** | `core/src/types.ts` | ✅ Completo | Message, Memory, Context, Engine, Session types |
| **Token estimation** | `core/utils/tokens.ts` | ⚠️ Básico | Apenas estimativa (chars/4), sem tiktoken real |

### O que EXISTE mas NÃO FUNCIONA

| Componente | Arquivo | Status | Problema |
|------------|---------|--------|----------|
| **Vector search (sqlite-vec)** | `storage.ts` | 🔴 Preparado, não funciona | Código pronto, mas extensão .dylib não carrega |
| **Hybrid merge (vector)** | `hybrid.ts` | 🟡 Parcial | Algoritmo pronto, mas sem vector results entra só keyword |

### O que NÃO EXISTE (pasta vazia ou types sem implementação)

| Componente | Local esperado | Status | Impacto |
|------------|---------------|--------|---------|
| **⚠️ Multi-User Isolation** | `mcp-server/`, `manager.ts` | 🔴 **CRÍTICO** | **Zero isolamento entre usuários — BLOQUEIO para produção** |
| **Context Manager** | `core/src/context/` | 🔴 Pasta vazia | Sem gestão de janela de contexto |
| **Token Counting real** | `core/utils/tokens.ts` | 🔴 Só estimativa | Não sabe quantos tokens reais estão em uso |
| **Compaction** | não existe | 🔴 Zero | Conversas longas vão estourar |
| **Memory Flush** | não existe | 🔴 Zero | Não salva antes de compactar |
| **Pruning** | não existe | 🔴 Zero | Resultados grandes de tools não são cortados |
| **Session Manager** | não existe | 🔴 Zero | Sem controle de sessão |
| **HTTP Adapter** | não existe | 🔴 Zero | Só funciona local (stdio) |

### ⚠️ GAP CRÍTICO: Multi-User Isolation

**Descoberto em**: 6 de fevereiro de 2026

O sistema atual trata **todos os usuários como um só**. Não existe parâmetro `userId` em nenhuma tool MCP. Todas as chamadas leem/escrevem no mesmo workspace e banco de dados.

**Cenário real que quebra**:
```
Bot WhatsApp conectado ao n8n + Akashic Context:

1. Maria envia: "Meu nome é Maria, trabalho na TechCorp"
   → memory_store({ path: "memory/perfil.md", content: "Maria, TechCorp" })

2. João envia: "Meu nome é João, sou freelancer"
   → memory_store({ path: "memory/perfil.md", content: "João, freelancer" })
   → ❌ SOBRESCREVE o perfil da Maria!

3. Maria pergunta: "Qual meu nome?"
   → memory_search({ query: "meu nome" })
   → ❌ Retorna "João, freelancer" (dados do João!)
```

**Impacto**: Impossível usar em produção com múltiplos usuários. É um BLOQUEIO.

**Solução**: Sprint 0 (antes de qualquer feature nova).

### Arquitetura atual

```
┌─────────────────────────────────────┐
│  n8n / Claude Desktop / Cursor      │  ← Consumidores
└──────────────┬──────────────────────┘
               │ MCP Protocol (stdio)
               ▼
┌─────────────────────────────────────┐
│  MCP Server                         │
│  Tools: search, get, store, delete  │
│  Security: path traversal, .md only │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Core Library                       │
│                                     │
│  ┌──────────┐ ┌──────────┐         │
│  │ Chunking │ │ Storage  │         │
│  │ 400 tok  │ │ SQLite   │         │
│  │ 80 over  │ │ FTS5     │         │
│  └──────────┘ └──────────┘         │
│                                     │
│  ┌──────────┐ ┌──────────┐         │
│  │ Hybrid   │ │ Manager  │         │
│  │ Search   │ │ Sync +   │         │
│  │ BM25 only│ │ Watcher  │         │
│  └──────────┘ └──────────┘         │
│                                     │
│  ┌──────────┐                       │
│  │ Context  │ ← VAZIO              │
│  │ Manager  │                       │
│  └──────────┘                       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Markdown Files                     │
│  MEMORY.md + memory/*.md            │
└─────────────────────────────────────┘
```

---

## 3. Os Dois Pilares Fundamentais

Antes de qualquer feature avançada, o Akashic precisa de dois pilares sólidos:

### Pilar 1: Memória de Qualidade — "Lembrar certo"

> O agente precisa **encontrar** a informação certa, **mesmo sem saber a palavra exata**.

```
HOJE (keyword only):
  Usuário pergunta: "o que combinamos sobre a migração?"
  Memória tem: "João precisa de ajuda com o projeto de replatforma"
  Resultado: ❌ Nenhum match (palavras diferentes)

META (hybrid search):
  Mesma pergunta → ✅ Encontra por SIGNIFICADO (semântica)
```

**O que falta para chegar lá:**

| # | Tarefa | Complexidade | Dependência |
|---|--------|-------------|-------------|
| 1.1 | Carregar sqlite-vec corretamente | Média | Nenhuma |
| 1.2 | Implementar vector search end-to-end | Média | 1.1 |
| 1.3 | Validar hybrid merge com testes reais | Baixa | 1.2 |
| 1.4 | Tuning de pesos (vector vs keyword) | Baixa | 1.3 |

### Pilar 2: Gestão de Contexto — "Saber o que cabe na cabeça"

> Conversas longas **estouram** a janela de contexto. O sistema precisa gerenciar isso automaticamente.

```
HOJE:
  Conversa com 100 mensagens → Tokens crescem sem controle
  → Eventualmente estoura o limite do modelo
  → Erro ou perda de contexto

META:
  Token counting → Detecta que está chegando no limite
  → Memory Flush → Salva informações importantes
  → Compaction → Resume conversa antiga
  → Pruning → Corta resultados de tools gigantes
  → Sessão continua fluindo
```

**O que falta para chegar lá:**

| # | Tarefa | Complexidade | Dependência |
|---|--------|-------------|-------------|
| 2.1 | Token counting real (tiktoken) | Baixa | Nenhuma |
| 2.2 | Context Window Guard (thresholds) | Média | 2.1 |
| 2.3 | Memory Flush (salvar antes de compactar) | Média | 2.2 |
| 2.4 | Compaction (resumir conversa antiga) | Alta | 2.3 |
| 2.5 | Pruning (cortar tool results grandes) | Média | 2.1 |

---

## 4. Roadmap — Sprints de Implementação

### Visão geral das fases

```
SPRINT 0          SPRINT 1          SPRINT 2          SPRINT 3          SPRINT 4
─────────         ─────────         ─────────         ─────────         ─────────
Multi-User        Busca             Contexto          Sessões           Distribuição
Isolation         Semântica         Inteligente       & Lifecycle       & Produto

userId param      sqlite-vec        Token Count       Session Mgr       HTTP Adapter
Per-user DB       Vector Search     Thresholds        Transcripts       n8n Custom Node
Per-user files    Hybrid Merge      Memory Flush      Auto-save         Deploy Cloud
Isolation tests   Testes            Compaction        Cache-TTL         Documentação
n8n WhatsApp                        Pruning

3-5 dias          1-2 semanas       2-3 semanas       2 semanas         1-2 semanas
```

---

### Sprint 0: Multi-User Isolation (3-5 dias) ⚠️ BLOQUEIO

**Objetivo**: Cada usuário tem memória **completamente isolada**. Sem isso, nenhum uso em produção é possível.

**Por quê ANTES de tudo**: Sem isolamento, o bot WhatsApp da Maria mostra dados do João. É um problema de **privacidade e segurança**, não de feature.

#### Tarefas

| # | Tarefa | Arquivo | Descrição |
|---|--------|---------|-----------|
| 0.1 | **userId em todas as MCP tools** | `mcp-server/index.ts` | Adicionar parâmetro `userId` (string, optional) em search, get, store, delete. Default: `"default"`. |
| 0.2 | **Per-user workspace** | `manager.ts` | Workspace muda para `{dataDir}/users/{userId}/`. Cada user tem seu MEMORY.md e memory/*.md. |
| 0.3 | **Per-user database** | `storage.ts` | DB muda para `{dataDir}/users/{userId}/memory.db`. Total isolamento. |
| 0.4 | **MemoryManager pool** | `mcp-server/index.ts` | Pool de MemoryManagers por userId. Lazy init: cria quando primeiro request chega. |
| 0.5 | **Testes de isolamento** | `integration.test.ts` | User A armazena → User B não encontra. User A deleta → User B não afetado. |
| 0.6 | **Backward compatibility** | `mcp-server/index.ts` | Sem userId → usa `"default"`. Migração: workspace atual vira user `"default"`. |
| 0.7 | **n8n WhatsApp workflow** | `examples/` | Workflow exemplo: webhook WhatsApp → extrair phone → passar como userId. |

#### Arquitetura de isolamento

```
ANTES (tudo junto):
{dataDir}/
├── memory.db            ← UM banco para todos
├── MEMORY.md            ← UM arquivo para todos
└── memory/*.md

DEPOIS (isolado por usuário):
{dataDir}/
├── users/
│   ├── 5511999990000/   ← Maria (WhatsApp phone)
│   │   ├── memory.db
│   │   ├── MEMORY.md
│   │   └── memory/
│   │       └── perfil.md
│   ├── 5511888880000/   ← João
│   │   ├── memory.db
│   │   ├── MEMORY.md
│   │   └── memory/
│   │       └── perfil.md
│   └── default/         ← Backward compatible
│       ├── memory.db
│       ├── MEMORY.md
│       └── memory/*.md
└── shared/              ← (futuro) memória global
```

#### Fluxo no n8n (WhatsApp)

```
WhatsApp Webhook
    │
    ▼
Extract Phone: {{ $json.from }}  →  userId = "5511999990000"
    │
    ▼
MCP Tool: memory_search({
  query: "{{ $json.message }}",
  userId: "{{ $json.from }}"    ← ISOLADO por telefone
})
    │
    ▼
AI Agent responde com memória DO USUÁRIO CORRETO
```

#### Critérios de aceite

- [ ] Cada userId tem seu próprio `memory.db` e `memory/*.md`
- [ ] User A armazena → User B NÃO encontra
- [ ] User A deleta → User B NÃO é afetado
- [ ] Sem userId → funciona como `"default"` (backward compatible)
- [ ] Workflow n8n WhatsApp funciona com phone como userId
- [ ] Pool de MemoryManagers não vaza memória (max 100 users, LRU)

#### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Muitos users = muitos DBs abertos | Média | Pool com LRU (max 50 connections) |
| Migração quebra workspace existente | Baixa | Default user = workspace raiz |
| userId com caracteres especiais | Média | Sanitizar: só alfanumérico, _, - |

---

### Sprint 1: Busca Semântica (1-2 semanas)

**Objetivo**: O agente encontra informações por **significado**, não só por palavras-chave.

**Por quê primeiro**: A busca é o **core** do produto. Se busca ruim → memória inútil.

#### Tarefas

| # | Tarefa | Arquivo | Descrição |
|---|--------|---------|-----------|
| 1.1 | **Carregar sqlite-vec** | `storage.ts` | Resolver carregamento do `vec0.dylib` por plataforma (macOS/Linux). Distribuir binário ou usar npm package se disponível. |
| 1.2 | **Vector search end-to-end** | `storage.ts`, `manager.ts` | Garantir que embeddings vão para `chunks_vec`, e que `searchVector()` retorna resultados. |
| 1.3 | **Validar hybrid merge** | `hybrid.test.ts` | Criar testes com dados reais: query ≠ texto literal, mas mesmo significado. Validar que vector encontra o que keyword não encontra. |
| 1.4 | **Tuning de pesos** | `hybrid.ts` | Testar diferentes proporções (70/30, 80/20, 60/40). Medir precision/recall com dataset de teste. |
| 1.5 | **Fallback gracioso** | `manager.ts` | Se sqlite-vec falha, degradar para keyword-only sem erro. Já parcialmente implementado. |

#### Critérios de aceite

- [ ] `pnpm test` passa com vector search ativo
- [ ] Query semântica retorna resultado relevante mesmo sem keyword match
- [ ] Busca hybrid > keyword-only em benchmark de 10 queries
- [ ] Funciona em macOS e Linux

#### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| sqlite-vec não funciona no ambiente | Média | Testar logo; ter fallback keyword-only |
| Embeddings caros para muitos chunks | Baixa | Cache por hash já existe |
| Qualidade dos embeddings baixa | Baixa | OpenAI text-embedding-3-small é bom |

---

### Sprint 2: Gestão de Contexto (2-3 semanas)

**Objetivo**: O sistema **gerencia automaticamente** a janela de contexto — conta tokens, comprime quando preciso, salva antes de perder.

**Por quê segundo**: Sem isso, conversas longas **quebram**. É o que transforma Akashic de "buscador" em "motor de contexto".

#### Tarefas

| # | Tarefa | Arquivo | Descrição |
|---|--------|---------|-----------|
| 2.1 | **Token counting real** | `utils/tokens.ts` | Trocar estimativa por `tiktoken` real. Suportar múltiplos modelos (gpt-4, claude, etc). |
| 2.2 | **Context Window Guard** | `context/guard.ts` (novo) | Monitorar uso de tokens. Definir thresholds: soft (aviso), hard (ação). Defaults: soft=176K, hard=190K para 200K window. |
| 2.3 | **Memory Flush** | `context/flush.ts` (novo) | Quando soft threshold atingido: pedir ao LLM para salvar informações importantes em `memory/YYYY-MM-DD.md`. Safety net antes de compactar. |
| 2.4 | **Compaction** | `context/compact.ts` (novo) | Quando hard threshold atingido: resumir mensagens antigas com LLM. Manter últimas N mensagens intactas. Meta: 70% redução. |
| 2.5 | **Pruning** | `context/pruner.ts` (novo) | Duas passagens: Soft trim (cortar tool results > 50K chars para 4K). Hard clear (substituir por placeholder). |
| 2.6 | **MCP Tool: context_status** | `mcp-server/index.ts` | Nova tool que retorna: tokens usados, threshold %, memórias indexadas. Permite ao agente decidir quando salvar. |

#### Arquitetura do Context Manager

```
┌────────────────────────────────────────────────┐
│  Context Manager                                │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Guard   │───▶│  Flush   │───▶│ Compact  │  │
│  │          │    │          │    │          │  │
│  │ "Quantos │    │ "Salva   │    │ "Resume  │  │
│  │  tokens  │    │  antes   │    │  o que é │  │
│  │  tenho?" │    │  de      │    │  antigo" │  │
│  │          │    │  perder" │    │          │  │
│  └──────────┘    └──────────┘    └──────────┘  │
│       │                               │         │
│       ▼                               ▼         │
│  ┌──────────┐                   ┌──────────┐   │
│  │  Pruner  │                   │  Token   │   │
│  │          │                   │  Counter │   │
│  │ "Corta   │                   │          │   │
│  │  o que é │                   │ tiktoken │   │
│  │  grande" │                   │  real    │   │
│  └──────────┘                   └──────────┘   │
└────────────────────────────────────────────────┘
```

#### Critérios de aceite

- [ ] Token count acurado (< 5% de erro vs tiktoken direto)
- [ ] Compaction reduz contexto em >= 60%
- [ ] Memory flush salva arquivo antes de compaction
- [ ] Pruning reduz tool results de 50K → 4K chars
- [ ] Context status tool retorna métricas corretas

#### Fluxo: O que acontece quando o contexto cresce

```
Tokens: 0K ──────────────────────────────── 200K
        │                                     │
        │  Normal operation                   │
        │  ────────────────────────>          │
        │                          │          │
        │                   176K   │          │
        │               SOFT ──────┤          │
        │               │          │          │
        │               │ Flush    │          │
        │               │ (salva)  │          │
        │               │          │  190K    │
        │               │     HARD ┤──────┤   │
        │               │          │      │   │
        │               │          │ Comp │   │
        │               │          │ act  │   │
        │               │          │      │   │
        │               │          │  ──▶55K  │
        │               │          │      │   │
        │               │  Continua normal│   │
        │               │          ──────▶│   │
```

---

### Sprint 3: Sessões & Lifecycle (2 semanas)

**Objetivo**: Controle de sessão — saber quando começou, quando resetar, como salvar transcrições.

#### Tarefas

| # | Tarefa | Arquivo | Descrição |
|---|--------|---------|-----------|
| 3.1 | **Session Manager** | `context/session.ts` (novo) | Criar/destruir sessões. Reset modes: daily, manual, never. |
| 3.2 | **Session Transcripts** | `context/transcripts.ts` (novo) | Salvar sessões em JSONL. Buscar sessões antigas. |
| 3.3 | **Auto-save hook** | `context/hooks.ts` (novo) | Quando sessão termina (ou /new), salvar resumo em memory/. |
| 3.4 | **Cache-TTL Pruning** | `context/cache-ttl.ts` (novo) | Otimização para Anthropic: prunar quando cache expira (5min). |
| 3.5 | **MCP Tools: session** | `mcp-server/index.ts` | Tools: `session_new`, `session_status`, `session_history`. |

#### Critérios de aceite

- [ ] Sessão reseta corretamente por modo (daily/manual)
- [ ] Transcripts salvos em JSONL legível
- [ ] Hook de auto-save funciona no fim da sessão
- [ ] Cache-TTL reduz custos em >= 30% para Anthropic

---

### Sprint 4: Distribuição & Produto (1-2 semanas)

**Objetivo**: Tornar Akashic distribuível — funcionar além do local, ter instalação simples.

#### Tarefas

| # | Tarefa | Arquivo | Descrição |
|---|--------|---------|-----------|
| 4.1 | **HTTP Adapter** | `packages/http-server/` (novo) | REST API: `/search`, `/store`, `/get`, `/delete`, `/status`. Auth via API key. |
| 4.2 | **n8n Custom Node** | `packages/n8n-node/` (novo) | Node nativo do n8n que conecta direto ao Akashic (HTTP ou MCP). |
| 4.3 | **Deploy cloud** | `Dockerfile`, docs | Railway/Fly.io/Render. Environment variables. Health check. |
| 4.4 | **Documentação produto** | `docs/` | Quick start em 2 min. Vídeo demo. Exemplos de uso. |
| 4.5 | **npm publish** | `packages/core/` | Publicar `akashic-context` no npm. |

#### Critérios de aceite

- [ ] HTTP API respondendo < 500ms
- [ ] n8n Custom Node instalável via Community Nodes
- [ ] Deploy funciona 24/7 em cloud provider
- [ ] npm install akashic-context funciona

---

## 5. Arquitetura Alvo (pós Sprint 4)

```
┌─────────────────────────────────────────────────────────────────┐
│  CONSUMIDORES                                                    │
│                                                                  │
│  ┌───────┐  ┌──────────────┐  ┌────────┐  ┌──────────┐         │
│  │  n8n  │  │ Claude Desk  │  │ Cursor │  │ Custom   │         │
│  │       │  │              │  │        │  │  Apps    │         │
│  └───┬───┘  └──────┬───────┘  └───┬────┘  └────┬─────┘         │
│      │             │              │             │               │
│      └─────────────┴──────┬───────┴─────────────┘               │
│                           │                                      │
│                    ┌──────┴──────┐                               │
│                    │  MCP / HTTP │  ← Transporte                │
│                    │  + userId   │  ← Isolamento por usuário    │
│                    └──────┬──────┘                               │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│  AKASHIC CONTEXT ENGINE   │                                      │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  User Isolation Layer                                     │   │
│  │  userId → Per-user workspace + database (LRU pool)        │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                              │                                    │
│  ┌──────────────────────────┼───────────────────────────────┐   │
│  │  Tool Layer (MCP Tools)  │                                │   │
│  │  memory_search │ memory_store │ memory_get │ memory_delete│   │
│  │  context_status│ session_new  │ session_history           │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                              │                                    │
│  ┌───────────────────────────┼──────────────────────────────┐   │
│  │  Memory Layer             │                               │   │
│  │                           ▼                               │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│  │  │ Chunking │  │   Storage    │  │   Hybrid Search  │   │   │
│  │  │ 400 tok  │  │ SQLite+FTS5  │  │ Vector + BM25    │   │   │
│  │  │ 80 over  │  │ sqlite-vec   │  │ 70/30 merge      │   │   │
│  │  └──────────┘  │ embed_cache  │  └──────────────────┘   │   │
│  │                └──────────────┘                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Context Layer                                            │   │
│  │                                                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │   │
│  │  │  Token   │  │  Guard   │  │  Flush   │  │ Compact │ │   │
│  │  │  Counter │  │  Soft/   │  │  Pre-    │  │ LLM     │ │   │
│  │  │ tiktoken │  │  Hard    │  │  compact │  │ summary │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │   │
│  │                                                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐       │   │
│  │  │  Pruner  │  │ Session  │  │   Transcripts    │       │   │
│  │  │ Soft/    │  │ Manager  │  │   JSONL storage  │       │   │
│  │  │ Hard     │  │ Lifecycle│  │                  │       │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Storage Layer (PER USER)                                 │   │
│  │  users/{userId}/MEMORY.md + memory/*.md                   │   │
│  │  users/{userId}/memory.db (chunks, embeddings, cache)     │   │
│  │  users/{userId}/sessions/*.jsonl                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Decisões Técnicas

### Por que Markdown?

| Vantagem | Descrição |
|----------|-----------|
| **Legível** | Humano consegue ler e editar direto |
| **Git-friendly** | Versionável, diff legível, PR review |
| **Portável** | Funciona em qualquer lugar, sem lock-in |
| **Simples** | Zero infra extra — é só um arquivo |

### Por que SQLite (e não Postgres/Redis)?

| Vantagem | Descrição |
|----------|-----------|
| **Zero infra** | Não precisa de servidor de banco |
| **Embarcável** | Vem junto com a aplicação |
| **FTS5** | Full-text search nativo, BM25 built-in |
| **sqlite-vec** | Busca vetorial sem serviço externo |
| **Performance** | Rápido para workloads de leitura (WAL mode) |

### Por que MCP Protocol?

| Vantagem | Descrição |
|----------|-----------|
| **Padrão aberto** | Suporte em n8n, Claude Desktop, Cursor |
| **Tool-based** | O agente decide quando buscar/salvar |
| **Extensível** | Fácil adicionar novas tools |

### Escolha de embedding model

| Modelo | Dimensão | Custo | Qualidade | Escolha |
|--------|----------|-------|-----------|---------|
| text-embedding-3-small | 1536 | $0.02/1M tokens | Boa | ✅ Default |
| text-embedding-3-large | 3072 | $0.13/1M tokens | Melhor | Opcional |
| Gemini embedding | 768 | Grátis (limites) | Boa | Futuro |
| Local (Ollama) | Variável | Grátis | Variável | Futuro |

---

## 7. Métricas de Sucesso

### Sprint 1 (Busca)

| Métrica | Meta | Como medir |
|---------|------|------------|
| Precision@5 | > 80% | 10 queries de teste, humano avalia top-5 |
| Recall semântico | > keyword-only | Queries sem keyword match literal |
| Latência busca | < 200ms | Timer no search |

### Sprint 2 (Contexto)

| Métrica | Meta | Como medir |
|---------|------|------------|
| Token count accuracy | < 5% erro | Comparar com tiktoken direto |
| Compaction ratio | >= 60% | tokensBefore / tokensAfter |
| Zero data loss | 100% | Flush salva antes de compactar |

### Sprint 3 (Sessões)

| Métrica | Meta | Como medir |
|---------|------|------------|
| Session persistence | 100% | Sessão restaura após restart |
| Transcript completude | 100% | JSONL contém todas as mensagens |

### Sprint 4 (Produto)

| Métrica | Meta | Como medir |
|---------|------|------------|
| Instalação | < 2 min | Timer com usuário novo |
| API latência | < 500ms | Benchmark HTTP |
| Uptime | > 99% | Monitor em produção |

---

## 8. Riscos & Mitigações

| # | Risco | Impacto | Probabilidade | Mitigação |
|---|-------|---------|---------------|-----------|
| 0 | **Sem multi-user = vazamento de dados** | **Crítico** | **Certeza** | **Sprint 0: userId isolation (BLOQUEIO)** |
| 1 | sqlite-vec não funciona cross-platform | Alto | Média | Fallback keyword-only; testar CI em macOS + Linux |
| 2 | Compaction perde informação importante | Alto | Média | Memory Flush SEMPRE roda antes; keep last N turns |
| 3 | Custo de embeddings escala | Médio | Baixa | Cache por hash (já existe); Batch API (50% off) |
| 4 | n8n muda MCP protocol | Médio | Baixa | Manter HTTP adapter como alternativa |
| 5 | Concorrência em SQLite | Baixo | Baixa | WAL mode; DB por usuário |
| 6 | Muitos users = muitos DBs abertos | Médio | Média | Pool LRU (max 50 connections), lazy init |

---

## 9. Caminho de Produto (pós-validação)

Depois dos 4 sprints, decidir entre:

### Opção A: n8n Community Node

```
Distribuição: npm (n8n community nodes)
Modelo: Open source
Revenue: Doações / Sponsor / Consultoria
Vantagem: Adoção rápida, visibilidade no ecossistema n8n
```

### Opção B: Produto SaaS (API de Memória)

```
Distribuição: API hospedada
Modelo: Freemium (X buscas grátis/mês)
Revenue: Assinatura mensal
Vantagem: Revenue recorrente, controle
Risco: Precisa de infra, suporte, SLA
```

### Opção C: Open Source + Premium

```
Distribuição: npm + GitHub
Modelo: Core open source, features premium
Revenue: Licença enterprise + consultoria
Vantagem: Comunidade + sustentabilidade
```

**Decisão**: Validar demanda primeiro (vídeo demo, posts LinkedIn), depois decidir baseado em feedback.

---

## 10. Próximo Passo Imediato

**Sprint 0, Tarefa 0.1**: Adicionar `userId` em todas as MCP tools para isolamento multi-user.

```
Arquivo: packages/mcp-server/src/index.ts
Tools afetadas: memory_search, memory_get, memory_store, memory_delete
Parâmetro: userId (string, optional, default: "default")
Status: Não existe — BLOQUEIO para produção
Ação: Implementar userId, per-user workspace, per-user database
```

**MVP validável após Sprint 0**:
```
Bot WhatsApp (n8n) que lembra cada usuário:
1. Maria diz seu nome → memory_store com userId=phone
2. Nova sessão → Maria pergunta "qual meu nome?"
3. memory_search com userId=phone → encontra "Maria"
4. João faz o mesmo → memória ISOLADA da Maria
```

---

*Blueprint criado em 6 de fevereiro de 2026*
*Autor: Tiago Santos + AI Architect*
