/**
 * Memory Manager
 *
 * Orchestrates:
 * - File discovery and watching
 * - Markdown chunking
 * - Embedding generation
 * - SQLite storage
 * - Hybrid search (vector + keyword)
 */

import { watch, type FSWatcher } from "chokidar";
import path from "node:path";
import fs from "node:fs/promises";
import { hashText } from "../utils/hash.js";
import { listMemoryFiles, exists } from "../utils/files.js";
import { chunkMarkdown } from "./chunking.js";
import { mergeHybridResults } from "./hybrid.js";
import { MemoryStorage, type StorageConfig, type StoredChunk, type StoredFile } from "./storage.js";
import type { MemoryConfig, MemoryChunk, MemorySearchResult } from "../types.js";

export interface MemoryManagerConfig {
  dataDir: string;
  userId: string;
  sessionId?: string;
  workspaceDir: string;
  memory: MemoryConfig;
  vectorExtensionPath?: string;
}

export interface EmbeddingProvider {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Memory Manager
 * Manages long-term memory storage and retrieval
 */
export class MemoryManager {
  private storage: MemoryStorage;
  private config: MemoryManagerConfig;
  private provider: EmbeddingProvider | null = null;
  private watcher: FSWatcher | null = null;
  private syncing = false;
  private dirty = false;
  private closed = false;

  constructor(config: MemoryManagerConfig) {
    this.config = config;

    const storageConfig: StorageConfig = {
      dataDir: config.dataDir,
      userId: config.userId,
      sessionId: config.sessionId,
    };

    this.storage = new MemoryStorage(storageConfig);

    // Load vector extension if provided
    if (config.vectorExtensionPath) {
      this.storage.loadVectorExtension(config.vectorExtensionPath);
    }

    // Mark as dirty (needs initial sync)
    this.dirty = config.memory.enabled;
  }

  /**
   * Set embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.provider = provider;
  }

  /**
   * Start watching memory files for changes
   */
  async watch(): Promise<void> {
    if (this.watcher) return;

    const memoryFile = path.join(this.config.workspaceDir, "MEMORY.md");
    const memoryDir = path.join(this.config.workspaceDir, "memory");

    const patterns = [memoryFile];
    if (await exists(memoryDir)) {
      patterns.push(path.join(memoryDir, "**/*.md"));
    }

    this.watcher = watch(patterns, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", () => {
      this.dirty = true;
    });

    this.watcher.on("change", () => {
      this.dirty = true;
    });

    this.watcher.on("unlink", () => {
      this.dirty = true;
    });
  }

