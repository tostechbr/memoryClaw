/**
 * QA Scenarios - Simulating Real User Flows
 *
 * This script simulates what a real user would do with Akashic Context
 * through n8n or Claude Desktop. It calls the MCP tools in sequence
 * and validates the results.
 *
 * Run with: npx tsx src/qa-scenarios.ts
 */

import { MemoryMcpServer } from "./index.js";
import fs from "node:fs";
import path from "node:path";

// ============================================
// Setup
// ============================================

const QA_WORKSPACE = path.join(process.cwd(), ".qa-workspace");
const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function parseResponse(result: { content: Array<{ text: string }>; isError?: boolean }) {
  const text = result.content[0]?.text ?? "";
  try {
    return { data: JSON.parse(text), raw: text, isError: result.isError };
  } catch {
    return { data: null, raw: text, isError: result.isError };
  }
}

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${PASS} ${message}`);
  } else {
    failedTests++;
    console.log(`  ${FAIL} ${message}`);
  }
}

function assertContains(haystack: string, needle: string, message: string): void {
  assert(haystack.toLowerCase().includes(needle.toLowerCase()), message);
}

// ============================================
// Scenario 1: Personal Assistant
// ============================================
async function scenarioPersonalAssistant(server: MemoryMcpServer) {
  console.log("\n📋 SCENARIO 1: Personal Assistant");
  console.log("   User stores personal info, assistant remembers it\n");

  // User tells the assistant about themselves
  await server["handleMemoryStore"]({
    path: "memory/profile.md",
    content: `# About Me

## Personal
- Name: Tiago Santos
- Location: São Paulo, Brazil
- Languages: Portuguese, English, Spanish

## Work
- Role: Software Developer
- Company: TostechBR
- Focus: AI and automation

## Preferences
- Editor: VS Code with Copilot
- Stack: TypeScript, Node.js, Python
- Coffee: Espresso, no sugar
`,
  });

  // User stores their projects
  await server["handleMemoryStore"]({
    path: "memory/projects.md",
    content: `# My Projects

## Akashic Context
- Status: Active development
- Description: Memory engine for AI agents
- Tech: TypeScript, SQLite, MCP Protocol
- Goal: Give AI agents persistent memory

## Client Portal
- Status: Maintenance
- Description: Customer-facing dashboard
- Tech: Next.js, Prisma, PostgreSQL
`,
  });

  // Now the assistant searches for user info
  const whoAmI = parseResponse(
    await server["handleMemorySearch"]({ query: "Tiago", minScore: 0 })
  );
  assert(whoAmI.data.resultCount > 0, "Finds user profile by name");
  if (whoAmI.data.resultCount > 0) {
    assertContains(
      whoAmI.data.results[0].snippet,
      "Tiago",
      "Profile contains user name"
    );
  }

  // Search for work-related info
  const work = parseResponse(
    await server["handleMemorySearch"]({ query: "developer company", minScore: 0 })
  );
  assert(work.data.resultCount > 0, "Finds work information");

  // Search for projects
  const projects = parseResponse(
    await server["handleMemorySearch"]({ query: "Akashic", minScore: 0 })
  );
  assert(projects.data.resultCount > 0, "Finds project by name");

  // Semantic search (this tests quality — may fail with keyword-only)
  const semantic = parseResponse(
    await server["handleMemorySearch"]({ query: "what does the user do for a living", minScore: 0 })
  );
  if (semantic.data.resultCount > 0) {
    console.log(`  ${PASS} Semantic search found results (bonus!)`);
  } else {
    console.log(`  ${WARN} Semantic search returned 0 results (expected with keyword-only, will improve with vector search)`);
  }
}

// ============================================
// Scenario 2: Customer Support Bot
// ============================================
async function scenarioCustomerSupport(server: MemoryMcpServer) {
  console.log("\n📋 SCENARIO 2: Customer Support Bot");
  console.log("   Bot remembers customer issues across sessions\n");

  // Customer first contact
  await server["handleMemoryStore"]({
    path: "memory/customers/joao-silva.md",
    content: `# Customer: João Silva

