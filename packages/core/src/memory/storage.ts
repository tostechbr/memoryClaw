/**
 * SQLite storage layer for memory chunks
 *
 * Tables:
 * - meta: Configuration and metadata
 * - files: Tracked memory files
 * - chunks: Indexed memory chunks with embeddings
 * - embedding_cache: Cache for embeddings (deduplication)
 * - chunks_fts: Full-text search virtual table (FTS5)
 * - chunks_vec: Vector search virtual table (sqlite-vec)
 */

import Database from "better-sqlite3";
import path from "node:path";
import { ensureDir } from "../utils/files.js";

export interface StorageConfig {
  dataDir: string;
  userId: string;
  sessionId?: string;
}

export interface StoredChunk {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  hash: string;
  model: string;
  text: string;
  embedding: string; // JSON-encoded number[]
  updatedAt: number;
}

export interface StoredFile {
  path: string;
  source: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface SearchVectorParams {
  embedding: number[];
  limit: number;
  source?: string;
}

export interface SearchKeywordParams {
  query: string;
  limit: number;
  source?: string;
}

export interface VectorSearchResult {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  distance: number; // Lower is better (cosine distance)
}

export interface KeywordSearchResult {
  id: string;
  path: string;
  source: string;
  startLine: number;
  endLine: number;
  text: string;
  rank: number; // BM25 rank (negative value, closer to 0 is better)
}

/**
 * SQLite storage for memory chunks
 */
export class MemoryStorage {
  private db: Database.Database;
  private readonly dbPath: string;
  private ftsAvailable = false;
  private vecAvailable = false;

  constructor(config: StorageConfig) {
    const sessionPart = config.sessionId ? `_${config.sessionId}` : "";
    const dbName = `memory${sessionPart}.db`;
    const userDir = path.join(config.dataDir, "users", config.userId);
    this.dbPath = path.join(ensureDir(userDir), dbName);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private initSchema(): void {
    // Meta table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'memory',
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
    `);

    // Chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Embedding cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        hash TEXT NOT NULL,
        embedding TEXT NOT NULL,
        dims INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, model, provider_key, hash)
      );
    `);

    // Indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON embedding_cache(updated_at);`);

    // FTS5 virtual table (optional)
    this.initFts();

    // Note: sqlite-vec requires loading extension dynamically
    // Will be initialized when vector search is first used
  }

  /**
   * Initialize FTS5 virtual table
   */
  private initFts(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          id UNINDEXED,
          path UNINDEXED,
          source UNINDEXED,
          model UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
      this.ftsAvailable = true;
    } catch (err) {
      this.ftsAvailable = false;
      console.warn("FTS5 not available:", err);
    }
  }

