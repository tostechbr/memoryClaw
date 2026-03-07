/**
 * Isolation Tests — Multi-User Workspace Isolation
 *
 * Verifies that each userId gets a completely separate workspace and database.
 * User A's data must never appear in User B's search results, and vice versa.
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { MemoryMcpServer } from "./index.js";
import fs from "node:fs";
import path from "node:path";

/** Parse a tool response into { data, raw, isError } */
function parse(result: { content: Array<{ text: string }>; isError?: boolean }) {
  const text = result.content[0]?.text ?? "";
  try {
    return { data: JSON.parse(text), raw: text, isError: result.isError };
  } catch {
    return { data: null, raw: text, isError: result.isError };
  }
}

describe("Multi-User Isolation", () => {
  let server: MemoryMcpServer;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tempDir = path.join(process.cwd(), ".test-isolation");
    workspaceDir = path.join(tempDir, `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  // ─── Memory Search Isolation ──────────────────────────────────────────────

  test("User A stores a memory → User B cannot find it", async () => {
    // User A writes a unique keyword
    await server["handleMemoryStore"]({
      path: "memory/note.md",
      content: "# Note\n\nUser A secret: dragonfly7742",
      userId: "user_a",
    });

    // User B searches for that keyword
    const result = parse(
      await server["handleMemorySearch"]({
        query: "dragonfly7742",
        minScore: 0,
        userId: "user_b",
      })
    );

    expect(result.data.resultCount).toBe(0);
  });

  test("User A stores a memory → User A can find it (sanity check)", async () => {
    await server["handleMemoryStore"]({
      path: "memory/note.md",
      content: "# Note\n\nUser A topic: starfish8821",
      userId: "user_a",
    });

    const result = parse(
      await server["handleMemorySearch"]({
        query: "starfish8821",
        minScore: 0,
        userId: "user_a",
      })
    );

    expect(result.data.resultCount).toBeGreaterThan(0);
  });

  test("User B stores a memory → User A cannot find it", async () => {
    await server["handleMemoryStore"]({
      path: "memory/note.md",
      content: "# Note\n\nUser B secret: cactus5533",
      userId: "user_b",
    });

    const result = parse(
      await server["handleMemorySearch"]({
        query: "cactus5533",
        minScore: 0,
        userId: "user_a",
      })
    );

    expect(result.data.resultCount).toBe(0);
  });

  test("Same filename in both users causes no conflict", async () => {
    await server["handleMemoryStore"]({
      path: "memory/shared-name.md",
      content: "# User A\n\nContent: thunderbolt9901",
      userId: "user_a",
    });

    await server["handleMemoryStore"]({
      path: "memory/shared-name.md",
      content: "# User B\n\nContent: moonbeam4412",
      userId: "user_b",
    });

    const resultA = parse(
      await server["handleMemorySearch"]({ query: "thunderbolt9901", minScore: 0, userId: "user_a" })
    );
    const resultB = parse(
      await server["handleMemorySearch"]({ query: "moonbeam4412", minScore: 0, userId: "user_b" })
    );

    expect(resultA.data.resultCount).toBeGreaterThan(0);
    expect(resultB.data.resultCount).toBeGreaterThan(0);

    // Cross-check: User A cannot see User B's content in the same filename
    const crossA = parse(
      await server["handleMemorySearch"]({ query: "moonbeam4412", minScore: 0, userId: "user_a" })
    );
    expect(crossA.data.resultCount).toBe(0);
  });

  test("User A deletes a file → User B is not affected", async () => {
    const sharedKeyword = "pineapple6677";

    // Both users store with same keyword
    await server["handleMemoryStore"]({
      path: "memory/fruit.md",
      content: `# Fruit\n\nKeyword: ${sharedKeyword}`,
      userId: "user_a",
    });
    await server["handleMemoryStore"]({
      path: "memory/fruit.md",
      content: `# Fruit\n\nKeyword: ${sharedKeyword}`,
      userId: "user_b",
    });

    // User A deletes their file
    await server["handleMemoryDelete"]({ path: "memory/fruit.md", userId: "user_a" });

    // User A can no longer find it
    const resultA = parse(
      await server["handleMemorySearch"]({ query: sharedKeyword, minScore: 0, userId: "user_a" })
    );
    expect(resultA.data.resultCount).toBe(0);

    // User B is unaffected
    const resultB = parse(
      await server["handleMemorySearch"]({ query: sharedKeyword, minScore: 0, userId: "user_b" })
    );
    expect(resultB.data.resultCount).toBeGreaterThan(0);
  });

  test("Default user (no userId) works without errors", async () => {
    const result = await server["handleMemorySearch"]({
      query: "anything",
      minScore: 0,
      // no userId → defaults to "default"
    });

    expect(result.isError).toBeUndefined();
    const data = parse(result);
    expect(typeof data.data.resultCount).toBe("number");
  });

  test("Default user is isolated from explicit userId", async () => {
    await server["handleMemoryStore"]({
      path: "memory/note.md",
      content: "# Note\n\nDefault-only keyword: velvethorn3311",
      // no userId → default
    });

    // Explicit userId should not see it
    const result = parse(
      await server["handleMemorySearch"]({
        query: "velvethorn3311",
        minScore: 0,
        userId: "other_user",
      })
    );

    expect(result.data.resultCount).toBe(0);
  });

  // ─── Physical Workspace Separation ───────────────────────────────────────

  test("Workspace directories are physically separate", async () => {
    // Trigger workspace creation for both users
    await server["handleMemorySearch"]({ query: "test", minScore: 0, userId: "alice" });
    await server["handleMemorySearch"]({ query: "test", minScore: 0, userId: "bob" });

    const aliceDir = path.join(workspaceDir, "users", "alice");
    const bobDir = path.join(workspaceDir, "users", "bob");

    expect(fs.existsSync(aliceDir)).toBe(true);
    expect(fs.existsSync(bobDir)).toBe(true);
    expect(aliceDir).not.toBe(bobDir);
  });

  // ─── memory_context Isolation ────────────────────────────────────────────

  test("memory_context get returns {} for a new user", async () => {
    const result = await server["handleMemoryContext"]({
      operation: "get",
      userId: "brand_new_user",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text.trim()).toBe("{}");
  });

  test("memory_context set for User A stores data correctly", async () => {
    const result = await server["handleMemoryContext"]({
      operation: "set",
      userId: "user_x",
      data: { active_topic: "Sprint 0", session_id: "ws-2026-03" },
    });

    expect(result.isError).toBeUndefined();
    const context = JSON.parse(result.content[0].text);
    expect(context.active_topic).toBe("Sprint 0");
    expect(context.session_id).toBe("ws-2026-03");
    expect(context.updated_at).toBeDefined();
  });

  test("memory_context User A and User B have separate contexts", async () => {
    // User A sets their context
    await server["handleMemoryContext"]({
      operation: "set",
      userId: "user_alpha",
      data: { topic: "Project Alpha" },
    });

    // User B sets a different context
    await server["handleMemoryContext"]({
      operation: "set",
      userId: "user_beta",
      data: { topic: "Project Beta" },
    });

    // Each reads back only their own context
    const alphaResult = await server["handleMemoryContext"]({
      operation: "get",
      userId: "user_alpha",
    });
    const betaResult = await server["handleMemoryContext"]({
      operation: "get",
      userId: "user_beta",
    });

    const alphaCtx = JSON.parse(alphaResult.content[0].text);
    const betaCtx = JSON.parse(betaResult.content[0].text);

    expect(alphaCtx.topic).toBe("Project Alpha");
    expect(betaCtx.topic).toBe("Project Beta");
  });

  test("memory_context set preserves existing keys on shallow merge", async () => {
    // First set
    await server["handleMemoryContext"]({
      operation: "set",
      userId: "user_merge",
      data: { topic: "Original Topic", session_id: "sess-01" },
    });

    // Second set adds a key without touching the first
    await server["handleMemoryContext"]({
      operation: "set",
      userId: "user_merge",
      data: { pending_task: "Review PR" },
    });

    const result = await server["handleMemoryContext"]({
      operation: "get",
      userId: "user_merge",
    });

    const ctx = JSON.parse(result.content[0].text);
    expect(ctx.topic).toBe("Original Topic");
    expect(ctx.session_id).toBe("sess-01");
    expect(ctx.pending_task).toBe("Review PR");
  });
});
