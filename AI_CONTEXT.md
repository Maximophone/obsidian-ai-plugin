# AI Context Document for Obsidian AI Plugin

This document provides comprehensive context for any AI assistant continuing development on this project.

## Project Overview

This is an **Obsidian plugin** that enables AI-powered conversations directly within Obsidian notes. Users write special "beacon" tags in their markdown notes, and when they add a `<reply!>` tag, the plugin automatically calls an AI model and inserts the response.

### Original Python Repository

This plugin is a **port from a Python project** located at:
```
/Users/maximefournes/code/obsidian_ai
```

The original Python version used:
- `watchdog` for file watching
- `PyQt5` for GUI (tool confirmation dialogs)
- A separate `ai_engine` library at `/Users/maximefournes/code/ai_engine` for model management
- Various integrations (Gmail, Discord, GDrive)

**Key insight**: The original had a sophisticated tag-based system that we've ported. When analyzing behavior, refer to the Python source for the "intended" behavior.

---

## Architecture

### Core Flow

1. **File Watcher** (`main.ts`): Listens for file modifications via Obsidian's vault events
2. **Block Processor** (`src/processor/blockProcessor.ts`): Parses AI blocks, processes tags, calls AI
3. **AI Service** (`src/ai/aiService.ts`): Unified interface for multiple AI providers
4. **Tool Manager** (`src/tools/toolManager.ts`): Manages tool registration and execution

### Tag System

Users write markdown with special tags:

```markdown
<ai!>
<model!sonnet4>
<system!"You are helpful">
What is the capital of France?
<reply!>
</ai!>
```

When the file is saved, the plugin:
1. Detects the `<reply!>` tag
2. Shows a processing placeholder
3. Calls the AI
4. Replaces the placeholder with the response

### Key Tags Implemented

| Tag | Purpose | Example |
|-----|---------|---------|
| `<ai!>...</ai!>` | AI conversation block | `<ai!>content</ai!>` |
| `<reply!>` | Triggers AI response | `<reply!>` |
| `<model!name>` | Select model | `<model!gpt4o>` |
| `<system!"prompt">` | System prompt | `<system!"Be concise">` |
| `<doc!"[[Note]]">` | Include note content | `<doc!"[[My Note]]">` |
| `<file!"/path">` | Include file content | `<file!"/tmp/data.txt">` |
| `<image!"/path">` | Include image (vision) | `<image!"/path/to/img.png">` |
| `<pdf!"/path">` | Include PDF (Claude/Gemini) | `<pdf!"/path/to/doc.pdf">` |
| `<url!"https://...">` | Fetch webpage content | `<url!"https://example.com">` |
| `<prompt!"name">` | Load prompt from prompts folder | `<prompt!"coding">` |
| `<this!>` | Include current document | `<this!>` |
| `<think!>` or `<think!10000>` | Extended thinking mode | `<think!50000>` |
| `<debug!>` | Show detailed API logs | `<debug!>` |
| `<mock!>` | Echo request without API call | `<mock!>` |
| `<tools!obsidian>` | Enable tool use | `<tools!obsidian>` |
| `<help!>` | Show help text | `<help!>` |
| `<branch!>` or `<branch!"name">` | Create conversation branch | `<branch!"alternative">` |
| `<ignore!>...</ignore!>` | Exclude content from AI context | `<ignore!>hidden text</ignore!>` |

---

## AI Providers Supported

### Anthropic (Claude)
- Models: claude-sonnet-4-5, claude-sonnet-4, claude-opus-4, etc.
- Aliases: sonnet45, sonnet4, opus4, haiku
- Supports: Vision, PDFs, Extended Thinking, Tool Use

### OpenAI (GPT)
- Models: gpt-4o, gpt-4-turbo, gpt-5.1, gpt-5.2, o1, o3, etc.
- Aliases: gpt4o, gpt4turbo, gpt5, o1, o3
- Supports: Vision, Tool Use
- **Note**: GPT-5.x and o-series use `max_completion_tokens` instead of `max_tokens`

### Google (Gemini)
- Models: gemini-2.5-pro, gemini-2.5-flash, gemini-3-pro-preview
- Aliases: gemini, gemini2.5pro, gemini3pro
- Supports: Vision, PDFs, Thinking, Tool Use
- **Critical**: Gemini 3 models require `thought_signature` handling (see below)

### DeepSeek
- Models: deepseek-chat, deepseek-reasoner
- Aliases: deepseek, deepseekr1

### Perplexity
- Models: sonar, sonar-pro, sonar-deep-research
- Aliases: perplexity, sonardeep

---

## Tool Use Implementation

### Current State

**Built-in Obsidian Toolset** (`src/tools/obsidianTools.ts`):

**Read-only tools (safe=true)**:
- `list_vault` - List files/folders
- `get_note_outline` - Get heading structure
- `read_note` - Read note with line numbers
- `read_note_section` - Read specific section by heading
- `search_vault` - Search files by content/name
- `get_note_links` - Get outgoing wikilinks
- `get_backlinks` - Get incoming links
- `search_in_note` - Search within a note