  /**
   * Load sqlite-vec extension for vector search
   * Note: This must be called before vector search can be used
   */
  loadVectorExtension(extensionPath: string): void {
    try {
      this.db.loadExtension(extensionPath);

      // Create vector virtual table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding FLOAT[1536]
        );
      `);

      this.vecAvailable = true;
    } catch (err) {
      this.vecAvailable = false;
      console.warn("sqlite-vec not available:", err);
    }
  }

  /**
   * Check if FTS is available
   */
  isFtsAvailable(): boolean {
    return this.ftsAvailable;
  }

  /**
   * Check if vector search is available
   */
  isVecAvailable(): boolean {
    return this.vecAvailable;
  }

  /**
   * Upsert file metadata
   */
  upsertFile(file: StoredFile): void {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, source, hash, mtime, size)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        source = excluded.source,
        hash = excluded.hash,
        mtime = excluded.mtime,
        size = excluded.size
    `);
    stmt.run(file.path, file.source, file.hash, file.mtime, file.size);
  }

  /**
   * Upsert chunk with embedding
   */
  upsertChunk(chunk: StoredChunk): void {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        source = excluded.source,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        hash = excluded.hash,
        model = excluded.model,
        text = excluded.text,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      chunk.id,
      chunk.path,
      chunk.source,
      chunk.startLine,
      chunk.endLine,
      chunk.hash,
      chunk.model,
      chunk.text,
      chunk.embedding,
      chunk.updatedAt
    );

    // Sync to FTS if available
    if (this.ftsAvailable) {
      this.syncChunkToFts(chunk);
    }

    // Sync to vector table if available
    if (this.vecAvailable) {
      this.syncChunkToVec(chunk);
    }
  }

  /**
   * Sync chunk to FTS table
   */
  private syncChunkToFts(chunk: StoredChunk): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks_fts (id, path, source, model, start_line, end_line, text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      chunk.id,
      chunk.path,
      chunk.source,
      chunk.model,
      chunk.startLine,
      chunk.endLine,
      chunk.text
    );
  }

  /**
   * Sync chunk to vector table
   */
  private syncChunkToVec(chunk: StoredChunk): void {
    const embedding = JSON.parse(chunk.embedding) as number[];
    const blob = Buffer.from(new Float32Array(embedding).buffer);

    const stmt = this.db.prepare(`
      INSERT INTO chunks_vec (id, embedding)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        embedding = excluded.embedding
    `);
    stmt.run(chunk.id, blob);
  }

  /**
   * Delete chunks by file path
   */
  deleteChunksByPath(filePath: string): void {
    // Delete from main table
    this.db.prepare("DELETE FROM chunks WHERE path = ?").run(filePath);

    // Delete from FTS
    if (this.ftsAvailable) {
      this.db.prepare("DELETE FROM chunks_fts WHERE path = ?").run(filePath);
    }

    // Note: chunks_vec deletion handled by trigger or manual cleanup
  }

  /**
   * Delete file metadata
   */
  deleteFile(filePath: string): void {
    this.db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
  }

  /**
   * Get all indexed file paths
   */
  getAllFilePaths(): string[] {
    const stmt = this.db.prepare("SELECT path FROM files");
    const rows = stmt.all() as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  /**
   * Get file by path
   */
  getFile(filePath: string): StoredFile | null {
    const stmt = this.db.prepare("SELECT * FROM files WHERE path = ?");
    const row = stmt.get(filePath) as
      | { path: string; source: string; hash: string; mtime: number; size: number }
      | undefined;

    if (!row) return null;

    return {
      path: row.path,
      source: row.source,
      hash: row.hash,
      mtime: row.mtime,
      size: row.size,
    };
  }

  /**
   * Vector search (requires sqlite-vec)
   */
  searchVector(params: SearchVectorParams): VectorSearchResult[] {
    if (!this.vecAvailable) {
      throw new Error("Vector search not available - load extension first");
    }

    const blob = Buffer.from(new Float32Array(params.embedding).buffer);

    let query = `
      SELECT
        c.id,
        c.path,
        c.source,
        c.start_line as startLine,
        c.end_line as endLine,
        c.text,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM chunks_vec v
      JOIN chunks c ON c.id = v.id
    `;

    const queryParams: unknown[] = [blob];

    if (params.source) {
      query += " WHERE c.source = ?";
      queryParams.push(params.source);
    }

    query += " ORDER BY distance ASC LIMIT ?";
    queryParams.push(params.limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...queryParams) as VectorSearchResult[];

    return rows;
  }

  /**
   * Keyword search using FTS5
   */
  searchKeyword(params: SearchKeywordParams): KeywordSearchResult[] {
    if (!this.ftsAvailable) {
      throw new Error("FTS not available");
    }

    // Build FTS query (quote for exact match, OR for terms)
    const query = params.query
      .trim()
      .split(/\s+/)
      .map((term) => `"${term.replace(/"/g, '""')}"`)
      .join(" OR ");

    let sql = `
      SELECT
        id,
        path,
        source,
        start_line as startLine,
        end_line as endLine,
        snippet(chunks_fts, 0, '', '', '...', 32) as text,
        rank as rank
      FROM chunks_fts
      WHERE text MATCH ?
    `;

    const queryParams: unknown[] = [query];

    if (params.source) {
      sql += " AND source = ?";
      queryParams.push(params.source);
    }

    sql += " ORDER BY rank DESC LIMIT ?";
    queryParams.push(params.limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...queryParams) as KeywordSearchResult[];

    return rows;
  }

  /**
   * Get chunk count
   */
  getChunkCount(source?: string): number {
    let query = "SELECT COUNT(*) as count FROM chunks";
    const params: unknown[] = [];

    if (source) {
      query += " WHERE source = ?";
      params.push(source);
    }

    const stmt = this.db.prepare(query);
    const row = stmt.get(...params) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  /**
   * Get embedding from cache
   */
  getCachedEmbedding(
    provider: string,
    model: string,
    providerKey: string,
    hash: string
  ): number[] | null {
    const stmt = this.db.prepare(`
      SELECT embedding FROM embedding_cache
      WHERE provider = ? AND model = ? AND provider_key = ? AND hash = ?
    `);

    const row = stmt.get(provider, model, providerKey, hash) as
      | { embedding: string }
      | undefined;

    if (!row) return null;

    try {
      const parsed = JSON.parse(row.embedding) as number[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Cache embedding
   */
  cacheEmbedding(
    provider: string,
    model: string,
    providerKey: string,
    hash: string,
    embedding: number[],
    dims?: number
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, model, provider_key, hash) DO UPDATE SET
        embedding = excluded.embedding,
        dims = excluded.dims,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      provider,
      model,
      providerKey,
      hash,
      JSON.stringify(embedding),
      dims ?? null,
      Date.now()
    );
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database path
   */
  getPath(): string {
    return this.dbPath;
  }
}