## Contact
- Email: joao@empresa.com
- Plan: Enterprise
- Since: 2025-01-15

## Ticket #1001 (2026-01-20)
- Issue: Login failing with SSO
- Status: Resolved
- Solution: Updated SAML certificate

## Ticket #1002 (2026-02-01)
- Issue: Dashboard loading slow
- Status: In Progress
- Notes: Investigating database queries
`,
  });

  // Another customer
  await server["handleMemoryStore"]({
    path: "memory/customers/maria-costa.md",
    content: `# Customer: Maria Costa

## Contact
- Email: maria@startup.io
- Plan: Pro
- Since: 2025-06-10

## Ticket #1003 (2026-02-05)
- Issue: Cannot export reports to PDF
- Status: Open
- Priority: High
`,
  });

  // Support agent searches for customer
  const joao = parseResponse(
    await server["handleMemorySearch"]({ query: "João Silva", minScore: 0 })
  );
  assert(joao.data.resultCount > 0, "Finds customer by name");

  // Search for issue
  const login = parseResponse(
    await server["handleMemorySearch"]({ query: "login SSO", minScore: 0 })
  );
  assert(login.data.resultCount > 0, "Finds login issue");
  if (login.data.resultCount > 0) {
    assertContains(login.data.results[0].snippet, "SAML", "Contains solution details");
  }

  // Search for open tickets
  const open = parseResponse(
    await server["handleMemorySearch"]({ query: "status open priority", minScore: 0 })
  );
  assert(open.data.resultCount > 0, "Finds open tickets");

  // Update ticket status
  await server["handleMemoryStore"]({
    path: "memory/customers/joao-silva.md",
    content: `# Customer: João Silva

## Contact
- Email: joao@empresa.com
- Plan: Enterprise
- Since: 2025-01-15

## Ticket #1001 (2026-01-20)
- Issue: Login failing with SSO
- Status: Resolved
- Solution: Updated SAML certificate

## Ticket #1002 (2026-02-01)
- Issue: Dashboard loading slow
- Status: Resolved
- Solution: Optimized SQL queries, added index on created_at column
`,
  });

  // Verify updated content
  const updated = parseResponse(
    await server["handleMemorySearch"]({ query: "dashboard optimized", minScore: 0 })
  );
  assert(updated.data.resultCount > 0, "Finds updated ticket with solution");
}

// ============================================
// Scenario 3: Daily Notes / Knowledge Base
// ============================================
async function scenarioDailyNotes(server: MemoryMcpServer) {
  console.log("\n📋 SCENARIO 3: Daily Notes & Knowledge Base");
  console.log("   User keeps daily notes, searches across days\n");

  // Day 1
  await server["handleMemoryStore"]({
    path: "memory/2026-02-03.md",
    content: `# Monday 2026-02-03

## Standup
- Yesterday: Set up project structure
- Today: Implement chunking algorithm
- Blockers: None

## Notes
- Decided to use SQLite instead of PostgreSQL for simplicity
- Meeting with Carlos at 3pm about architecture
`,
  });

  // Day 2
  await server["handleMemoryStore"]({
    path: "memory/2026-02-04.md",
    content: `# Tuesday 2026-02-04

## Standup
- Yesterday: Implemented chunking, started FTS5
- Today: Implement hybrid search
- Blockers: sqlite-vec not loading on macOS

## Notes
- Carlos approved the architecture design
- Need to research sqlite-vec distribution options
- Lunch with Sarah to discuss design system
`,
  });

  // Day 3
  await server["handleMemoryStore"]({
    path: "memory/2026-02-05.md",
    content: `# Wednesday 2026-02-05

## Standup
- Yesterday: Hybrid search working with keyword
- Today: MCP server integration with n8n
- Blockers: n8n community node install issues

