# Local Testing Guide - Phase 1 Validation

Complete guide to validate all Phase 1 features are working correctly.

## Prerequisites

- ✅ `pnpm build` completed successfully
- ✅ n8n installed locally or n8n cloud account
- ✅ OpenAI API key configured
- ✅ MCP community node installed in n8n

## Test Suite Overview

```
Phase 1 Testing
├── 1. MCP Server Tools (CLI)
│   ├── memory_search ✅
│   ├── memory_get ✅
│   ├── memory_store ✅
│   └── memory_delete ✅
│
├── 2. n8n Integration
│   ├── Basic Workflow (search only)
│   ├── Complete Workflow (search + store)
│   └── Advanced Workflow (full CRUD)
│
└── 3. End-to-End Scenarios
    ├── Knowledge Base Assistant
    ├── Personal Assistant
    └── Conversation Memory
```

## 1. CLI Tests (5 minutes)

Validate MCP tools work correctly via command line.

### Test 1.1: List Tools

```bash
cd packages/mcp-server
node test-simple.js
```

**Expected**: Should list 4 tools:
- `memory_search`
- `memory_get`
- `memory_store`
- `memory_delete`

**Pass criteria**: ✅ All 4 tools appear in the list

---

### Test 1.2: Memory Store

```bash
cd packages/mcp-server
node test-memory-store.js
```

**Expected**:
- ✅ Create new file
- ✅ Update existing file
- ✅ Search finds stored content
- ✅ Read returns correct content

**Pass criteria**: All 6 tests pass

---

### Test 1.3: Memory Delete

```bash
cd packages/mcp-server
node test-memory-delete.js
```

**Expected**:
- ✅ Delete temporary file
- ✅ Protect MEMORY.md from deletion
- ✅ Error on non-existent file
- ✅ Error on path traversal

**Pass criteria**: All 5 tests pass

---

## 2. n8n Integration Tests (15 minutes)

Validate workflows work in n8n.

### Setup

1. Start n8n: `n8n start`
2. Open browser: http://localhost:5678
3. Import workflow: `examples/n8n-chatbot-basic.json`

### Test 2.1: Basic Workflow (Search Only)

**Setup**:
1. Import `n8n-chatbot-basic.json`
2. Update OpenAI credential ID
3. Update MCP credential ID
4. Activate workflow

**Test Cases**:

| Test | User Input | Expected Behavior |
|------|-----------|-------------------|
| 2.1.1 | "What projects am I working on?" | AI searches MEMORY.md, returns project list |
| 2.1.2 | "Who is my technical mentor?" | AI searches memory/, returns contact info |
| 2.1.3 | "What did we discuss yesterday?" | AI searches by date, returns meeting notes |

**Pass criteria**:
- ✅ All searches return relevant results
- ✅ AI provides accurate answers based on memory
- ✅ No errors in n8n execution logs

---

### Test 2.2: Complete Workflow (Search + Store)

**Setup**:
1. Import `n8n-chatbot-complete.json`
2. Update credential IDs
3. Activate workflow

**Test Cases**:

| Test | User Input | Expected Behavior |
|------|-----------|-------------------|
| 2.2.1 | "Remember that I prefer dark mode" | AI stores preference in memory file |
| 2.2.2 | "What are my preferences?" | AI searches and returns stored preferences |
| 2.2.3 | Have a 5-message conversation | AI automatically saves conversation log |

**Validation**:
```bash
# Check files were created
ls -la test-workspace-mcp/memory/
cat test-workspace-mcp/memory/$(date +%Y-%m-%d)-conversation.md
```

**Pass criteria**:
- ✅ Preference stored in memory file
- ✅ Stored information is searchable
- ✅ Conversation log created with correct content

---

### Test 2.3: Advanced Workflow (Full CRUD)

**Setup**:
1. Import `n8n-chatbot-advanced.json`
2. Update credential IDs
3. Activate workflow

**Test Cases**:

| Test | User Input | Expected Behavior |
|------|-----------|-------------------|
| 2.3.1 | "Save a note: Meeting with John at 3pm" | AI creates memory/notes.md |
| 2.3.2 | "Show me the full notes file" | AI uses memory_get to read entire file |
| 2.3.3 | "Delete the notes file" | AI uses memory_delete to remove file |
| 2.3.4 | "Try to delete MEMORY.md" | AI refuses (protected file) |

**Pass criteria**:
- ✅ All CRUD operations work correctly
- ✅ MEMORY.md protection working
- ✅ AI uses appropriate tool for each request

---

## 3. End-to-End Scenarios (20 minutes)

Real-world usage scenarios to validate complete functionality.

### Scenario 3.1: Knowledge Base Assistant

**Goal**: Create a knowledge base that remembers documentation.

**Steps**:
1. Create `test-workspace-mcp/MEMORY.md`:
   ```markdown
   # Product Knowledge Base

   ## API Endpoints
   - GET /api/users - List all users
   - POST /api/users - Create new user

   ## Authentication
   Use Bearer token in Authorization header
   ```

2. Ask in n8n chat:
   - "How do I list users?"
   - "What authentication method do we use?"
   - "What endpoints are available?"

**Pass criteria**:
- ✅ AI finds relevant information
- ✅ Answers are accurate
- ✅ No hallucinations

---

### Scenario 3.2: Personal Assistant

**Goal**: Assistant that remembers user preferences and habits.

