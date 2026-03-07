# 🧠 Conceitos Fundamentais - Deep Dive

> Explicação profunda de como Memory & Context Engineering funcionam matematicamente e conceitualmente

## 📋 Índice

1. [Embeddings - O Que São e Como Funcionam](#embeddings)
2. [Vector Search (Cosine Similarity)](#vector-search)
3. [BM25 Search (Keyword Matching)](#bm25-search)
4. [Hybrid Search (Combinando Vector + BM25)](#hybrid-search)
5. [Compaction Algorithms](#compaction-algorithms)
6. [Hyperparameters (Como Escolher)](#hyperparameters)
7. [Trade-offs & Decisões](#trade-offs)

---

## 🎯 Embeddings - O Que São e Como Funcionam

### Conceito Básico

**Embedding** = Representação numérica de texto em um espaço vetorial de alta dimensão.

**Analogia**: Imagina que cada palavra/frase é um ponto em um espaço 3D (na prática são 1536 dimensões!):

```
Espaço 3D (simplificado):

        ↑ y
        │
        │   • "database"
        │  /
        │ /  • "PostgreSQL"
        │/______• "MySQL"________→ x
       /│
      / │
     /  │
    z   │ • "cat"
        │
        │ • "dog"
```

**Propriedades**:
- Palavras **semanticamente similares** ficam **próximas** no espaço
- Palavras **diferentes** ficam **distantes**
- "database" está perto de "PostgreSQL" e "MySQL"
- "database" está longe de "cat" e "dog"

### Como São Gerados?

**1. Neural Network (Deep Learning)**

```
Input Text: "PostgreSQL database"
    ↓
Tokenization: ["Post", "gre", "SQL", "database"]
    ↓
Token IDs: [5299, 15532, 6827, 4729]
    ↓
Embedding Layer (Learned Weights)
    ↓
Mean/Pooling
    ↓
Output Vector: [0.123, -0.456, 0.789, ..., 0.234]
                ↑
            1536 dimensions
```

**Modelos Comuns**:
- **OpenAI**: `text-embedding-3-small` (1536 dims)
- **Google**: `text-embedding-004` (768 dims)
- **Local**: Sentence-BERT (384-768 dims)

**2. Treinamento (Pré-treinado)**

Os modelos são treinados com **bilhões** de pares de texto para aprender:
- Sinônimos ficam próximos
- Antônimos ficam distantes
- Contexto semântico preservado

### Visualização (2D Projection)

Embeddings reais são 1536-D, mas podemos projetá-los em 2D para visualizar:

```
t-SNE Projection (exemplo):

                Technology
                    │
         ┌──────────┼──────────┐
         │          │          │
    "database"  "server"   "API"
         │          │          │
    ┌────┴────┐     │     ┌────┴────┐
    │         │     │     │         │
"PostgreSQL" "MySQL" "AWS" "REST"  "GraphQL"


                Animals
                    │
         ┌──────────┼──────────┐
         │          │          │
      "cat"      "dog"     "bird"
         │          │          │
    ┌────┴────┐     │          │
    │         │     │          │
"kitten"  "feline" "puppy"  "canine"
```

**Observações**:
- Clusters naturais emergem (Technology vs Animals)
- Distância = Dissimilaridade semântica
- Proximidade = Similaridade semântica

### Matemática: Geração de Embedding

**Simplified Model** (conceitual):

```python
# Input text
text = "PostgreSQL database"

# Tokenize
tokens = tokenizer.encode(text)
# [5299, 15532, 6827, 4729]

# Embedding layer (learned matrix)
embedding_matrix = model.get_embedding_layer()
# Shape: (vocab_size, embedding_dim) = (50000, 1536)

# Lookup embeddings
token_embeddings = embedding_matrix[tokens]
# Shape: (4, 1536)

# Pool (mean/CLS token)
embedding = mean(token_embeddings, axis=0)
# Shape: (1536,)

# Normalize (unit vector)
embedding = embedding / norm(embedding)
# Final embedding: [-0.023, 0.145, -0.087, ..., 0.234]
```

**Propriedades Matemáticas**:
- **Unit Vector**: `||embedding|| = 1` (normalized)
- **Dimensionality**: 1536 dimensions (OpenAI)
- **Range**: Each dimension ∈ [-1, 1]

### Custos & Performance

**OpenAI Pricing** (2026):
- `text-embedding-3-small`: **$0.00002 / 1K tokens**
- `text-embedding-3-large`: **$0.00013 / 1K tokens**

**Batch API**:
- 50% cheaper: **$0.00001 / 1K tokens**
- Async processing (24h window)

**Latency**:
- Real-time: ~50-100ms per request
- Batch: Hours (async)

**Storage**:
- 1 embedding = 1536 floats × 4 bytes = **6KB**
- 1000 chunks = **6MB**
- 100K chunks = **600MB**

---

## 🔍 Vector Search (Cosine Similarity)

### O Que É?

**Vector Search** = Encontrar embeddings **mais próximos** de um query embedding no espaço vetorial.

**Métrica Comum**: **Cosine Similarity**

### Cosine Similarity - Matemática

**Definição**:
```
cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)

Onde:
- A · B = dot product (produto escalar)
- ||A|| = norma (magnitude) do vetor A
- ||B|| = norma (magnitude) do vetor B
```

**Interpretação**:
- Resultado ∈ [-1, 1]
- **1** = idênticos (mesmo vetor)
- **0** = ortogonais (sem relação)
- **-1** = opostos

**Visualização 2D**:

```
      ↑ y
      │
      │  • B (0.6, 0.8)
      │ /
      │/ θ = 30°
      │──────• A (0.8, 0.6)────→ x
      │
      O

cos(θ) = cos(30°) ≈ 0.866 (muito similar!)
```

### Exemplo Numérico

```python
# Query embedding (simplified to 5D)
query = [0.2, -0.1, 0.5, 0.3, -0.2]

# Chunk embeddings
chunk1 = [0.3, -0.2, 0.4, 0.4, -0.1]  # "PostgreSQL database"
chunk2 = [0.1,  0.8, -0.3, 0.2,  0.5]  # "cat and dog"

# Cosine similarity
def cosine_similarity(a, b):
    dot_product = sum(x * y for x, y in zip(a, b))
    norm_a = sqrt(sum(x**2 for x in a))
    norm_b = sqrt(sum(x**2 for x in b))
    return dot_product / (norm_a * norm_b)

sim1 = cosine_similarity(query, chunk1)
# = 0.87 (alta similaridade!)

sim2 = cosine_similarity(query, chunk2)
# = 0.23 (baixa similaridade)

# Ranking
results = [
    ("PostgreSQL database", 0.87),  # Rank 1
    ("cat and dog", 0.23)           # Rank 2
]
```

### Cosine Distance

**SQLite-vec** usa **cosine distance** ao invés de similarity:

```
cosine_distance(A, B) = 1 - cosine_similarity(A, B)

Range: [0, 2]
- 0 = idênticos
- 1 = ortogonais
- 2 = opostos
```

**Conversão para Score** (0-1):
```python
score = 1 - cosine_distance
# OU
score = cosine_similarity
```

### SQLite-vec Implementation

**SQL Query**:
```sql
SELECT
    id,
    text,
    (1 - vec_distance_cosine(embedding, ?)) AS score
FROM chunks_vec
WHERE score > 0.35  -- Min threshold
ORDER BY score DESC
LIMIT 20;
```

**Algoritmo Interno** (Approximate Nearest Neighbor):
- **HNSW** (Hierarchical Navigable Small World)
- Sub-linear search time: O(log N)
- Trade-off: Speed vs Accuracy

### Visualização: Vector Search

```
Query: "What database did we choose?"
Embedding: [0.12, -0.34, 0.56, ..., 0.78]

Database (1000 chunks):
┌─────────────────────────────────────────┐
│ Chunk 1: "PostgreSQL chosen..."        │
│ Embedding: [0.15, -0.32, 0.54, ..., 0.76] │
│ Similarity: 0.92 ⭐⭐⭐⭐⭐              │
├─────────────────────────────────────────┤
│ Chunk 42: "Decided to use PostgreSQL..." │
│ Embedding: [0.13, -0.35, 0.57, ..., 0.79] │
│ Similarity: 0.87 ⭐⭐⭐⭐                │
├─────────────────────────────────────────┤
│ Chunk 99: "Database migration from..." │
│ Embedding: [0.10, -0.28, 0.45, ..., 0.70] │
│ Similarity: 0.72 ⭐⭐⭐                  │
├─────────────────────────────────────────┤
│ Chunk 200: "cat and dog playing..."   │
│ Embedding: [-0.50, 0.80, -0.30, ..., 0.10] │
│ Similarity: 0.15 ⭐                     │
└─────────────────────────────────────────┘

Top 3 Results:
1. Chunk 1 (0.92)
2. Chunk 42 (0.87)
3. Chunk 99 (0.72)
```

### Por Que Funciona?

**Semantic Understanding**:
- "database" e "PostgreSQL" têm embeddings similares
- Query "What **database** did we choose?" → matches "**PostgreSQL** chosen"
- Não precisa match exato de palavras!

**Sinônimos Automáticos**:
- "choose" ≈ "decided" ≈ "selected"
- "database" ≈ "DB" ≈ "DBMS"
- Embeddings capturam isso!

---

## 📚 BM25 Search (Keyword Matching)

### O Que É?

**BM25** (Best Matching 25) = Algoritmo de ranking para **keyword search** baseado em:
- **Term Frequency** (TF): Quantas vezes o termo aparece no documento
- **Inverse Document Frequency** (IDF): Quão raro é o termo no corpus
- **Document Length**: Normaliza por tamanho do documento

**Analogia**: Google Search tradicional (antes de embeddings)

### Matemática: BM25 Formula

**Formula Completa**:
```
BM25(D, Q) = Σ IDF(qi) × (f(qi, D) × (k1 + 1)) / (f(qi, D) + k1 × (1 - b + b × |D| / avgdl))

Onde:
- D = documento (chunk)
- Q = query
- qi = termo i do query
- f(qi, D) = frequência do termo qi no documento D
- |D| = tamanho do documento D (em palavras)
- avgdl = tamanho médio dos documentos no corpus
- k1 = parâmetro de saturação (típico: 1.2-2.0)
- b = parâmetro de normalização de length (típico: 0.75)
```

**IDF (Inverse Document Frequency)**:
```
IDF(qi) = log((N - n(qi) + 0.5) / (n(qi) + 0.5))

Onde:
- N = total de documentos no corpus
- n(qi) = número de documentos que contêm qi
```

### Exemplo Numérico

**Corpus**:
```
Doc 1: "PostgreSQL database is great"           (4 words)
Doc 2: "MySQL database performance"             (3 words)
Doc 3: "Database migration from MySQL"          (4 words)
Doc 4: "Cat and dog playing together"           (5 words)
```

**Query**: "database PostgreSQL"

**Parâmetros**:
- k1 = 1.2
- b = 0.75
- N = 4 (total docs)
- avgdl = (4+3+4+5)/4 = 4

**Cálculo para Doc 1**:

**Term 1: "database"**
- f("database", Doc1) = 1 (aparece 1 vez)
- n("database") = 3 (aparece em Docs 1, 2, 3)
- IDF("database") = log((4 - 3 + 0.5) / (3 + 0.5)) = log(1.5/3.5) ≈ -0.85
- |Doc1| = 4
- TF component = (1 × (1.2 + 1)) / (1 + 1.2 × (1 - 0.75 + 0.75 × 4/4))
                = 2.2 / 2.2 = 1.0
- Contribution = -0.85 × 1.0 = -0.85

**Term 2: "PostgreSQL"**
- f("PostgreSQL", Doc1) = 1
- n("PostgreSQL") = 1 (só no Doc 1)
- IDF("PostgreSQL") = log((4 - 1 + 0.5) / (1 + 0.5)) = log(3.5/1.5) ≈ 0.85
- TF component = 1.0 (same calculation)
- Contribution = 0.85 × 1.0 = 0.85

**BM25(Doc1, Query) = -0.85 + 0.85 = 0.0**

**Cálculo para Doc 2**:
- "database": -0.85 × 1.0 = -0.85
- "PostgreSQL": 0 (não aparece)
- **BM25(Doc2, Query) = -0.85**

**Cálculo para Doc 4**:
- "database": 0 (não aparece)
- "PostgreSQL": 0 (não aparece)
- **BM25(Doc4, Query) = 0**

**Ranking**:
```
1. Doc 1: BM25 = 0.0    (tem "database" + "PostgreSQL")
2. Doc 4: BM25 = 0.0    (nenhum termo)
3. Doc 2: BM25 = -0.85  (só "database")
```

### Propriedades do BM25

**1. Term Frequency Saturation**:
```
TF score aumenta com frequência, mas satura:

f(qi, D):  1    2    3    5    10   100
TF score: 0.55 0.73 0.82 0.91 0.96 0.99

Razão: "database database database..." não é 3× mais relevante!
```

**2. IDF Weighting**:
```
Termos raros = IDF alto (mais importantes)
Termos comuns = IDF baixo (menos importantes)

"the"       → aparece em todos → IDF ≈ 0
"PostgreSQL" → aparece em poucos → IDF alto
```

**3. Length Normalization**:
```
Documentos longos são penalizados (b = 0.75):
- Doc curto (50 palavras) → boost
- Doc médio (avgdl) → neutro
- Doc longo (500 palavras) → penalizado

Razão: Doc longo tem mais chance de conter termo por acaso!
```

### SQLite FTS5 Implementation

**Creating FTS5 Table**:
```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,                  -- Indexed content
    id UNINDEXED,         -- Not indexed
    path UNINDEXED,
    tokenize='porter unicode61'  -- Stemming + Unicode
);
```

**Porter Stemming**:
```
"databases" → "databas"
"database"  → "databas"
"running"   → "run"
"ran"       → "run"

Matches mais flexíveis!
```

**Query**:
```sql
SELECT
    id,
    text,
    bm25(chunks_fts) AS rank  -- BM25 score (lower = better)
FROM chunks_fts
WHERE text MATCH 'database PostgreSQL'
ORDER BY rank  -- ASC (0 is best)
LIMIT 20;
```

**Score Normalization** (para combinar com vector):
```python
# BM25 rank: 0 (best) to +∞ (worst)
# Convert to score: 1 (best) to 0 (worst)

def bm25_rank_to_score(rank: float) -> float:
    return 1 / (1 + abs(rank))

# Examples:
rank = 0.0  → score = 1.0   (perfect match)
rank = 1.0  → score = 0.5   (ok match)
rank = 10.0 → score = 0.09  (weak match)
```

### Quando BM25 É Melhor Que Vector?

**BM25 Vence em**:
1. **Exact Terms**: "POSTGRES_URL", "API_KEY", nomes específicos
2. **Acronyms**: "REST", "CRUD", "SQL"
3. **Numbers/IDs**: "version 2.3.0", "issue #42"
4. **Code**: `function getName()`, `class User`

**Vector Vence em**:
1. **Synonyms**: "database" vs "DB" vs "DBMS"
2. **Paraphrasing**: "What database?" vs "Which DB was chosen?"
3. **Conceptual**: "authentication" matches "login", "JWT", "OAuth"

---

## 🔀 Hybrid Search (Combinando Vector + BM25)

### Por Que Combinar?

**Problema**: Cada método tem strengths/weaknesses

**Solução**: **Hybrid Search** = Best of both worlds!

### Algoritmo de Merging

```python
def hybrid_search(
    query: str,
    vector_weight: float = 0.7,  # 70% vector
    text_weight: float = 0.3,    # 30% BM25
    max_results: int = 6
) -> List[Result]:
    # 1. Generate query embedding
    query_embedding = embed(query)

    # 2. Vector search (top 20)
    vector_results = vector_search(query_embedding, limit=20)
    # Returns: [(id, cosine_score), ...]

    # 3. BM25 search (top 20)
    bm25_results = bm25_search(query, limit=20)
    # Returns: [(id, bm25_rank), ...]

    # 4. Normalize BM25 scores
    bm25_scores = {
        id: 1 / (1 + abs(rank))
        for id, rank in bm25_results
    }

    # 5. Merge results
    merged = {}

    # Add vector results
    for id, score in vector_results:
        merged[id] = {
            "vector_score": score,
            "bm25_score": 0  # Default
        }

    # Add BM25 results
    for id, score in bm25_scores.items():
        if id in merged:
            merged[id]["bm25_score"] = score
        else:
            merged[id] = {
                "vector_score": 0,  # Default
                "bm25_score": score
            }

    # 6. Weighted scoring
    for id in merged:
        final_score = (
            vector_weight * merged[id]["vector_score"] +
            text_weight * merged[id]["bm25_score"]
        )
        merged[id]["final_score"] = final_score

    # 7. Sort & filter
    results = sorted(
        merged.items(),
        key=lambda x: x[1]["final_score"],
        reverse=True
    )

    # Filter by threshold (0.35)
    results = [
        (id, data)
        for id, data in results
        if data["final_score"] >= 0.35
    ]

    return results[:max_results]
```

### Exemplo Numérico Completo

**Query**: "What database did we choose?"

**Vector Search Results**:
```
Chunk 42: "Decided to use PostgreSQL..."    → 0.87
Chunk 15: "Database migration from MySQL..." → 0.65
Chunk 99: "API endpoint /database/..."      → 0.45
```

**BM25 Search Results**:
```
Chunk 42: "Decided to use PostgreSQL..."    → rank 0.1 → score 0.91
Chunk 99: "API endpoint /database/..."      → rank 0.5 → score 0.67
Chunk 200: "Database backup script..."      → rank 2.0 → score 0.33
```

**Merged Scores** (0.7 vector + 0.3 BM25):
```
Chunk 42:
  vector: 0.87 × 0.7 = 0.609
  bm25:   0.91 × 0.3 = 0.273
  FINAL:  0.609 + 0.273 = 0.882 ⭐⭐⭐⭐⭐

Chunk 15:
  vector: 0.65 × 0.7 = 0.455
  bm25:   0.00 × 0.3 = 0.000
  FINAL:  0.455 + 0.000 = 0.455 ⭐⭐⭐

Chunk 99:
  vector: 0.45 × 0.7 = 0.315
  bm25:   0.67 × 0.3 = 0.201
  FINAL:  0.315 + 0.201 = 0.516 ⭐⭐⭐⭐

Chunk 200:
  vector: 0.00 × 0.7 = 0.000
  bm25:   0.33 × 0.3 = 0.099
  FINAL:  0.000 + 0.099 = 0.099 ⭐
```

**Final Ranking** (after threshold filter 0.35):
```
1. Chunk 42: 0.882 ✅
2. Chunk 99: 0.516 ✅
3. Chunk 15: 0.455 ✅
4. Chunk 200: 0.099 ❌ (below threshold)
```

### Tuning Weights (Vector vs BM25)

**Default**: 0.7 vector + 0.3 BM25

**When to adjust**:

**More Vector** (0.8 / 0.2 ou 0.9 / 0.1):
- Conversational queries
- Paraphrasing common
- Synonym-heavy domain
- Conceptual questions

**More BM25** (0.5 / 0.5 ou 0.4 / 0.6):
- Technical documentation
- Code search
- Exact term matches critical
- Acronym-heavy domain

**Balanced** (0.5 / 0.5):
- General-purpose
- Mixed query types
- Unsure what users will ask

### Threshold Tuning (Min Score)

**Default**: 0.35

**Lower Threshold** (0.2 - 0.3):
- More results (better recall)
- More noise (worse precision)
- Use when: Recall is critical

**Higher Threshold** (0.4 - 0.6):
- Fewer results (worse recall)
- Less noise (better precision)
- Use when: Precision is critical

**Example**:
```
Threshold = 0.2:
  Results: 15 chunks (7 relevant, 8 noise)
  Recall: 100% ✅  Precision: 47% ❌

Threshold = 0.35:
  Results: 8 chunks (7 relevant, 1 noise)
  Recall: 100% ✅  Precision: 88% ✅

Threshold = 0.5:
  Results: 4 chunks (4 relevant, 0 noise)
  Recall: 57% ❌  Precision: 100% ✅
```

---

## 🧹 Compaction Algorithms

### O Problema

```
Session History (200K tokens):
[Turn 1] User: "Build an API"
[Turn 2] Assistant: "Sure! ..." (500 tokens)
[Turn 3] User: "Add auth"
[Turn 4] Assistant: *500 lines of code* (5000 tokens)
[Turn 5] User: "Deploy it"
[Turn 6] Assistant: *deployment logs* (4000 tokens)
...
[Turn 150] User: "What's the status?"

Total: 195,000 tokens → Approaching limit (200K)! ⚠️
```

**Próxima mensagem**: +10K tokens → **OVERFLOW!** ❌

### Estratégias de Compaction

#### **Strategy 1: Summarization (LLM-based)**

**Como Funciona**:
```
Turns 1-140 (180,000 tokens)
    ↓
LLM Summarization
    ↓
Summary (5,000 tokens)

Compression Ratio: 5,000 / 180,000 = 2.7% (97% reduction!)
```

**Prompt**:
```
Summarize the conversation focusing on:
- Key decisions and rationale
- Technical choices and architecture
- Current status and next steps
- Open questions or blockers

Omit:
- Verbose code/logs (keep high-level only)
- Redundant context
- Resolved issues
```

**Output**:
```
"Built REST API with /users and /auth endpoints. Implemented JWT
authentication with refresh tokens. Added rate limiting (100 req/min)
using Redis. Created PostgreSQL schema with migrations. Deployed v2.4.0
to staging and production. Current focus: status monitoring."
```

**Pros**:
- ✅ Alta compression (95%+)
- ✅ Semântica preservada
- ✅ Natural language summary

**Cons**:
- ❌ Lossy (detalhes perdidos)
- ❌ Requer LLM call (custo + latência)
- ❌ Não determinístico

#### **Strategy 2: Token-based Truncation**

**Como Funciona**:
```
Keep last N tokens:
[Turn 1-140] → DELETE
[Turn 141-150] → KEEP

OR

Keep last N turns:
[Turn 1-140] → DELETE
[Turn 141-150] → KEEP
```

**Pros**:
- ✅ Simples
- ✅ Rápido (O(1))
- ✅ Determinístico

**Cons**:
- ❌ Perde contexto antigo completamente
- ❌ No semantic understanding
- ❌ Hard cutoff (não gradual)

#### **Strategy 3: Sliding Window + Summary**

**Como Funciona** (Moltbot approach):
```
[Turns 1-100]    → Summarize to 3K tokens
[Turns 101-140]  → Summarize to 2K tokens
[Turns 141-150]  → Keep verbatim (50K tokens)

Total: 3K + 2K + 50K = 55K tokens ✅
```

**Pros**:
- ✅ Melhor trade-off (context + compression)
- ✅ Contexto recente intacto
- ✅ Overview histórico preservado

**Cons**:
- ❌ Mais complexo
- ❌ Múltiplos LLM calls
- ❌ Tuning necessário (quantos turns manter?)

### Memory Flush (Preventive Strategy)

**Innovation do Moltbot**: Salvar info importante **ANTES** da compaction!

**Flow**:
```
Context: 176K / 200K tokens (88%)
    ↓
Soft Threshold Exceeded!
    ↓
[Silent Turn] System: "Pre-compaction memory flush.
                       Store durable memories now."
    ↓
Agent: Writes to memory/2026-01-28.md
       "Decided to use PostgreSQL for database.
        Implemented JWT auth with refresh tokens.
        ..."
    ↓
Agent: Replies "__NO_REPLY__" (hidden from user)
    ↓
Memory saved to disk ✅
    ↓
Compaction proceeds safely
    ↓
Info importante já está no disco!
```

**Por Que É Genial**:
- ✅ Compaction pode ser agressiva (info já salva)
- ✅ User não vê (silent turn)
- ✅ LLM escolhe o que é importante
- ✅ Previne loss de dados críticos

### Compaction Triggers

**Trigger Points**:
```
Context Window: 200K tokens

┌────────────────────────────────────────────┐
│  0K - 150K: NORMAL                         │
│  No action needed                          │
├────────────────────────────────────────────┤
│  150K - 176K: WARNING                      │
│  Log warning, no action yet                │
├────────────────────────────────────────────┤
│  176K - 190K: SOFT THRESHOLD               │
│  → Memory Flush (save to disk)             │
├────────────────────────────────────────────┤
│  190K - 200K: HARD THRESHOLD               │
│  → Compaction (summarize old turns)        │
├────────────────────────────────────────────┤
│  200K+: OVERFLOW                           │
│  → Error (should never reach here!)        │
└────────────────────────────────────────────┘
```

**Thresholds**:
```typescript
const SOFT_THRESHOLD = contextWindow - reserveTokens - softBuffer;
// 200K - 20K - 4K = 176K

const HARD_THRESHOLD = contextWindow - reserveTokens;
// 200K - 20K = 180K

const MAX_THRESHOLD = contextWindow;
// 200K (never exceed!)
```

### Algoritmo de Compaction

```python
def compact_session(
    messages: List[Message],
    context_window: int = 200_000,
    reserve_tokens: int = 20_000,
    keep_recent_turns: int = 10
) -> List[Message]:
    # 1. Calculate tokens
    total_tokens = sum(estimate_tokens(msg) for msg in messages)

    if total_tokens < (context_window - reserve_tokens):
        return messages  # No compaction needed

    # 2. Find split point
    recent_messages = messages[-keep_recent_turns * 2:]  # Keep last N turns
    old_messages = messages[:-keep_recent_turns * 2]

    # 3. Summarize old messages
    summary_text = llm_summarize(
        old_messages,
        instructions="Focus on decisions, architecture, status"
    )

    # 4. Create summary message
    summary_message = {
        "role": "system",
        "content": f"[SUMMARY OF PREVIOUS CONVERSATION]\n{summary_text}"
    }

    # 5. Combine
    compacted = [summary_message] + recent_messages

    # 6. Verify size
    new_total = sum(estimate_tokens(msg) for msg in compacted)
    compression_ratio = new_total / total_tokens

    print(f"Compaction: {total_tokens} → {new_total} tokens ({compression_ratio:.1%})")

    return compacted
```

---

## ⚙️ Hyperparameters (Como Escolher)

### Memory System

#### **1. Chunk Size (tokens)**

**Default**: 400 tokens (~1600 chars)

**Trade-offs**:
```
Smaller (200-300):
  ✅ More granular search
  ✅ Better precision
  ❌ More chunks (slower indexing)
  ❌ Context fragmentation

Larger (600-800):
  ✅ Better context preservation
  ✅ Fewer chunks (faster indexing)
  ❌ Less precise matching
  ❌ Noisy results
```

**Escolha**:
- **Conversational**: 300-400 (mensagens curtas)
- **Documentation**: 500-600 (parágrafos longos)
- **Code**: 200-300 (functions, classes)

#### **2. Chunk Overlap (tokens)**

**Default**: 80 tokens (~320 chars)

**Por Que Overlap?**
```
Without Overlap:
Chunk 1: "...decided to use PostgreSQL for database"
Chunk 2: "implementation. Added JWT auth..."
         ↑
     Context break! "PostgreSQL" e "implementation" separados

With Overlap (80 tokens):
Chunk 1: "...decided to use PostgreSQL for database implementation."
Chunk 2: "...PostgreSQL for database implementation. Added JWT auth..."
         ↑
     Context preserved! ✅
```

**Trade-offs**:
```
No Overlap (0):
  ✅ No redundancy
  ❌ Context breaks at boundaries

Small Overlap (40-60):
  ✅ Some context preservation
  ⚖️ Moderate redundancy

Large Overlap (100-150):
  ✅ Strong context preservation
  ❌ High redundancy (storage + search)
```

**Escolha**:
- Overlap = 15-25% of chunk size
- 400 tokens → 60-100 overlap
- Default: 80 (20%)

#### **3. Embedding Dimensions**

**Options**:
```
text-embedding-3-small: 1536 dims
text-embedding-3-large: 3072 dims
Sentence-BERT: 384-768 dims
```

**Trade-offs**:
```
More Dimensions:
  ✅ Better semantic capture
  ✅ Higher accuracy
  ❌ More storage (2x-8x)
  ❌ Slower search

Fewer Dimensions:
  ✅ Less storage
  ✅ Faster search
  ❌ Less semantic information
```

**Escolha**:
- **General use**: 1536 (OpenAI small) - best balance
- **High accuracy**: 3072 (OpenAI large)
- **Resource-constrained**: 384 (local models)

#### **4. Search Weights (Vector vs BM25)**

**Default**: 0.7 vector + 0.3 BM25

**Tuning Guide**:
```
Query Type Analysis:
- 80% conversational → 0.8 / 0.2
- 50% technical terms → 0.6 / 0.4
- 20% exact matches → 0.4 / 0.6
```

**A/B Testing**:
```python
queries = [
    "What database did we choose?",
    "API_KEY configuration",
    "authentication implementation",
    # ... 50 test queries
]

for vector_weight in [0.5, 0.6, 0.7, 0.8, 0.9]:
    text_weight = 1 - vector_weight

    precision = evaluate_precision(queries, vector_weight, text_weight)
    recall = evaluate_recall(queries, vector_weight, text_weight)

    print(f"{vector_weight}/{text_weight}: P={precision:.2f} R={recall:.2f}")

# Output:
# 0.5/0.5: P=0.82 R=0.91
# 0.6/0.4: P=0.85 R=0.89
# 0.7/0.3: P=0.88 R=0.87  ← Best balance
# 0.8/0.2: P=0.90 R=0.82
# 0.9/0.1: P=0.91 R=0.75
```

#### **5. Min Score Threshold**

**Default**: 0.35

**Precision/Recall Curve**:
```
Threshold | Recall | Precision | F1
----------|--------|-----------|----
0.20      | 0.95   | 0.45      | 0.61
0.30      | 0.92   | 0.72      | 0.81
0.35      | 0.87   | 0.88      | 0.87 ← Sweet spot
0.40      | 0.78   | 0.92      | 0.84
0.50      | 0.62   | 0.96      | 0.75
```

**Escolha**:
- **Recall-focused**: 0.25-0.30 (mais resultados)
- **Balanced**: 0.35-0.40 (default)
- **Precision-focused**: 0.45-0.55 (menos ruído)

### Context Management

#### **6. Context Window Reserve**

**Default**: 20,000 tokens

**Por Quê?**
```
Context Window: 200K
Reserve: 20K

Effective Window: 180K

Razão:
- Agent response: ~5K tokens (médio)
- Tool calls: ~10K tokens (safety buffer)
- Overhead: ~5K tokens (system, formatting)
```

**Escolha**:
- **Small models** (32K window): 5K reserve
- **Medium models** (128K window): 15K reserve
- **Large models** (200K+ window): 20K reserve

#### **7. Compaction Thresholds**

**Soft Threshold** (Memory Flush):
```
Default: contextWindow - reserve - 4K
Example: 200K - 20K - 4K = 176K (88%)
```

**Hard Threshold** (Compaction):
```
Default: contextWindow - reserve
Example: 200K - 20K = 180K (90%)
```

**Gap Between Thresholds**:
```
Gap = 4K tokens (default)

Small Gap (2K):
  ✅ More frequent flushes (better safety)
  ❌ More LLM calls (higher cost)

Large Gap (8K):
  ✅ Fewer flushes (lower cost)
  ❌ Less safety margin
```

#### **8. Pruning Ratios**

**Soft Trim Trigger**: 80% of context window
```
contextChars = totalChars
charWindow = contextWindow * 4

if (contextChars / charWindow) >= 0.8:
    soft_trim()
```

**Hard Clear Trigger**: 65% of context window
```
if (contextChars / charWindow) >= 0.65:
    hard_clear()
```

**Por Que 80% e 65%?**
```
Progression:
0-65%: No pruning (normal operation)
65-80%: Hard clear (aggressive cleanup)
80%+: Soft trim (preserve head/tail)

Razão: Clear old results first, trim recent ones only if needed
```

#### **9. Keep Last N Assistant Messages**

**Default**: 3 turns

**Protected Zone**:
```
[Turn 145] User: "..."
[Turn 146] Assistant: "..." ← Protected
[Turn 147] User: "..."
[Turn 148] Assistant: "..." ← Protected
[Turn 149] User: "..."
[Turn 150] Assistant: "..." ← Protected (most recent)

Turns 1-145: Can be pruned
Turns 146-150: Never pruned
```

**Escolha**:
- **Chat-heavy**: 5-10 turns (preserve conversation flow)
- **Tool-heavy**: 2-3 turns (tools can be pruned)
- **Balanced**: 3 turns (default)

---

## 🤔 Trade-offs & Decisões

### Memory System

| Decisão | Option A | Option B | Recomendação |
|---------|----------|----------|--------------|
| **Storage** | Markdown (human-readable) | JSON (machine-friendly) | Markdown ✅ (transparency) |
| **Embeddings** | Batch API (cheap, async) | Real-time (fast, expensive) | Batch for indexing, real-time for search |
| **Vector DB** | SQLite-vec (local) | Pinecone (cloud) | SQLite-vec ✅ (privacy, cost) |
| **Search** | Hybrid (vector + BM25) | Vector only | Hybrid ✅ (best recall) |

### Context Management

| Decisão | Option A | Option B | Recomendação |
|---------|----------|----------|--------------|
| **Compaction** | LLM summarization | Token truncation | Summarization ✅ (semantic) |
| **Pruning** | Aggressive (65% threshold) | Conservative (85% threshold) | Balanced (80%) ✅ |
| **Memory Flush** | Enabled (preventive) | Disabled (simpler) | Enabled ✅ (data safety) |
| **Cache-TTL** | Enabled (cost optimization) | Disabled (simpler) | Enabled for Anthropic ✅ |

### Performance vs Cost

| Aspect | Cheap | Expensive | Escolha |
|--------|-------|-----------|---------|
| **Embeddings** | Batch API ($0.00001/1K) | Real-time ($0.00002/1K) | Batch for bulk, real-time for queries |
| **Storage** | Local SQLite (free) | Cloud DB ($$$) | Local ✅ |
| **LLM Calls** | Minimal (only compaction) | Frequent (every turn) | Minimal ✅ |
| **Search** | Approximate (HNSW) | Exact (brute-force) | Approximate ✅ (99% accuracy) |

### Privacy vs Features

| Feature | Local | Cloud | Escolha |
|---------|-------|-------|---------|
| **Storage** | ~/data/ | AWS S3 | Local ✅ (privacy) |
| **Embeddings** | Local model | OpenAI API | OpenAI (better quality) |
| **Search** | sqlite-vec | Pinecone | sqlite-vec ✅ (privacy) |
| **Backup** | Git | Cloud sync | Git ✅ (version control) |

---

## 🎓 Resumo dos Conceitos

### Embeddings
- **O Que**: Representação numérica de texto (1536 dimensões)
- **Como**: Neural network aprende relações semânticas
- **Por Quê**: Permite busca por significado, não só palavras

### Vector Search
- **O Que**: Encontrar embeddings mais próximos (cosine similarity)
- **Como**: Calcula similaridade entre vetores
- **Por Quê**: Captura sinônimos, paraphrasing, conceitos

### BM25 Search
- **O Que**: Keyword matching com TF-IDF + length normalization
- **Como**: Pondera term frequency, rarity, doc length
- **Por Quê**: Pega exact matches, acronyms, IDs

### Hybrid Search
- **O Que**: Combina vector + BM25 com weighted scoring
- **Como**: Merge results, score = 0.7×vector + 0.3×BM25
- **Por Quê**: Best of both worlds (semantic + exact)

### Compaction
- **O Que**: Reduzir contexto quando atinge limite
- **Como**: LLM summarization + keep recent turns
- **Por Quê**: Mantém conversação funcionando sem overflow

### Memory Flush
- **O Que**: Salvar info importante antes de compaction
- **Como**: Silent turn antes do threshold
- **Por Quê**: Previne loss de dados críticos

---

**Próximo Passo**: Agora que você entende profundamente os conceitos, vamos para **Option D** (fork do Moltbot)!

Quer que eu crie um plano detalhado de como extrair e adaptar o código? 🚀
