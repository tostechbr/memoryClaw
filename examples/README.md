# n8n Workflow Examples

Complete workflow examples demonstrating MemoryClaw integration with n8n.

## Prerequisites

1. **Install n8n Community Node**
   ```bash
   # In n8n UI: Settings → Community Nodes → Install
   n8n-nodes-mcp
   ```

2. **Configure MCP Credential**
   - Go to Credentials → Create New → MCP API
   - Name: `MemoryClaw`
   - Command: `bash`
   - Arguments: `/absolute/path/to/memory-claw/packages/mcp-server/run-server.sh`
   - Environments: `OPENAI_API_KEY=sk-your-key`

3. **Configure OpenAI Credential**
   - Go to Credentials → Create New → OpenAI API
   - Add your OpenAI API key

## Workflows

### 1. Basic Chatbot (Search Only)
**File**: `n8n-chatbot-basic.json`

**Features**:
- Chat interface
- Memory search
- AI responses with context

**Use cases**:
- Knowledge base queries
- Documentation assistant
- FAQ bot

### 2. Complete Chatbot (Search + Store)
**File**: `n8n-chatbot-complete.json`

**Features**:
- Chat interface
- Memory search (automatic)
- Memory store (AI decides when to save)
- Daily conversation logs

**Use cases**:
- Personal assistant
- Customer support
- Meeting notes assistant

### 3. Advanced Chatbot (Full CRUD)
**File**: `n8n-chatbot-advanced.json`

**Features**:
- Memory search
- Memory store
- Memory delete
- Memory get (read specific files)

**Use cases**:
- Memory management interface
- Archive old conversations
- Update user preferences

## How to Import

1. Open n8n
2. Click **Workflows** → **Import from File**
3. Select one of the JSON files
4. Update credential IDs:
   - Replace `YOUR_OPENAI_CREDENTIAL_ID`
   - Replace `YOUR_MCP_CREDENTIAL_ID`
5. Save and activate the workflow

## Workflow Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Chat Trigger                          │
│              (User sends message)                       │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                   AI Agent                              │
│                                                         │
│  Tools available:                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ MCP Search   │  │  MCP Store   │  │  MCP Delete  │  │
│  │ (automatic)  │  │  (on demand) │  │  (on demand) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  LLM: OpenAI GPT-4o-mini                                │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                Response to User                         │
└─────────────────────────────────────────────────────────┘
```

## Memory Organization

The workflows save conversations in this structure:

```
workspace/
├── MEMORY.md                      # Curated long-term memory
└── memory/
    ├── 2026-02-06-conversation.md # Daily conversations
    ├── 2026-02-06-meeting.md      # Meeting notes
    ├── user-preferences.md        # User settings
    └── project-notes.md           # Project information
```

## Testing Your Workflow

### Test Memory Search
Ask: "What projects am I working on?"
Expected: AI searches MEMORY.md and returns project info

### Test Memory Store
Say: "Remember that I prefer Python over JavaScript"
Expected: AI saves this preference to a memory file

### Test Memory Lifecycle
1. Ask a question → AI searches memory
2. Have a conversation → AI stores important info
3. Ask to "delete old notes" → AI removes outdated files

## Customization

### Change System Prompt
Edit the `systemMessage` in the AI Agent node to customize behavior:

```javascript
{
  "systemMessage": "You are a [role] with access to persistent memory..."
}
```

### Change Memory Storage Pattern
Edit the `toolParameters` in MCP Memory Store node:

```javascript
{
  "path": "memory/{{ $now.format('YYYY-MM-DD') }}-custom.md",
  "content": "# Custom Format\n\n{{ $json.chatInput }}"
}
```

### Add Memory Cleanup
Create a scheduled workflow that runs daily:
1. Trigger: Schedule (daily at midnight)
2. MCP Memory Delete: Remove files older than 30 days

## Troubleshooting

### "Tool not found: memory_search"
- Verify MCP credential path is absolute
- Check `run-server.sh` has correct workspace path
- Restart n8n after credential changes

### "No results found"
- Ensure MEMORY.md or memory/*.md files exist
- Set `minScore: 0` to see all results
- Check workspace directory is correct

### "Memory not persisting"
- Verify AI Agent has memory_store tool connected
- Check file permissions on workspace directory
- Review n8n execution logs for errors

## Next Steps

1. **Try basic workflow first** to validate MCP connection
2. **Add your own memory files** in the workspace
3. **Customize system prompts** for your use case
4. **Monitor memory usage** as conversations grow

## Support

- **Documentation**: [README.md](../README.md)
- **Testing Guide**: [TESTING.md](../docs/TESTING.md)
- **Issues**: https://github.com/tostechbr/memory-claw/issues