**Write tools (safe=false)**:
- `create_note` - Create a new note (requires confirmation)

### Confirmation UI

Write tools (`safe=false`) show a confirmation modal before execution:
- File: `src/ui/ToolConfirmationModal.ts`
- Shows tool name, description, arguments
- User can approve or reject
- Rejection feedback is sent back to the AI

### Tool Format by Provider

Each provider has different tool call/result formats:

**Anthropic**:
```json
// Tool call in assistant message content
{"type": "tool_use", "id": "...", "name": "...", "input": {...}}
// Tool result in user message content
{"type": "tool_result", "tool_use_id": "...", "content": "..."}
```

**OpenAI**:
```json
// Tool call as separate field on assistant message
"tool_calls": [{"id": "...", "type": "function", "function": {"name": "...", "arguments": "..."}}]
// Tool result as separate message with role "tool"
{"role": "tool", "tool_call_id": "...", "content": "..."}
```

**Gemini**:
```json
// Tool call in parts
{"functionCall": {"name": "...", "args": {...}}}
// Tool result in parts
{"functionResponse": {"name": "...", "response": {"output": "..."}}}
```

### Gemini 3 thought_signature Issue

**Critical**: Gemini 3 models return a `thought_signature` with function calls that MUST be preserved and returned. Without it, you get a 400 error.

The fix involves:
1. Capturing `thought_signature` from Gemini's response (may be inside or outside `functionCall`)
2. Storing it in `AIToolCall.thoughtSignature`
3. Including it in both the `functionCall` part AND the `functionResponse` part when sending back

See commit `09d1301` for the user's fix implementation.

---

## Future Plans: MCP and External Tools

### The Vision

We want to support two types of tools:

1. **Built-in Obsidian Tools** (current) - Run inside the plugin using Obsidian API
2. **External MCP Tools** - Run via a separate Python server

### MCP (Model Context Protocol)

MCP is an open protocol for connecting AI to external tools/data. The plan:

1. **Python MCP Server** (`obsidian_ai_server/`)
   - Runs separately from Obsidian
   - Exposes tools via HTTP API
   - Handles complex operations (Gmail, Discord, shell commands, etc.)
   - Uses API keys for authentication

2. **Plugin connects to MCP Server**
   - Plugin discovers available tools from server
   - Plugin sends tool calls to server
   - Server executes and returns results

3. **Tool Categories**
   - `system` - File operations, shell commands, Python execution
   - `gmail` - Read/send emails
   - `discord` - Discord bot integration
   - `gdrive` - Google Drive operations

### Why MCP?

- Keep plugin lightweight (complex deps in Python)
- Reuse existing Python implementations from `obsidian_ai`
- Security: External server can run in sandbox
- Flexibility: Add tools without plugin updates

---

## Key Files Reference

```
obsidian-ai-plugin/
├── src/
│   ├── main.ts                    # Plugin entry point, settings, commands
│   ├── types.ts                   # Core types, interfaces, model definitions
│   ├── parser/
│   │   └── tagParser.ts           # Tag parsing regex logic
│   ├── processor/
│   │   └── blockProcessor.ts      # AI block processing, conversation handling
│   ├── ai/
│   │   └── aiService.ts           # Multi-provider AI API calls
│   ├── tools/
│   │   ├── types.ts               # Tool interfaces, format converters
│   │   ├── toolManager.ts         # Tool registration, execution
│   │   ├── obsidianTools.ts       # Built-in Obsidian toolset
│   │   └── index.ts               # Exports
│   └── ui/
│       └── ToolConfirmationModal.ts  # Confirmation dialog for write tools
├── styles.css                     # Plugin styles
├── manifest.json                  # Plugin metadata
├── package.json                   # Dependencies
└── esbuild.config.mjs             # Build config
```

---

## Common Issues Encountered

### 1. Infinite Error Loop
**Problem**: Error in AI block causes error to be written, which triggers processing, which errors again...
**Solution**: Remove `<reply!>` tag BEFORE the try/catch block

### 2. Help Text Tags Getting Processed
**Problem**: `<AI!>` examples in help text were being parsed
**Solution**: Modified regex to only match lowercase tags: `[a-z][a-z0-9_]*`

### 3. OpenAI max_tokens Error
**Problem**: GPT-5.x and o-series models reject `max_tokens`
**Solution**: Use `max_completion_tokens` for these models

### 4. Anthropic tool_result name Field
**Problem**: Adding `name` field to tool_result broke Anthropic
**Solution**: Anthropic only accepts `type`, `tool_use_id`, `content` - no `name`

### 5. Gemini Empty required Array
**Problem**: `"required": []` causes Gemini to error
**Solution**: Omit `required` field entirely if no required params

### 6. Gemini thought_signature
**Problem**: Gemini 3 models require thought_signature preservation
**Solution**: Capture from response, include in both functionCall and functionResponse parts

---

## Development Workflow

### Quick Iteration Setup

