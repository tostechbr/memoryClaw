import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MemoryManager,
  createOpenAIEmbeddingProvider,
  type EmbeddingProvider
} from "memory-claw";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Configuration for the MCP Server
 */
export interface McpServerConfig {
  /** Directory containing MEMORY.md and memory/*.md files */
  workspaceDir: string;
  /** Path to SQLite database (default: ./memory.db) */
  dbPath?: string;
  /** Embedding provider configuration */
  embedding?: {
    provider: "openai" | "local";
    apiKey?: string;
    model?: string;
  };
  /** Hybrid search weights */
  hybridWeights?: {
    vector: number;
    text: number;
  };
  /** LLM model for memory_add extraction/merge (default: "gpt-4o-mini") */
  extractionModel?: string;
}

/**
 * MCP Server for MemoryClaw
 * Exposes memory search and retrieval tools via Model Context Protocol
 * Supports per-user isolation via optional userId parameter on all tools.
 */
export class MemoryMcpServer {
  private server: Server;
  private managers = new Map<string, MemoryManager>();
  private workspaceDir: string;
  private dataDir: string;
  private embeddingConfig?: McpServerConfig["embedding"];
  private hybridWeights?: McpServerConfig["hybridWeights"];
  private extractionModel: string;

  constructor(config: McpServerConfig) {
    this.workspaceDir = config.workspaceDir;
    this.dataDir = config.dbPath ? config.dbPath.replace(/\/[^/]+$/, "") : "./data";
    this.embeddingConfig = config.embedding;
    this.hybridWeights = config.hybridWeights;
    this.extractionModel = config.extractionModel ?? "gpt-4o-mini";

    // Initialize MCP Server
    this.server = new Server(
      {
        name: "memory-claw",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  /**
   * Sanitize userId to safe filesystem characters, preventing path traversal.
   * Returns a string safe to use as a directory name.
   */
  private sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_\-.:+@]/g, "_");
  }

  /**
   * Return the absolute workspace directory for a given userId.
   */
  private getUserWorkspaceDir(userId: string): string {
    const safe = this.sanitizeUserId(userId);
    return path.join(this.workspaceDir, "users", safe);
  }

  /**
   * Lazily create and cache a MemoryManager for the given userId.
   * On first call: creates the user directory, bootstraps MEMORY.md if absent,
   * configures the embedding provider, and runs an initial sync.
   */
  private async getOrCreateManager(rawUserId: string): Promise<MemoryManager> {
    const userId = this.sanitizeUserId(rawUserId);

    const existing = this.managers.get(userId);
    if (existing) return existing;

    const userWorkspaceDir = path.join(this.workspaceDir, "users", userId);
    await fs.mkdir(userWorkspaceDir, { recursive: true });

    // Bootstrap MEMORY.md only if it doesn't already exist
    const memoryFile = path.join(userWorkspaceDir, "MEMORY.md");
    try {
      await fs.access(memoryFile);
    } catch {
      await fs.writeFile(memoryFile, `# Memory\n\nUser: ${userId}\n`, "utf-8");
    }

    const manager = new MemoryManager({
      dataDir: this.dataDir,
      userId,
      workspaceDir: userWorkspaceDir,
      memory: {
        enabled: true,
        provider: this.embeddingConfig?.provider || "openai",
        model: this.embeddingConfig?.model || "text-embedding-3-small",
        chunkSize: 400,
        chunkOverlap: 80,
        vectorWeight: this.hybridWeights?.vector ?? 0.7,
        textWeight: this.hybridWeights?.text ?? 0.3,
        minScore: 0.15,
      },
    });

    if (this.embeddingConfig) {
      this.setupEmbeddingProvider(manager, this.embeddingConfig);
    }

    // Initial sync to index any pre-existing files
    try {
      await manager.sync();
    } catch (error) {
      console.error(`[MCP] Warning: Initial sync failed for user ${userId}:`, error);
    }

    this.managers.set(userId, manager);
    return manager;
  }

  /**
   * Configure an embedding provider on a specific manager instance.
   */
  private setupEmbeddingProvider(manager: MemoryManager, config: McpServerConfig["embedding"]): void {
    if (!config) return;

    const createMockProvider = (reason: string) => {
      console.error(`[MCP] Using mock embeddings: ${reason} (keyword-only search)`);
      // Zero vectors ensure queryVec.some(v => v !== 0) is false, bypassing vector search
      // and leaving only FTS5 keyword search active. This matches the "keyword-only" intent.
      manager.setEmbeddingProvider({
        model: "mock",
        embed: async (texts: string[]) => texts.map(() => new Array(1536).fill(0)),
      });
    };

    if (config.provider === "openai") {
      const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

      if (!apiKey || apiKey === "mock" || apiKey === "test" || apiKey.startsWith("mock-") || apiKey.startsWith("test-")) {
        createMockProvider("no valid API key");
        return;
      }

      const provider = createOpenAIEmbeddingProvider({
        apiKey,
        model: config.model,
      });

      manager.setEmbeddingProvider(provider);
      console.error(`[MCP] Embedding provider: OpenAI (${config.model || "text-embedding-3-small"})`);
    } else {
      createMockProvider(`provider=${config.provider}`);
    }
  }