## Notes
- MCP server working on stdio
- Tested with Claude Desktop successfully
- TODO: Write integration tests
`,
  });

  // Search across days
  const carlos = parseResponse(
    await server["handleMemorySearch"]({ query: "Carlos", minScore: 0 })
  );
  assert(carlos.data.resultCount > 0, "Finds Carlos across multiple days");

  const blocker = parseResponse(
    await server["handleMemorySearch"]({ query: "sqlite-vec macOS", minScore: 0 })
  );
  assert(blocker.data.resultCount > 0, "Finds specific blocker");

  const standup = parseResponse(
    await server["handleMemorySearch"]({ query: "standup blockers", minScore: 0 })
  );
  assert(standup.data.resultCount > 0, "Finds standup notes");

  // Get specific day's notes
  const day2 = await server["handleMemoryGet"]({ path: "memory/2026-02-04.md" });
  assertContains(day2.content[0]?.text ?? "", "Tuesday", "Reads correct day's notes");

  // Delete old day
  await server["handleMemoryDelete"]({ path: "memory/2026-02-03.md" });

  // Verify Monday's unique content is gone
  const monday = parseResponse(
    await server["handleMemorySearch"]({ query: "chunking algorithm", minScore: 0 })
  );
  // Monday mentioned "chunking algorithm" but also other days might match "chunking"
  // Check if the specific file is gone
  const mondayFileExists = fs.existsSync(path.join(QA_WORKSPACE, "memory/2026-02-03.md"));
  assert(!mondayFileExists, "Monday's file was deleted");
}

// ============================================
// Scenario 4: Multilingual Content
// ============================================
async function scenarioMultilingual(server: MemoryMcpServer) {
  console.log("\n📋 SCENARIO 4: Multilingual Content");
  console.log("   Memory works with Portuguese, English, and mixed content\n");

  await server["handleMemoryStore"]({
    path: "memory/reunioes.md",
    content: `# Reuniões

## 2026-02-06 - Planejamento Sprint
- Participantes: Tiago, Ana, Pedro
- Decisão: Priorizar busca semântica
- Próximos passos: Implementar sqlite-vec
- Prazo: 2 semanas

## 2026-02-05 - Review de Código
- Revisor: Carlos
- Aprovado: Chunking algorithm
- Pendente: Testes de integração
`,
  });

  const reuniao = parseResponse(
    await server["handleMemorySearch"]({ query: "planejamento sprint", minScore: 0 })
  );
  assert(reuniao.data.resultCount > 0, "Finds Portuguese content");

  const participantes = parseResponse(
    await server["handleMemorySearch"]({ query: "Ana Pedro", minScore: 0 })
  );
  assert(participantes.data.resultCount > 0, "Finds participants by name");

  const review = parseResponse(
    await server["handleMemorySearch"]({ query: "código aprovado", minScore: 0 })
  );
  assert(review.data.resultCount > 0, "Finds code review notes in Portuguese");
}

// ============================================
// Main
// ============================================
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║    AKASHIC CONTEXT — QA Scenarios            ║");
  console.log("║    Simulating real user workflows             ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\nWorkspace: ${QA_WORKSPACE}`);
  console.log(`Search mode: Keyword (BM25) — vector search not yet active\n`);

  // Clean up
  if (fs.existsSync(QA_WORKSPACE)) {
    fs.rmSync(QA_WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(QA_WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(QA_WORKSPACE, "MEMORY.md"), "# Memory\n\nQA Test Workspace.");

  const server = new MemoryMcpServer({
    workspaceDir: QA_WORKSPACE,
    embedding: { provider: "openai", apiKey: "mock" },
  });

  try {
    await scenarioPersonalAssistant(server);
    await scenarioCustomerSupport(server);
    await scenarioDailyNotes(server);
    await scenarioMultilingual(server);
  } finally {
    await server.close();

    // Clean up
    if (fs.existsSync(QA_WORKSPACE)) {
      fs.rmSync(QA_WORKSPACE, { recursive: true, force: true });
    }
  }

  // Summary
  console.log("\n══════════════════════════════════════════════");
  console.log(`  RESULTS: ${passedTests}/${totalTests} passed`);
  if (failedTests > 0) {
    console.log(`  ${FAIL} ${failedTests} tests FAILED`);
  } else {
    console.log(`  ${PASS} All tests passed!`);
  }
  console.log("══════════════════════════════════════════════\n");

  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
