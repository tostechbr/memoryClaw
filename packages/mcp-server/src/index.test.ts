/**
 * Unit tests for MCP Server
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { MemoryMcpServer } from "./index.js";
import fs from "node:fs";
import path from "node:path";

describe("MemoryMcpServer", () => {
  let server: MemoryMcpServer;
  let tempDir: string;
  let workspaceDir: string;
  let defaultUserDir: string;

  beforeEach(() => {
    // Create temp directories
    tempDir = path.join(process.cwd(), ".test-mcp-data");
    workspaceDir = path.join(tempDir, `workspace-${Date.now()}`);
    defaultUserDir = path.join(workspaceDir, "users", "default");

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(defaultUserDir, { recursive: true });

    // Create MEMORY.md in the default user's workspace
    fs.writeFileSync(
      path.join(defaultUserDir, "MEMORY.md"),
      "# Test Memory\n\nTest content"
    );

    // Initialize server
    server = new MemoryMcpServer({
      workspaceDir,
      embedding: {
        provider: "openai",
        apiKey: "test-key",
      },
    });
  });

  afterEach(async () => {
    await server.close();

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("initialization", () => {
    test("creates server instance", () => {
      expect(server).toBeDefined();
    });

    test("sets workspace directory", () => {
      expect(server["workspaceDir"]).toBe(workspaceDir);
    });
  });

  describe("handleMemoryStore", () => {
    test("creates new file", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/test.md",
        content: "# Test File\n\nTest content",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("success");
      expect(result.content[0].text).toContain("memory/test.md");

      // Verify file was created in the default user's workspace
      const filePath = path.join(defaultUserDir, "memory/test.md");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe("# Test File\n\nTest content");
    });

    test("updates existing file", async () => {
      // Create file first in the default user's workspace
      const memoryDir = path.join(defaultUserDir, "memory");
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(
        path.join(memoryDir, "existing.md"),
        "Old content"
      );

      // Update it
      const result = await server["handleMemoryStore"]({
        path: "memory/existing.md",
        content: "New content",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("success");

      // Verify content was updated
      const content = fs.readFileSync(
        path.join(memoryDir, "existing.md"),
        "utf-8"
      );
      expect(content).toBe("New content");
    });

    test("creates directories automatically", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/nested/deep/file.md",
        content: "# Deep File",
      });

      expect(result.isError).toBeUndefined();

      // Verify nested directories were created in the default user's workspace
      const filePath = path.join(defaultUserDir, "memory/nested/deep/file.md");
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test("rejects path traversal attacks", async () => {
      const result = await server["handleMemoryStore"]({
        path: "../../../etc/passwd",
        content: "malicious",
      });

      expect(result.isError).toBe(true);
      // Path is normalized, so it fails on .md validation first
      expect(result.content[0].text).toContain("Only .md files");
    });

    test("rejects non-.md files", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/file.txt",
        content: "test",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Only .md files");
    });

    test("rejects files without .md extension", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/file",
        content: "test",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Only .md files");
    });

    test("rejects content larger than 10MB", async () => {
      const largeContent = "x".repeat(11 * 1024 * 1024); // 11MB

      const result = await server["handleMemoryStore"]({
        path: "memory/large.md",
        content: largeContent,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
    });

    test("accepts empty content", async () => {
      const result = await server["handleMemoryStore"]({
        path: "memory/empty.md",
        content: "",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("success");
    });
  });

  describe("handleMemoryDelete", () => {
    test("deletes existing file", async () => {
      // Create file first in the default user's workspace
      const memoryDir = path.join(defaultUserDir, "memory");
      fs.mkdirSync(memoryDir, { recursive: true });
      const filePath = path.join(memoryDir, "temp.md");
      fs.writeFileSync(filePath, "Temporary content");

      // Delete it
      const result = await server["handleMemoryDelete"]({
        path: "memory/temp.md",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("success");
      expect(result.content[0].text).toContain("memory/temp.md");

      // Verify file was deleted
      expect(fs.existsSync(filePath)).toBe(false);
    });

    test("protects MEMORY.md from deletion", async () => {
      const result = await server["handleMemoryDelete"]({
        path: "MEMORY.md",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Cannot delete MEMORY.md");
      expect(result.content[0].text).toContain("protected");

      // Verify MEMORY.md still exists in the default user's workspace
      expect(fs.existsSync(path.join(defaultUserDir, "MEMORY.md"))).toBe(true);
    });

    test("rejects path traversal attacks", async () => {
      const result = await server["handleMemoryDelete"]({
        path: "../../../etc/passwd",
      });

      expect(result.isError).toBe(true);
      // Path is normalized, so it fails on .md validation first
      expect(result.content[0].text).toContain("Can only delete .md files");
    });

    test("rejects non-.md files", async () => {
      const result = await server["handleMemoryDelete"]({
        path: "memory/file.txt",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Can only delete .md files");
    });

    test("returns error for non-existent file", async () => {
      const result = await server["handleMemoryDelete"]({
        path: "memory/does-not-exist.md",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("File not found");
    });
  });

  describe("handleMemoryGet", () => {
    test("reads MEMORY.md", async () => {
      const result = await server["handleMemoryGet"]({
        path: "MEMORY.md",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Test Memory");
    });

    test("reads with line range", async () => {
      // Create file with multiple lines in the default user's workspace
      const memoryDir = path.join(defaultUserDir, "memory");
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(
        path.join(memoryDir, "multiline.md"),
        "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
      );

      const result = await server["handleMemoryGet"]({
        path: "memory/multiline.md",
        from: 2,
        lines: 2,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("Line 2\nLine 3");
    });

    test("rejects path traversal attacks", async () => {
      const result = await server["handleMemoryGet"]({
        path: "../../../etc/passwd",
      });

      expect(result.isError).toBe(true);
      // Path is normalized and file doesn't exist
      expect(result.content[0].text).toContain("Error reading file");
    });
  });

  describe("handleMemorySearch", () => {
    test("searches memory files", async () => {
      const result = await server["handleMemorySearch"]({
        query: "Test",
        maxResults: 5,
        minScore: 0,
      });

      expect(result.isError).toBeUndefined();
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.query).toBe("Test");
      expect(resultData.resultCount).toBeGreaterThanOrEqual(0);
    });

    test("rejects empty query", async () => {
      const result = await server["handleMemorySearch"]({
        query: "",
        maxResults: 5,
        minScore: 0,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cannot be empty");
    });
  });
});