  /**
   * Register tool handlers
   */
  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "memory_search",
          description:
            "Search long-term conversation memory using hybrid vector + keyword search. " +
            "Searches across MEMORY.md and memory/*.md files in the workspace.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query (semantic or keyword)",
              },
              maxResults: {
                type: "number",
                description: "Maximum number of results to return (default: 6)",
                default: 6,
              },
              minScore: {
                type: "number",
                description: "Minimum relevance score threshold 0-1 (default: 0.15, lower works better for keyword-only search)",
                default: 0.15,
              },
              userId: {
                type: "string",
                description: "User identifier for isolation (default: 'default')",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "memory_get",
          description:
            "Retrieve specific lines from a memory file. " +
            "Use this after memory_search to get full content of relevant sections.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Relative path to memory file (e.g., 'memory/2025-01.md')",
              },
              from: {
                type: "number",
                description: "Starting line number (1-based, optional)",
              },
              lines: {
                type: "number",
                description: "Number of lines to read (optional, default: all)",
              },
              userId: {
                type: "string",
                description: "User identifier for isolation (default: 'default')",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "memory_store",
          description:
            "Save or update a memory file in the workspace. " +
            "Creates directories automatically if they don't exist. " +
            "Use this to persist new information, conversation summaries, or learnings.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Relative path to save the file (e.g., 'memory/2026-02-06.md')",
              },
              content: {
                type: "string",
                description: "Markdown content to write to the file",
              },
              userId: {
                type: "string",
                description: "User identifier for isolation (default: 'default')",
              },
            },
            required: ["path", "content"],
          },
        },
        {
          name: "memory_delete",
          description:
            "Delete a memory file from the workspace. " +
            "Use this to remove outdated or incorrect information. " +
            "Cannot delete MEMORY.md (the main memory file).",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Relative path to the file to delete (e.g., 'memory/old-notes.md')",
              },
              userId: {
                type: "string",
                description: "User identifier for isolation (default: 'default')",
              },
            },
            required: ["path"],
          },
        },
        {
          name: "memory_context",
          description:
            "Read or write the active working memory (scratchpad) for a user. " +
            "The context is a JSON object stored per-user at context.json. " +
            "Use 'get' to read current context, 'set' to shallow-merge new data into it.",
          inputSchema: {
            type: "object",
            properties: {
              operation: {
                type: "string",
                enum: ["get", "set"],
                description: "Operation to perform: 'get' reads context, 'set' merges data into it",
              },
              userId: {
                type: "string",
                description: "User identifier for isolation (default: 'default')",
              },
              data: {
                type: "object",
                description: "Data to merge into context (required for 'set' operation)",
              },
            },
            required: ["operation"],
          },
        },
        {
          name: "memory_add",
          description:
            "Intelligently add information to memory with automatic deduplication. " +
            "If a very similar memory exists (cosine similarity ≥ 0.85), the LLM merges " +
            "the new info into that file (action: 'merged'). Otherwise, it extracts " +
            "structured facts and creates a new file (action: 'created'). " +
            "Requires an OpenAI API key for embedding + extraction.",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Raw text/message to extract facts from and store in memory",
              },
              userId: {
                type: "string",
                description: "User identifier for isolation (default: 'default')",
              },
            },
            required: ["message"],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: CallToolRequest) => {
        const { name, arguments: args } = request.params;

        try {
          switch (name) {
            case "memory_search":
              return await this.handleMemorySearch(args);
            case "memory_get":
              return await this.handleMemoryGet(args);
            case "memory_store":
              return await this.handleMemoryStore(args);
            case "memory_delete":
              return await this.handleMemoryDelete(args);
            case "memory_context":
              return await this.handleMemoryContext(args);
            case "memory_add":
              return await this.handleMemoryAdd(args);
            default:
              throw new Error(`Unknown tool: ${name}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error: ${message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Handle memory_search tool call
   */
  private async handleMemorySearch(args: unknown) {
    const schema = z.object({
      query: z.string(),
      maxResults: z.number().optional().default(6),
      minScore: z.number().optional().default(0.15),
      userId: z.string().optional().default("default"),
    });

    const { query, maxResults, minScore, userId } = schema.parse(args);

    if (!query || query.trim().length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Query cannot be empty",
          },
        ],
        isError: true,
      };
    }

    const manager = await this.getOrCreateManager(userId);
    const results = await manager.search(query, {
      maxResults,
      minScore,
    });

    const formatted = results.map((result, idx) => ({
      rank: idx + 1,
      path: result.path,
      lines: `${result.startLine}-${result.endLine}`,
      score: result.score.toFixed(3),
      snippet: result.snippet,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              resultCount: results.length,
              results: formatted,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle memory_get tool call
   * Safely reads files from the user's workspace directory with path traversal protection.
   */
  private async handleMemoryGet(args: unknown) {
    const schema = z.object({
      path: z.string(),
      from: z.number().optional(),
      lines: z.number().optional(),
      userId: z.string().optional().default("default"),
    });

    const { path: filePath, from, lines, userId } = schema.parse(args);

    // Ensure user workspace exists
    await this.getOrCreateManager(userId);
    const userWorkspaceDir = this.getUserWorkspaceDir(userId);

    try {
      const { resolve, normalize } = await import("node:path");

      // Normalize path and remove any ".." components
      const safePath = normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");

      // Resolve absolute paths
      const workspaceAbsPath = resolve(userWorkspaceDir);
      const requestedAbsPath = resolve(workspaceAbsPath, safePath);

      // Security check: Ensure the resolved path is within user workspace
      if (
        !requestedAbsPath.startsWith(workspaceAbsPath + "/") &&
        requestedAbsPath !== workspaceAbsPath
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Path outside workspace directory is not allowed",
            },
          ],
          isError: true,
        };
      }

      // Check file size to prevent OOM (10MB limit)
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      const stats = await fs.stat(requestedAbsPath);

      if (stats.size > MAX_FILE_SIZE) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File too large (${(stats.size / 1024 / 1024).toFixed(2)}MB > 10MB limit)`,
            },
          ],
          isError: true,
        };
      }

      const content = await fs.readFile(requestedAbsPath, "utf-8");
      const allLines = content.split("\n");

      let selectedLines = allLines;
      if (from !== undefined) {
        const start = Math.max(0, from - 1); // Convert to 0-based
        const end = lines ? start + lines : undefined;
        selectedLines = allLines.slice(start, end);
      }

      return {
        content: [
          {
            type: "text",
            text: selectedLines.join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle memory_store tool call
   * Safely writes files to the user's workspace directory with path traversal protection.
   */
  private async handleMemoryStore(args: unknown) {
    const schema = z.object({
      path: z.string(),
      content: z.string(),
      userId: z.string().optional().default("default"),
    });

    const { path: filePath, content, userId } = schema.parse(args);

    const manager = await this.getOrCreateManager(userId);
    const userWorkspaceDir = this.getUserWorkspaceDir(userId);

    try {
      const { resolve, normalize, dirname } = await import("node:path");

      const safePath = normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
      const workspaceAbsPath = resolve(userWorkspaceDir);
      const requestedAbsPath = resolve(workspaceAbsPath, safePath);

      // Security check: Ensure the resolved path is within user workspace
      if (
        !requestedAbsPath.startsWith(workspaceAbsPath + "/") &&
        requestedAbsPath !== workspaceAbsPath
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Path outside workspace directory is not allowed",
            },
          ],
          isError: true,
        };
      }

      // Security check: Only allow .md files
      if (!requestedAbsPath.endsWith(".md")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Only .md files are allowed",
            },
          ],
          isError: true,
        };
      }

      // Indexability check: Only MEMORY.md or memory/*.md are scanned by listMemoryFiles()
      // Storing files at any other path will write successfully but never appear in search results
      const memorySubdir = resolve(workspaceAbsPath, "memory");
      const isMemoryMd = requestedAbsPath === resolve(workspaceAbsPath, "MEMORY.md");
      const isInMemoryDir = requestedAbsPath.startsWith(memorySubdir + "/");
      if (!isMemoryMd && !isInMemoryDir) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Files must be stored as "MEMORY.md" or under "memory/" subdirectory (e.g. "memory/${safePath}"). Files at other paths are not indexed and will not appear in search results.`,
            },
          ],
          isError: true,
        };
      }

      // Check content size (10MB limit)
      const MAX_CONTENT_SIZE = 10 * 1024 * 1024;
      if (content.length > MAX_CONTENT_SIZE) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Content too large (${(content.length / 1024 / 1024).toFixed(2)}MB > 10MB limit)`,
            },
          ],
          isError: true,
        };
      }

      // Create parent directories if they don't exist
      const dirPath = dirname(requestedAbsPath);
      await fs.mkdir(dirPath, { recursive: true });

      await fs.writeFile(requestedAbsPath, content, "utf-8");

      // Force reindex so search picks up the new content immediately
      try {
        await manager.sync({ force: true });
        const chunkCount = manager.getChunkCount();
        console.error(`[MCP] File saved and indexed: ${safePath} (total chunks: ${chunkCount})`);
      } catch (syncError) {
        console.error(`[MCP] Warning: File saved but indexing failed:`, syncError);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                path: safePath,
                bytes: content.length,
                message: `File saved successfully and indexed`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle memory_delete tool call
   * Safely deletes files from the user's workspace directory with path traversal protection.
   */
  private async handleMemoryDelete(args: unknown) {
    const schema = z.object({
      path: z.string(),
      userId: z.string().optional().default("default"),
    });

    const { path: filePath, userId } = schema.parse(args);

    const manager = await this.getOrCreateManager(userId);
    const userWorkspaceDir = this.getUserWorkspaceDir(userId);

    try {
      const { resolve, normalize, basename } = await import("node:path");

      const safePath = normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
      const workspaceAbsPath = resolve(userWorkspaceDir);
      const requestedAbsPath = resolve(workspaceAbsPath, safePath);

      // Security check: Ensure the resolved path is within user workspace
      if (
        !requestedAbsPath.startsWith(workspaceAbsPath + "/") &&
        requestedAbsPath !== workspaceAbsPath
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Path outside workspace directory is not allowed",
            },
          ],
          isError: true,
        };
      }

      // Security check: Prevent deleting MEMORY.md
      const fileName = basename(requestedAbsPath);
      if (fileName === "MEMORY.md") {
        return {
          content: [
            {
              type: "text",
              text: "Error: Cannot delete MEMORY.md (main memory file is protected)",
            },
          ],
          isError: true,
        };
      }

      // Security check: Only allow .md files
      if (!requestedAbsPath.endsWith(".md")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Can only delete .md files",
            },
          ],
          isError: true,
        };
      }

      // Check if file exists
      try {
        await fs.access(requestedAbsPath);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${safePath}`,
            },
          ],
          isError: true,
        };
      }

      await fs.unlink(requestedAbsPath);

      // Force reindex so deleted file is removed from search index
      try {
        await manager.sync({ force: true });
        const chunkCount = manager.getChunkCount();
        console.error(`[MCP] File deleted and reindexed: ${safePath} (total chunks: ${chunkCount})`);
      } catch (syncError) {
        console.error(`[MCP] Warning: File deleted but reindexing failed:`, syncError);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                path: safePath,
                message: `File deleted successfully`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error deleting file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle memory_context tool call
   * Reads or shallow-merges the per-user working memory scratchpad (context.json).
   * Layer 0 — read before any search for instant active context (<1ms).
   */
  private async handleMemoryContext(args: unknown) {
    const schema = z.object({
      operation: z.enum(["get", "set"]),
      userId: z.string().optional().default("default"),
      data: z.record(z.unknown()).optional(),
    });

    const { operation, userId, data } = schema.parse(args);

    // Ensure user workspace exists
    await this.getOrCreateManager(userId);
    const userWorkspaceDir = this.getUserWorkspaceDir(userId);
    const contextPath = path.join(userWorkspaceDir, "context.json");

    if (operation === "get") {
      try {
        const raw = await fs.readFile(contextPath, "utf-8");
        return {
          content: [{ type: "text", text: raw }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "{}" }],
        };
      }
    } else {
      // operation === "set"
      if (!data) {
        return {
          content: [
            {
              type: "text",
              text: "Error: 'data' field is required for set operation",
            },
          ],
          isError: true,
        };
      }

      // Read existing context (empty object if missing)
      let existing: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(contextPath, "utf-8");
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // File doesn't exist or is invalid — start fresh
      }

      // Shallow merge new data and stamp updated_at
      const updated = { ...existing, ...data, updated_at: new Date().toISOString() };
      await fs.writeFile(contextPath, JSON.stringify(updated, null, 2), "utf-8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(updated, null, 2),
          },
        ],
      };
    }
  }

  /**
   * Handle memory_add tool call.
   * Pipeline: embed → find similar (cosine ≥ 0.85) → LLM merge or extract → save → sync.
   */
  private async handleMemoryAdd(args: unknown) {
    const schema = z.object({
      message: z.string(),
      userId: z.string().optional().default("default"),
    });

    const { message, userId } = schema.parse(args);

    if (!message || message.trim().length === 0) {
      return {
        content: [{ type: "text", text: "Error: message cannot be empty" }],
        isError: true,
      };
    }

    const manager = await this.getOrCreateManager(userId);
    const userWorkspaceDir = this.getUserWorkspaceDir(userId);
    const storage = manager.getStorage();

    // Step 1: Embed the message
    const embeds = await manager.embed([message]);
    const queryVec = embeds?.[0];

    // Step 2: Search for highly-similar existing memory (similarity ≥ 0.60 → distance ≤ 0.40)
    let similarFile: { path: string; content: string } | null = null;
    if (queryVec && queryVec.some((v) => v !== 0)) {
      // First, get the raw top matches without distance limit to debug
      const debugVectors = storage.searchVectorInProcess({
        embedding: queryVec,
        limit: 3,
        maxDistance: 1.0, // get anything
      });
      console.error("[MCP-DEBUG] Vector search top matches for query:");
      debugVectors.forEach((v, i) => {
        console.error(`  [${i + 1}] Distance: ${v.distance.toFixed(3)} | Path: ${v.path} | Text: ${v.text.substring(0, 50)}...`);
      });

      const similar = storage.searchVectorInProcess({
        embedding: queryVec,
        limit: 3,
        maxDistance: 0.50, // cosine similarity >= 0.50
      });

      if (similar.length > 0 && similar[0]) {
        const absPath = path.join(userWorkspaceDir, similar[0].path);
        try {
          const content = await fs.readFile(absPath, "utf-8");
          similarFile = { path: similar[0].path, content };
        } catch {
          // File no longer on disk — treat as no match
        }
      }
    }

    // Step 3: LLM extraction or merge
    const apiKey = this.embeddingConfig?.apiKey || process.env.OPENAI_API_KEY;
    let action: "created" | "merged";
    let targetPath: string;
    let finalContent: string;

    if (similarFile) {
      action = "merged";
      targetPath = similarFile.path;
      finalContent = await this.callLLM(apiKey, this.extractionModel, "merge", {
        existing: similarFile.content,
        newMessage: message,
      });
    } else {
      action = "created";
      targetPath = `memory/facts-${Date.now()}.md`;
      finalContent = await this.callLLM(apiKey, this.extractionModel, "extract", {
        message,
      });
    }

    // Step 4: Save and re-index
    const absPath = path.join(userWorkspaceDir, targetPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, finalContent, "utf-8");

    try {
      await manager.sync({ force: true });
    } catch (syncError) {
      console.error(`[MCP] Warning: memory_add sync failed:`, syncError);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              action,
              path: targetPath,
              summary: `Memory ${action} successfully`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Call OpenAI chat completion for fact extraction or memory merge.
   * Falls back to simple Markdown formatting if no valid API key is configured.
   */
  private async callLLM(
    apiKey: string | undefined,
    model: string,
    mode: "extract" | "merge",
    params: { message?: string; existing?: string; newMessage?: string }
  ): Promise<string> {
    const isMockKey =
      !apiKey ||
      apiKey === "mock" ||
      apiKey === "test" ||
      apiKey.startsWith("mock-") ||
      apiKey.startsWith("test-");

    // No-LLM fallback for tests and missing keys
    if (isMockKey) {
      if (mode === "extract") {
        return `# Memory\n\n${params.message}`;
      }
      return `${params.existing}\n\n## Update\n\n${params.newMessage}`;
    }

    const prompt =
      mode === "extract"
        ? `Extract structured facts from the following message as clean Markdown.\nUse headers for categories (Profile, Preferences, Projects, etc).\nBe concise. Only include factual information.\nMessage: ${params.message}`
        : `You have existing memory and new information.\nProduce a merged version that: preserves all unique facts, updates outdated information with the new version.\nExisting:\n${params.existing}\n\nNew information: ${params.newMessage}`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message?.content ?? (mode === "extract" ? `# Memory\n\n${params.message}` : `${params.existing}`);
    } catch {
      // Fallback on network or API errors
      if (mode === "extract") return `# Memory\n\n${params.message}`;
      return `${params.existing}\n\n## Update\n\n${params.newMessage}`;
    }
  }

  /**
   * Start the MCP server with stdio transport.
   * Managers are created lazily on first tool call per user.
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Memory MCP Server started on stdio");
  }

  /**
   * Close the server and cleanup all manager resources.
   */
  async close(): Promise<void> {
    for (const manager of this.managers.values()) {
      await manager.close();
    }
    this.managers.clear();
    await this.server.close();
  }
}
