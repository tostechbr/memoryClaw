#!/usr/bin/env node

// Test memory_store tool
// Creates a new memory file and validates it was saved correctly

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = spawn('node', [resolve(__dirname, 'dist/cli.js')], {
  env: {
    ...process.env,
    MEMORY_WORKSPACE_DIR: resolve(__dirname, '../../test-workspace-mcp'),
    OPENAI_API_KEY: 'test-key-for-local-testing'
  },
  stdio: ['pipe', 'pipe', 'inherit']
});

let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();

  const lines = buffer.split('\n');
  buffer = lines.pop();

  lines.forEach(line => {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log('📨 Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        console.log('📝 Raw:', line);
      }
    }
  });
});

// Test 1: List tools (verify memory_store exists)
console.log('🧪 Test 1: List tools (should include memory_store)\n');
server.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list"
}) + '\n');

// Test 2: Store a new memory file
setTimeout(() => {
  console.log('\n🧪 Test 2: Store new memory file\n');
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "memory_store",
      arguments: {
        path: "memory/test-2026-02-06.md",
        content: "# Test Memory\n\nThis is a test memory created on 2026-02-06.\n\n## Topics\n- memory_store tool testing\n- n8n integration\n- MemoryClaw development"
      }
    }
  }) + '\n');
}, 2000);

// Test 3: Search for the stored content
setTimeout(() => {
  console.log('\n🧪 Test 3: Search for "memory_store tool"\n');
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "memory_search",
      arguments: {
        query: "memory_store tool testing",
        maxResults: 3,
        minScore: 0
      }
    }
  }) + '\n');
}, 4000);

// Test 4: Read the stored file
setTimeout(() => {
  console.log('\n🧪 Test 4: Read the stored file\n');
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "memory_get",
      arguments: {
        path: "memory/test-2026-02-06.md"
      }
    }
  }) + '\n');
}, 6000);

// Test 5: Update the file
setTimeout(() => {
  console.log('\n🧪 Test 5: Update the file\n');
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "memory_store",
      arguments: {
        path: "memory/test-2026-02-06.md",
        content: "# Test Memory (Updated)\n\nThis file was updated successfully!\n\n## Updated Topics\n- memory_store tool ✅\n- File updates working ✅"
      }
    }
  }) + '\n');
}, 8000);

// Test 6: Verify the update
setTimeout(() => {
  console.log('\n🧪 Test 6: Verify update by reading file again\n');
  server.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "memory_get",
      arguments: {
        path: "memory/test-2026-02-06.md"
      }
    }
  }) + '\n');
}, 10000);

// Close after 12 seconds
setTimeout(() => {
  console.log('\n✅ All tests complete!\n');
  server.stdin.end();
  setTimeout(() => process.exit(0), 500);
}, 12000);

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});
