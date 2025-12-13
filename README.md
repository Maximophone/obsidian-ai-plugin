# Obsidian AI Plugin

Add AI capabilities directly into your Obsidian notes using simple tags. Write questions or instructions, save the file, and get AI responses inline.

## Features

- **Multiple AI Providers**: Supports Claude (Anthropic), GPT (OpenAI), and Gemini (Google)
- **Simple Tag Syntax**: Use `<ai!>` blocks with `<reply!>` to get AI responses
- **Context Inclusion**: Reference other notes, URLs, and the current document
- **Customizable**: Choose models, set temperature, use system prompts
- **Native Integration**: Works seamlessly within Obsidian

## Installation

### From Obsidian Community Plugins (Coming Soon)

1. Open Obsidian Settings → Community Plugins
2. Search for "Obsidian AI"
3. Click Install, then Enable

### Manual Installation

1. Download the latest release from GitHub
2. Extract to your vault's `.obsidian/plugins/obsidian-ai/` folder
3. Enable in Obsidian Settings → Community Plugins

### Development

```bash
# Clone the repository
git clone https://github.com/Maximophone/obsidian-ai-plugin.git
cd obsidian-ai-plugin

# Install dependencies
npm install

# Build for development (with watch mode)
npm run dev

# Build for production
npm run build
```

## Usage

### Basic AI Query

```markdown
<ai!>
What are the main themes in this note?
<reply!>
</ai!>
```

After saving, the AI's response appears where `<reply!>` was:

```markdown
<ai!>
What are the main themes in this note?
|AI|
The main themes are...
|ME|
</ai!>
```

### Choosing a Model

```markdown
<ai!>
<model!opus>
Write a detailed analysis.
<reply!>
</ai!>
```

**Available model aliases:**
- `haiku` - Claude 3.5 Haiku (fast, cheap)
- `sonnet` - Claude Sonnet 4 (balanced)
- `opus` - Claude Opus 4 (most capable)
- `gpt4` - GPT-4o
- `gpt4mini` - GPT-4o Mini
- `gemini` - Gemini 2.0 Flash

### Including Context

**Current document:**
```markdown
<ai!>
<this!>
Summarize the key points above.
<reply!>
</ai!>
```

**Another note:**
```markdown
<ai!>
<doc![[Meeting Notes 2024-01-15]]>
What action items came from this meeting?
<reply!>
</ai!>
```

### Using System Prompts

Create prompt files in your vault's `Prompts/` folder, then reference them:

```markdown
<ai!>
<system!code_reviewer>
Review this function for bugs.
<reply!>
</ai!>
```

### Parameters

| Tag | Description | Example |
|-----|-------------|---------|
| `<model!name>` | Choose AI model | `<model!opus>` |
| `<temperature!n>` | Response randomness (0-1) | `<temperature!0.7>` |
| `<max_tokens!n>` | Max response length | `<max_tokens!4000>` |
| `<system!name>` | Use system prompt from Prompts/ | `<system!analyst>` |
| `<this!>` | Include current document | `<this!>` |
| `<doc!path>` | Include another note | `<doc![[Note]]>` |

## Configuration

Open Settings → Obsidian AI to configure:

- **API Keys**: Enter your API keys for each provider
- **Default Model**: Choose which model to use by default
- **Auto-process**: Enable/disable automatic processing on save
- **Token Display**: Show/hide token counts in responses
- **Prompts Folder**: Location of system prompt files

## Keyboard Shortcuts

| Command | Description |
|---------|-------------|
| Process AI blocks | Process all AI blocks in current file |
| Process AI block at cursor | Process just the block at cursor position |

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

This plugin is a TypeScript port of [obsidian_ai](https://github.com/Maximophone/obsidian_ai), originally written in Python.

