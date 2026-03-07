/**
 * Integration Tests - End-to-End Memory Flows
 *
 * Tests the COMPLETE flow as a user would experience it:
 * Store → Index → Search → Find → Update → Delete
 *
 * These tests use the MCP Server handlers directly (same as n8n would call them).
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { MemoryMcpServer } from "./index.js";
import fs from "node:fs";
import path from "node:path";

/** Helper to parse MCP tool response */
function parseResponse(result: { content: Array<{ text: string }>; isError?: boolean }) {
  const text = result.content[0]?.text ?? "";
  try {
    return { data: JSON.parse(text), raw: text, isError: result.isError };
  } catch {
    return { data: null, raw: text, isError: result.isError };
  }
}

describe("Integration: End-to-End Memory Flows", () => {
  let server: MemoryMcpServer;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), ".test-integration");
    workspaceDir = path.join(tempDir, `workspace-${Date.now()}`);

    // Only create the root workspace dir; per-user MEMORY.md is auto-created by getOrCreateManager
    fs.mkdirSync(workspaceDir, { recursive: true });

    server = new MemoryMcpServer({
      workspaceDir,
      embedding: { provider: "openai", apiKey: "mock" },
    });
  });

  afterEach(async () => {
    await server.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =============================================
  // FLOW 1: Store → Search → Find
  // =============================================
  describe("Flow: Store → Search → Find", () => {
    test("stores a memory and finds it by keyword", async () => {
      // Step 1: Store a memory
      const storeResult = await server["handleMemoryStore"]({
        path: "memory/contacts.md",
        content: "# Contacts\n\n## Carlos\n- Email: carlos@email.com\n- Role: Tech Lead\n- Birthday: March 15",
      });
      const store = parseResponse(storeResult);
      expect(store.isError).toBeUndefined();
      expect(store.data.success).toBe(true);

      // Step 2: Search for it
      const searchResult = await server["handleMemorySearch"]({
        query: "Carlos",
        minScore: 0,
      });
      const search = parseResponse(searchResult);
      expect(search.data.resultCount).toBeGreaterThan(0);

      // Step 3: Verify content is correct
      const found = search.data.results.some(
        (r: { snippet: string }) => r.snippet.includes("Carlos")
      );
      expect(found).toBe(true);
    });

    test("stores multiple files and searches across all", async () => {
      // Store file 1
      await server["handleMemoryStore"]({
        path: "memory/projects.md",
        content: "# Projects\n\n## MemoryClaw\nMemory engine for AI agents.",
      });

      // Store file 2
      await server["handleMemoryStore"]({
        path: "memory/meetings.md",
        content: "# Meetings\n\n## 2026-02-06\nDiscussed roadmap with team.",
      });

      // Search across both
      const r1 = parseResponse(
        await server["handleMemorySearch"]({ query: "MemoryClaw", minScore: 0 })
      );
      expect(r1.data.resultCount).toBeGreaterThan(0);

      const r2 = parseResponse(
        await server["handleMemorySearch"]({ query: "roadmap", minScore: 0 })
      );
      expect(r2.data.resultCount).toBeGreaterThan(0);
    });
  });

  // =============================================
  // FLOW 2: Store → Update → Search (sees new content)
  // =============================================
  describe("Flow: Store → Update → Search sees latest", () => {
    test("updating a file shows new content in search", async () => {
      // Step 1: Store initial version
      await server["handleMemoryStore"]({
        path: "memory/status.md",
        content: "# Status\n\nProject is in planning phase.",
      });

      // Step 2: Update the file
      await server["handleMemoryStore"]({
        path: "memory/status.md",
        content: "# Status\n\nProject is in development phase. Sprint 1 started.",
      });

      // Step 3: Search should find new content
      const result = parseResponse(
        await server["handleMemorySearch"]({ query: "Sprint", minScore: 0 })
      );
      expect(result.data.resultCount).toBeGreaterThan(0);

      const found = result.data.results.some(
        (r: { snippet: string }) => r.snippet.includes("Sprint")
      );
      expect(found).toBe(true);
    });
  });

  // =============================================
  // FLOW 3: Store → Delete → Search (gone)
  // =============================================
  describe("Flow: Store → Delete → Search finds nothing", () => {
    test("deleted memory disappears from search", async () => {
      // Step 1: Store
      await server["handleMemoryStore"]({
        path: "memory/temporary.md",
        content: "# Temporary\n\nThis has a xylophone keyword.",
      });

      // Step 2: Verify it's searchable
      const before = parseResponse(
        await server["handleMemorySearch"]({ query: "xylophone", minScore: 0 })
      );
      expect(before.data.resultCount).toBeGreaterThan(0);

      // Step 3: Delete
      const deleteResult = await server["handleMemoryDelete"]({
        path: "memory/temporary.md",
      });
      expect(parseResponse(deleteResult).data.success).toBe(true);

      // Step 4: Search should NOT find it
      const after = parseResponse(
        await server["handleMemorySearch"]({ query: "xylophone", minScore: 0 })
      );
      expect(after.data.resultCount).toBe(0);
    });
  });

  // =============================================
  // FLOW 4: Store → Get → Verify content
  // =============================================
  describe("Flow: Store → Get → Read back", () => {
    test("can store and read back exact content", async () => {
      const content = "# Notes\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5";

      await server["handleMemoryStore"]({
        path: "memory/notes.md",
        content,
      });

      // Get full file
      const fullResult = await server["handleMemoryGet"]({
        path: "memory/notes.md",
      });
      expect(fullResult.content[0]?.text).toBe(content);

      // Get specific lines (lines 3-4)
      const rangeResult = await server["handleMemoryGet"]({
        path: "memory/notes.md",
        from: 3,
        lines: 2,
      });
      expect(rangeResult.content[0]?.text).toBe("Line 1\nLine 2");
    });
  });

  // =============================================
  // FLOW 5: Large workspace (many files)
  // =============================================
  describe("Flow: Large workspace", () => {
    test("handles 20 files and searches across all", async () => {
      // Create 20 memory files with unique keywords
      for (let i = 1; i <= 20; i++) {
        const topic = i % 2 === 0 ? "kubernetes" : "postgresql";
        await server["handleMemoryStore"]({
          path: `memory/note-${i.toString().padStart(2, "0")}.md`,
          content: `# Note ${i}\n\nThis note covers ${topic} configuration.`,
        });
      }

      // Search for kubernetes (even notes)
      const k8sResults = parseResponse(
        await server["handleMemorySearch"]({ query: "kubernetes", minScore: 0, maxResults: 20 })
      );
      expect(k8sResults.data.resultCount).toBeGreaterThan(0);

      // Search for postgresql (odd notes)
      const pgResults = parseResponse(
        await server["handleMemorySearch"]({ query: "postgresql", minScore: 0, maxResults: 20 })
      );
      expect(pgResults.data.resultCount).toBeGreaterThan(0);
    });
  });

  // =============================================
  // FLOW 6: Security - Path traversal
  // =============================================
  describe("Flow: Security", () => {
    test("blocks non-.md file operations", async () => {
      // Store non-.md file
      const storeResult = await server["handleMemoryStore"]({
        path: "memory/hack.js",
        content: "console.log('hacked')",
      });
      expect(storeResult.isError).toBe(true);

      const storeResult2 = await server["handleMemoryStore"]({
        path: "memory/data.json",
        content: '{"hack": true}',
      });
      expect(storeResult2.isError).toBe(true);
    });

    test("blocks absolute path outside workspace", async () => {
      const storeResult = await server["handleMemoryStore"]({
        path: "/etc/passwd.md",
        content: "hack",
      });
      // /etc/passwd.md resolves outside workspace
      expect(storeResult.isError).toBe(true);
    });

    test("protects MEMORY.md from deletion", async () => {
      const result = await server["handleMemoryDelete"]({ path: "MEMORY.md" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("protected");
    });

    test("rejects deleting non-.md files", async () => {
      const result = await server["handleMemoryDelete"]({ path: "memory/file.js" });
      expect(result.isError).toBe(true);
    });

    test("rejects reading paths outside workspace", async () => {
      const result = await server["handleMemoryGet"]({ path: "/etc/hosts" });
      expect(result.isError).toBe(true);
    });
  });

  // =============================================
  // FLOW 7: Edge cases
  // =============================================
  describe("Flow: Edge cases", () => {
    test("empty search returns error", async () => {
      const result = await server["handleMemorySearch"]({ query: "" });
      expect(result.isError).toBe(true);
    });

    test("search with no memories returns 0 results", async () => {
      // Create fresh workspace with no memory files except base MEMORY.md
      const result = parseResponse(
        await server["handleMemorySearch"]({ query: "nonexistent unicorn", minScore: 0 })
      );
      expect(result.data.resultCount).toBe(0);
    });

    test("stores file with unicode content", async () => {
      const content = "# Notas\n\n## Reunião 日本語\nDiscutimos o projeto. Ação: café ☕ às 15h.";

      await server["handleMemoryStore"]({
        path: "memory/unicode.md",
        content,
      });

      const getResult = await server["handleMemoryGet"]({ path: "memory/unicode.md" });
      expect(getResult.content[0]?.text).toBe(content);

      const searchResult = parseResponse(
        await server["handleMemorySearch"]({ query: "café", minScore: 0 })
      );
      expect(searchResult.data.resultCount).toBeGreaterThan(0);
    });

    test("handles nested directory creation", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/2026/02/06/daily.md",
        content: "# Daily Note\n\nToday I worked on tests.",
      });
      expect(parseResponse(result).data.success).toBe(true);

      const filePath = path.join(workspaceDir, "users/default/memory/2026/02/06/daily.md");
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
