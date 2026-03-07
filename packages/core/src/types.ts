/**
 * Core types for MemoryClaw
 */

// ============================================
// Message Types
// ============================================

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// ============================================
// Memory Types
// ============================================

export interface MemoryConfig {
  enabled: boolean;
  provider: "openai" | "gemini" | "local";
  model: string;
  chunkSize: number;
  chunkOverlap: number;
  vectorWeight?: number;  // Default 0.7
  textWeight?: number;    // Default 0.3
  minScore?: number;      // Default 0.35
}

export interface MemoryChunk {
  id: string;
  path: string;
  source: "memory" | "sessions";
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
  embedding?: number[];
}

export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "sessions";
}

export interface MemorySearchOptions {
  query: string;
  maxResults?: number;
  minScore?: number;
}

// ============================================
// Context Types
// ============================================

export interface ContextConfig {
  maxTokens: number;
  reserveTokens: number;
  compactionEnabled: boolean;
  pruningEnabled: boolean;
  memoryFlushEnabled?: boolean;
  softThresholdTokens?: number;
}

export interface Session {
  id: string;
  userId: string;
  messages: Message[];
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  createdAt: number;
  updatedAt: number;
  totalTokens: number;
  compactionCount: number;
  memoryFlushCount?: number;
  pruned: boolean;
}

export interface CompactionResult {
  success: boolean;
  tokensBefore: number;
  tokensAfter: number;
  compressionRatio: number;
  summary: string;
}

// ============================================
// Engine Types
// ============================================

export interface EngineConfig {
  userId: string;
  sessionId?: string;
  dataDir: string;
  memory: MemoryConfig;
  context: ContextConfig;
}

export interface PreparedContext {
  messages: Message[];
  relevantMemories: MemorySearchResult[];
  systemPrompt: string;
  metadata: {
    totalTokens: number;
    compacted: boolean;
    memoriesFound: number;
    pruned: boolean;
  };
}

export interface EngineStats {
  session: {
    messageCount: number;
    totalTokens: number;
    compactionCount: number;
    pruned: boolean;
  };
  memory: {
    fileCount: number;
    chunkCount: number;
    lastIndexed?: string;
  };
}
