/**
 * Tests for Memory Manager
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { MemoryManager, type EmbeddingProvider } from "./manager.js";
import fs from "node:fs";
import path from "node:path";

describe("MemoryManager", () => {
  let manager: MemoryManager;
  let tempDir: string;
  let workspaceDir: string;

  // Mock embedding provider
  const mockProvider: EmbeddingProvider = {
    model: "mock-model",
    async embed(texts: string[]): Promise<number[][]> {
      // Return fixed embeddings for testing
      return texts.map(() => Array.from({ length: 1536 }, () => Math.random()));
    },
  };

  beforeEach(() => {
    // Create temp directories
    tempDir = path.join(process.cwd(), ".test-data");
    workspaceDir = path.join(tempDir, `workspace-${Date.now()}`);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(workspaceDir, { recursive: true });

    manager = new MemoryManager({
      dataDir: tempDir,
      userId: "test-user",
      sessionId: `test-${Date.now()}`,
      workspaceDir,
      memory: {
        enabled: true,
        provider: "openai",
        model: "text-embedding-3-small",
        chunkSize: 400,
        chunkOverlap: 80,
        vectorWeight: 0.7,
        textWeight: 0.3,
        minScore: 0.35,
      },
    });

    manager.setEmbeddingProvider(mockProvider);
  });

  afterEach(async () => {
    await manager.close();

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    test("creates manager instance", () => {
      expect(manager).toBeDefined();
    });

    test("sets embedding provider", () => {
      const provider: EmbeddingProvider = {
        model: "test-model",
        async embed(texts) {
          return texts.map(() => []);
        },
      };

      manager.setEmbeddingProvider(provider);
      expect(true).toBe(true); // No error
    });

    test("gets storage instance", () => {
      const storage = manager.getStorage();
      expect(storage).toBeDefined();
    });
  });

  describe("file syncing", () => {
    test("syncs MEMORY.md file", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      fs.writeFileSync(
        memoryFile,
        "# Memory\n\nThis is a test memory file with some content."
      );

      await manager.sync({ force: true });

      const count = manager.getChunkCount();
      expect(count).toBeGreaterThan(0);
    });

    test("syncs files in memory/ directory", async () => {
      const memoryDir = path.join(workspaceDir, "memory");
      fs.mkdirSync(memoryDir, { recursive: true });

      fs.writeFileSync(
        path.join(memoryDir, "file1.md"),
        "# File 1\n\nContent of file 1."
      );
      fs.writeFileSync(
        path.join(memoryDir, "file2.md"),
        "# File 2\n\nContent of file 2."
      );

      await manager.sync({ force: true });

      const count = manager.getChunkCount();
      expect(count).toBeGreaterThan(0);
    });

    test("skips sync if not dirty", async () => {
      await manager.sync();
      const count1 = manager.getChunkCount();

      await manager.sync(); // Should skip
      const count2 = manager.getChunkCount();

      expect(count1).toBe(count2);
    });

    test("forces sync with force option", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      fs.writeFileSync(memoryFile, "# Test\n\nInitial content.");

      await manager.sync({ force: true });
      const count1 = manager.getChunkCount();

      // Update file
      fs.writeFileSync(memoryFile, "# Test\n\nUpdated content with more text.");

      await manager.sync({ force: true });
      const count2 = manager.getChunkCount();

      expect(count2).toBeGreaterThanOrEqual(count1);
    });

    test("skips unchanged files (hash check)", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      const content = "# Test\n\nStatic content.";
      fs.writeFileSync(memoryFile, content);

      await manager.sync({ force: true });
      const count1 = manager.getChunkCount();

      // Write same content again (hash should match)
      fs.writeFileSync(memoryFile, content);

      await manager.sync({ force: true });
      const count2 = manager.getChunkCount();

      expect(count1).toBe(count2); // No new chunks
    });

    test("handles deleted files", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      fs.writeFileSync(memoryFile, "# Test\n\nContent.");

      await manager.sync({ force: true });
      const count1 = manager.getChunkCount();

      // Delete file
      fs.unlinkSync(memoryFile);

      await manager.sync({ force: true });
      const count2 = manager.getChunkCount();

      expect(count2).toBe(0); // All chunks should be removed
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      // Create test files
      const memoryDir = path.join(workspaceDir, "memory");
      fs.mkdirSync(memoryDir, { recursive: true });

      fs.writeFileSync(
        path.join(memoryDir, "javascript.md"),
        "# JavaScript\n\nJavaScript is a programming language used for web development."
      );

      fs.writeFileSync(
        path.join(memoryDir, "python.md"),
        "# Python\n\nPython is a programming language known for its simplicity."
      );

      await manager.sync({ force: true });
    });

    test("searches memory", async () => {
      const results = await manager.search("programming language", {
        minScore: 0,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.snippet).toBeDefined();
      expect(results[0]?.score).toBeGreaterThan(0);
    });

    test("returns empty array for empty query", async () => {
      const results = await manager.search("");
      expect(results).toEqual([]);
    });

    test("limits results", async () => {
      const results = await manager.search("programming", { maxResults: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    test("filters by min score", async () => {
      const results = await manager.search("programming", { minScore: 0.9 });
      // High min score might return 0 results with mock embeddings
      expect(results.every((r) => r.score >= 0.9)).toBe(true);
    });

    test("auto-syncs if dirty", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      fs.writeFileSync(
        memoryFile,
        "# New File\n\nThis file was added after initial sync."
      );

      // Search should trigger sync
      const results = await manager.search("added after sync");

      // Should find results from newly added file
      expect(results).toBeDefined();
    });
  });

  describe("file watching", () => {
    test("starts watching files", async () => {
      await manager.watch();
      // No error should be thrown
      expect(true).toBe(true);
    });

    test("stops watching files", async () => {
      await manager.watch();
      await manager.unwatch();
      expect(true).toBe(true);
    });

    test("does not start multiple watchers", async () => {
      await manager.watch();
      await manager.watch(); // Should be no-op
      await manager.unwatch();
      expect(true).toBe(true);
    });
  });

  describe("chunk count", () => {
    test("returns chunk count", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      fs.writeFileSync(memoryFile, "# Test\n\nSome content.");

      await manager.sync({ force: true });

      const count = manager.getChunkCount();
      expect(count).toBeGreaterThan(0);
    });

    test("filters count by source", async () => {
      const memoryFile = path.join(workspaceDir, "MEMORY.md");
      fs.writeFileSync(memoryFile, "# Test\n\nSome content.");

      await manager.sync({ force: true });

      const memoryCount = manager.getChunkCount("memory");
      const sessionCount = manager.getChunkCount("sessions");

      expect(memoryCount).toBeGreaterThan(0);
      expect(sessionCount).toBe(0); // No session chunks
    });
  });

  describe("close", () => {
    test("closes manager", async () => {
      await manager.close();
      expect(true).toBe(true);
    });

    test("closes watcher", async () => {
      await manager.watch();
      await manager.close();
      expect(true).toBe(true);
    });

    test("is idempotent", async () => {
      await manager.close();
      await manager.close(); // Should not throw
      expect(true).toBe(true);
    });
  });
});