**Steps**:
1. Tell assistant:
   - "Remember I wake up at 7am"
   - "I prefer Python over JavaScript"
   - "My favorite color is blue"

2. Wait 5 minutes, then ask:
   - "What time do I wake up?"
   - "Which language should I use for this script?"
   - "What's my favorite color?"

**Validation**:
```bash
# Check memory was saved
find test-workspace-mcp/memory -name "*.md" -newer /tmp/test-start
cat test-workspace-mcp/memory/*.md | grep -E "7am|Python|blue"
```

**Pass criteria**:
- ✅ Assistant stores preferences
- ✅ Assistant recalls preferences accurately
- ✅ Memory persists across conversation sessions

---

### Scenario 3.3: Conversation Memory

**Goal**: Multi-turn conversation with context retention.

**Steps**:
1. Start conversation:
   ```
   User: "I'm planning a birthday party"
   AI: [responds]

   User: "It's for my daughter, she's turning 8"
   AI: [responds with context]

   User: "She loves unicorns"
   AI: [responds with accumulated context]
   ```

2. Wait 1 hour (or restart n8n)

3. Continue conversation:
   ```
   User: "What was I planning earlier?"
   Expected: AI remembers birthday party for 8-year-old daughter who loves unicorns
   ```

**Pass criteria**:
- ✅ AI maintains context during conversation
- ✅ AI recalls conversation after time gap
- ✅ Conversation log saved correctly

---

## 4. Performance Tests

### Test 4.1: Large Memory Files

**Setup**:
```bash
# Create 100KB memory file
yes "Test line with some content here" | head -n 1000 > test-workspace-mcp/memory/large-file.md
```

**Test**:
- Search for "content"
- Read large file with memory_get

**Pass criteria**:
- ✅ Search completes < 2 seconds
- ✅ Read completes < 1 second
- ✅ No memory errors

---

### Test 4.2: Many Memory Files

**Setup**:
```bash
# Create 50 memory files
for i in {1..50}; do
  echo "# File $i\nSome content here" > test-workspace-mcp/memory/file-$i.md
done
```

**Test**:
- Search across all files
- Verify indexing completes

**Pass criteria**:
- ✅ All files indexed
- ✅ Search returns results from multiple files
- ✅ Indexing completes < 5 seconds

---

## 5. Error Handling Tests

### Test 5.1: Invalid Paths

**Test Cases**:
```javascript
// Should fail safely
memory_store({ path: "../../../etc/passwd", content: "hack" })
memory_store({ path: "file.txt", content: "not markdown" })
memory_delete({ path: "MEMORY.md" })
```

**Pass criteria**:
- ✅ Path traversal blocked
- ✅ Non-.md files rejected
- ✅ MEMORY.md protection working
- ✅ Error messages are clear

---

### Test 5.2: Empty/Invalid Content

**Test Cases**:
```javascript
memory_search({ query: "" })
memory_store({ path: "test.md", content: "" })
memory_get({ path: "nonexistent.md" })
```

**Pass criteria**:
- ✅ Empty query returns error
- ✅ Empty content allowed (valid use case)
- ✅ Missing file returns clear error

---

## Summary Checklist

Before moving to Phase 2, ensure:

### MCP Server
- [ ] All 4 tools listed correctly
- [ ] memory_search returns relevant results
- [ ] memory_store creates/updates files
- [ ] memory_delete removes files safely
- [ ] MEMORY.md protected from deletion

### n8n Integration
- [ ] Basic workflow imports successfully
- [ ] Complete workflow saves conversations
- [ ] Advanced workflow performs all CRUD operations
- [ ] Credentials configured correctly
- [ ] No errors in execution logs

### Real-World Usage
- [ ] Knowledge base assistant works
- [ ] Personal assistant remembers preferences
- [ ] Conversation memory persists
- [ ] Multi-turn conversations maintain context
- [ ] Memory searches are accurate

### Performance & Stability
- [ ] Large files handled correctly
- [ ] Multiple files indexed successfully
- [ ] No memory leaks
- [ ] Error handling works properly

### Documentation
- [ ] README instructions work
- [ ] Testing guides are accurate
- [ ] Example workflows import correctly

---

## Next Steps

✅ **If all tests pass**: Ready for Phase 2 (Vector Search)

⚠️ **If tests fail**: Review errors and fix issues before proceeding

📝 **Document any issues**: Create GitHub issues for bugs found

---

## Troubleshooting Common Issues

### Issue: "Tool not found: memory_search"

**Solution**:
1. Verify MCP credential path is absolute
2. Check `run-server.sh` workspace directory
3. Restart n8n after credential changes
4. Review n8n logs: `~/.n8n/logs/`

### Issue: "No results found" in search

**Solution**:
1. Check files exist: `ls test-workspace-mcp/memory/`
2. Try `minScore: 0` to see all results
3. Verify file content is plain text Markdown
4. Check database: `rm memory.db` to force reindex

### Issue: n8n workflow import fails

**Solution**:
1. Ensure n8n version is 1.0+
2. Check n8n-nodes-mcp is installed
3. Manually create workflow if import fails
4. Verify JSON is valid

---

## Support

Questions or issues?
- **Docs**: [README.md](../README.md)
- **GitHub**: https://github.com/tostechbr/akashic-context/issues
- **Examples**: [examples/README.md](../examples/README.md)