1. **Symlink for instant updates**:
   ```bash
   ln -s /Users/maximefournes/code/obsidian-ai-plugin /path/to/vault/.obsidian/plugins/obsidian-ai-plugin
   ```

2. **Hot Reload Plugin**: Install "Hot Reload" community plugin in Obsidian

3. **Build in watch mode**:
   ```bash
   npm run dev
   ```

4. Changes to TypeScript → Auto-rebuild → Auto-reload in Obsidian

### Building
```bash
npm run dev    # Watch mode for development
npm run build  # Production build
```

---

## Obsidian Commands Registered

The plugin adds these commands to the Command Palette (`Cmd+P`):

- **Insert AI block** - Creates `<ai!>\n\n</ai!>`
- **Insert reply tag** - Inserts `<reply!>`
- **Insert model tag** - Opens model selector
- **Insert document reference tag** - Opens note picker, inserts `<doc!"[[Note]]">`
- **Insert file tag** - Opens file picker, inserts `<file!"/path">`
- **Insert image tag** - Opens image picker, inserts `<image!"/path">`
- **Insert PDF tag** - Opens PDF picker, inserts `<pdf!"/path">`
- **Insert prompt tag** - Opens prompt selector from prompts folder
- **Insert tools tag** - Opens toolset selector
- **Insert this document tag** - Inserts `<this!>`
- **Insert think tag** - Inserts `<think!>`
- **Insert debug tag** - Inserts `<debug!>`
- **Insert mock tag** - Inserts `<mock!>`
- **Insert help tag** - Inserts `<help!>`
- **Insert URL tag** - Prompts for URL, inserts `<url!"...">`
- **Insert system prompt tag** - Prompts for prompt, inserts `<system!"...">`

---

## Settings

Plugin settings in Obsidian settings panel:

- **API Keys**: Anthropic, OpenAI, Google, DeepSeek, Perplexity
- **Default Model**: Which model alias to use by default
- **Default Temperature**: 0.0 - 1.0
- **Default Max Tokens**: Response length limit
- **Prompts Folder**: Where to look for prompt files
- **Custom Models**: User-defined model aliases

---

## GitHub Repository

```
https://github.com/Maximophone/obsidian-ai-plugin
```

---

## Conversation Branching

The branching feature allows users to fork a conversation at any point into a new note.

### How It Works

1. User places `<branch!>` or `<branch!"custom name">` tag inside an AI block
2. When the file is saved, the plugin:
   - Creates a new note with the conversation content **up to** the branch tag
   - The new note is named `{Original Note} (branch {name}).md`
   - Replaces the `<branch!>` tag with `<ignore!>🌿 Branch: [[New Note]]</ignore!>`
   - **Adds/updates a branch index** at the top of the AI block listing all branches
3. The `<ignore!>` wrapper ensures the branch link doesn't pollute the AI context

### Branch Index

When branches are created, a branch index is automatically added at the top of the AI block:

```markdown
<ai!>
<ignore!>🌿 **Branches:**
- [[My Chat (branch option A)]]
- [[My Chat (branch option B)]]
</ignore!>

...rest of conversation...
</ai!>
```

This provides quick navigation to all branches without scrolling through the entire conversation.

### Example

**Before (in "My Chat.md"):**
```markdown
<ai!>
What's 2+2?
|AI|
The answer is 4.
|ME|
<branch!"math followup">
What about 3+3?
<reply!>
</ai!>
```

**After:**
```markdown
<ai!>
<ignore!>🌿 **Branches:**
- [[My Chat (branch math followup)]]
</ignore!>

What's 2+2?
|AI|
The answer is 4.
|ME|
<ignore!>🌿 Branch: [[My Chat (branch math followup)]]</ignore!>
What about 3+3?
<reply!>
</ai!>
```

And a new file "My Chat (branch math followup).md" is created with:
- A callout linking back to the original: `> [!info] Branched from [[My Chat]]`
- The conversation content up to the branch point

### Key Files

- `src/processor/blockProcessor.ts`: `processBranchTags()`, `processBranchInBlock()`, `createBranchNote()`, `updateBranchIndex()`
- `src/main.ts`: `processBranches()`, integration into `checkAndProcessFile()`

### The `<ignore!>` Tag

Content wrapped in `<ignore!>...</ignore!>` is:
- **Visible** in the note (user can see it and click links)
- **Stripped** from AI context (AI never sees it)

This is used for branch links and the branch index, but can also be used manually for any metadata you want to hide from the AI.

---

## What's Next

1. **More Write Tools**: edit_note, delete_note, append_to_note, etc.
2. **MCP Server Integration**: Connect to external Python server for complex tools
3. **Tool Confirmation Improvements**: Better UI, batch confirmations
4. **Streaming Responses**: Show AI output as it's generated
5. **Error Recovery**: Better handling of API failures mid-conversation
6. **Testing**: Unit tests for tag parser, tool execution

---

## Contact

This plugin was developed through pair programming with an AI assistant. The human developer is the repository owner.

---

*Last updated: December 2024*