  /**
   * Stop watching files
   */
  async unwatch(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Sync memory files to storage
   * Discovers files, chunks content, generates embeddings, and stores
   */
  async sync(opts?: { force?: boolean }): Promise<void> {
    if (!this.config.memory.enabled) return;
    if (this.syncing) return;
    if (!this.dirty && !opts?.force) return;

    this.syncing = true;

    try {
      const files = await listMemoryFiles(this.config.workspaceDir);

      // Index existing files
      const currentRelPaths = new Set<string>();
      for (const absPath of files) {
        const relPath = path.relative(this.config.workspaceDir, absPath);
        currentRelPaths.add(relPath);
        await this.indexFile(absPath);
      }

      // Remove chunks from deleted files
      const indexedPaths = this.storage.getAllFilePaths();
      for (const indexedPath of indexedPaths) {
        if (!currentRelPaths.has(indexedPath)) {
          await this.deleteFile(indexedPath);
        }
      }

      this.dirty = false;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Index a single file
   */
  private async indexFile(absPath: string): Promise<void> {
    const relPath = path.relative(this.config.workspaceDir, absPath);

    // Check if file still exists
    if (!(await exists(absPath))) {
      await this.deleteFile(relPath);
      return;
    }

    // Read file stats and content
    const stats = await fs.stat(absPath);
    const content = await fs.readFile(absPath, "utf-8");
    const hash = hashText(content);

    // Check if file changed
    const existing = this.storage.getFile(relPath);
    if (existing && existing.hash === hash) {
      return; // No changes
    }

    // Delete old chunks
    if (existing) {
      this.storage.deleteChunksByPath(relPath);
    }

    // Upsert file metadata
    const file: StoredFile = {
      path: relPath,
      source: "memory",
      hash,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
    this.storage.upsertFile(file);

    // Chunk markdown
    const chunks = chunkMarkdown(content, {
      tokens: this.config.memory.chunkSize,
      overlap: this.config.memory.chunkOverlap,
    });

    // Generate embeddings and store chunks
    await this.indexChunks(relPath, chunks);
  }

  /**
   * Generate embeddings for chunks and store them
   */
  private async indexChunks(filePath: string, chunks: MemoryChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    // Generate embeddings (batch)
    const texts = chunks.map((c) => c.text);
    let embeddings: number[][] = [];

    if (this.provider) {
      embeddings = await this.provider.embed(texts);
    } else {
      // Fallback: zero vectors (won't work for search but allows testing)
      embeddings = texts.map(() => new Array(1536).fill(0));
    }

    // Store chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      if (!chunk || !embedding) continue;

      const id = `${filePath}:${chunk.startLine}-${chunk.endLine}`;

      const stored: StoredChunk = {
        id,
        path: filePath,
        source: "memory",
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        hash: chunk.hash,
        model: this.config.memory.model,
        text: chunk.text,
        embedding: JSON.stringify(embedding),
        updatedAt: Date.now(),
      };

      this.storage.upsertChunk(stored);
    }
  }

  /**
   * Delete file and its chunks
   */
  private async deleteFile(filePath: string): Promise<void> {
    this.storage.deleteChunksByPath(filePath);
    this.storage.deleteFile(filePath);
  }

  /**
   * Search memory using hybrid search (vector + keyword)
   */
  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      source?: string;
    }
  ): Promise<MemorySearchResult[]> {
    // Sync if dirty
    if (this.dirty) {
      await this.sync();
    }

    const cleaned = query.trim();
    if (!cleaned) return [];

    const minScore = opts?.minScore ?? this.config.memory.minScore ?? 0.35;
    const maxResults = opts?.maxResults ?? 5;
    const vectorWeight = this.config.memory.vectorWeight ?? 0.7;
    const textWeight = this.config.memory.textWeight ?? 0.3;

    // Candidate multiplier (fetch more candidates for better merging)
    const candidates = Math.min(200, Math.max(1, Math.floor(maxResults * 3)));

    // Keyword search
    let keywordResults: Array<{ id: string; path: string; source: string; startLine: number; endLine: number; snippet: string; textScore: number }> = [];
    if (this.storage.isFtsAvailable()) {
      try {
        const rows = this.storage.searchKeyword({
          query: cleaned,
          limit: candidates,
          source: opts?.source,
        });

        keywordResults = rows.map((row) => ({
          id: row.id,
          path: row.path,
          source: row.source,
          startLine: row.startLine,
          endLine: row.endLine,
          snippet: row.text,
          textScore: this.bm25RankToScore(row.rank),
        }));
      } catch {
        // FTS search failed
      }
    }

    // Vector search
    let vectorResults: Array<{ id: string; path: string; source: string; startLine: number; endLine: number; snippet: string; vectorScore: number }> = [];
    if (this.provider && this.storage.isVecAvailable()) {
      try {
        const embeddings = await this.provider.embed([cleaned]);
        const queryVec = embeddings[0];

        if (queryVec && queryVec.some((v) => v !== 0)) {
          const rows = this.storage.searchVector({
            embedding: queryVec,
            limit: candidates,
            source: opts?.source,
          });

          vectorResults = rows.map((row) => ({
            id: row.id,
            path: row.path,
            source: row.source,
            startLine: row.startLine,
            endLine: row.endLine,
            snippet: this.truncateSnippet(row.text, 700),
            vectorScore: this.cosineDistanceToScore(row.distance),
          }));
        }
      } catch {
        // Vector search failed
      }
    }

    // Merge hybrid results
    const merged = mergeHybridResults({
      vector: vectorResults,
      keyword: keywordResults,
      vectorWeight,
      textWeight,
    });

    // Filter by min score and limit
    return merged
      .filter((entry) => entry.score >= minScore)
      .slice(0, maxResults)
      .map((entry) => ({
        path: entry.path,
        startLine: entry.startLine,
        endLine: entry.endLine,
        score: entry.score,
        snippet: entry.snippet,
        source: entry.source as "memory" | "sessions",
      }));
  }

  /**
   * Convert BM25 rank (negative) to normalized score
   */
  private bm25RankToScore(rank: number): number {
    // BM25 rank is negative, closer to 0 is better
    // Normalize to 0-1 range (higher is better)
    const clamped = Math.max(-50, rank); // Clamp extreme values
    return (clamped + 50) / 50; // Map -50..0 to 0..1
  }

  /**
   * Convert cosine distance to score
   */
  private cosineDistanceToScore(distance: number): number {
    // Cosine distance: 0 = identical, 2 = opposite
    // Convert to similarity: 1 - (distance / 2)
    return Math.max(0, 1 - distance / 2);
  }

  /**
   * Truncate content to max characters
   */
  private truncateSnippet(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "...";
  }

  /**
   * Get chunk count
   */
  getChunkCount(source?: string): number {
    return this.storage.getChunkCount(source);
  }

  /**
   * Close manager and cleanup resources
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.unwatch();
    this.storage.close();
  }

  /**
   * Get storage instance (for advanced usage)
   */
  getStorage(): MemoryStorage {
    return this.storage;
  }
}
