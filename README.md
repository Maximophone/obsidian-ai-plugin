# Obsidian AI Plugin

Add AI capabilities directly into your Obsidian notes using simple tags. Write questions or instructions, save the file, and get AI responses inline.

## Features

- **Multiple AI Providers** - Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek, and Perplexity
- **50+ Built-in Models** - From GPT-3.5 to Claude Opus 4.5, Gemini 3.0, and more
- **Simple Tag Syntax** - Use `<ai!>` blocks with `<reply!>` to get AI responses
- **Context Inclusion** - Reference other notes (`<doc!>`), files (`<file!>`), and the current document (`<this!>`)
- **Custom Models** - Add your own model aliases in settings
- **Auto-process on Save** - Responses appear automatically when you save
- **Token Counting** - See input/output token usage for each response

## Installation

### Manual Installation (Development)

```bash
# Clone the repository
git clone https://github.com/Maximophone/obsidian-ai-plugin.git
cd obsidian-ai-plugin

# Install dependencies
npm install

# Build
npm run build

# Copy to your vault
cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/obsidian-ai/
```

### Development with Hot Reload

For faster development iteration:

1. Create a symlink from your vault to the dev folder:
```bash
ln -s /path/to/obsidian-ai-plugin /path/to/vault/.obsidian/plugins/obsidian-ai
```

2. Install the [Hot Reload](https://github.com/pjeby/hot-reload) plugin in Obsidian

3. Run the dev build:
```bash
npm run dev
```

Now changes auto-rebuild and the plugin auto-reloads!

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
<model!opus4>
Write a detailed analysis.
<reply!>
</ai!>
```

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

**Any file (absolute or relative path):**
```markdown
<ai!>
<file!/Users/me/code/project/config.json>
Explain this configuration.
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
| `<model!alias>` | Choose AI model | `<model!sonnet4>` |
| `<temperature!n>` | Response randomness (0-1) | `<temperature!0.7>` |
| `<max_tokens!n>` | Max response length | `<max_tokens!4000>` |
| `<system!name>` | Use system prompt | `<system!analyst>` |
| `<this!>` | Include current document | `<this!>` |
| `<doc!path>` | Include another note | `<doc![[Note]]>` |
| `<file!path>` | Include any file | `<file!data.json>` |

### Getting Help

Type `<help!>` in any note and save to see the full tag reference.

## Available Models

### Anthropic
`haiku`, `haiku3.5`, `sonnet`, `sonnet3.5`, `sonnet3.7`, `sonnet4`, `sonnet4.5`, `opus3`, `opus4`, `opus4.1`, `opus4.5`

### OpenAI
`gpt3.5`, `gpt4`, `gpt4o`, `gpt4.1`, `mini`, `gpt5`, `gpt5-mini`, `gpt5-nano`, `gpt5.1`, `gpt5.2`, `o1-preview`, `o1-mini`, `o1`, `o3`, `o4-mini`

### Google
`gemini`, `gemini-flash`, `gemini-pro`, `gemini1.0`, `gemini1.5`, `gemini2.0flash`, `gemini2.0flashlite`, `gemini2.0flashthinking`, `gemini2.5pro`, `gemini2.5flash`, `gemini3.0pro`

### DeepSeek
`deepseek`, `deepseek-chat`, `deepseek-reasoner`

### Perplexity
`sonar`, `sonar-pro`

### Direct Model Format

You can also specify models directly: `<model!anthropic:claude-3-opus-20240229>`

## Configuration

Open **Settings → Obsidian AI** to configure:

### API Keys
- Anthropic API Key (console.anthropic.com)
- OpenAI API Key (platform.openai.com)
- Google AI API Key (aistudio.google.com)
- DeepSeek API Key (platform.deepseek.com)
- Perplexity API Key (perplexity.ai)

### Defaults
- **Default Model** - Model alias to use when not specified (default: `sonnet4`)
- **Temperature** - Response randomness 0-1 (default: 0.7)
- **Max Tokens** - Maximum response length (default: 4096)

### Behavior
- **Auto-process on save** - Automatically process AI blocks when saving
- **Show token count** - Display input/output tokens in responses
- **Play notification sound** - Audio feedback when processing completes

### Custom Models
Add your own model aliases that override or extend the built-in list.

## Keyboard Shortcuts

| Command | Description |
|---------|-------------|
| Process AI blocks | Process all AI blocks in current file |
| Process AI block at cursor | Process just the block at cursor position |

You can assign keyboard shortcuts in **Settings → Hotkeys**.

## Credits

This plugin is a TypeScript port of [obsidian_ai](https://github.com/Maximophone/obsidian_ai), originally written in Python.

## License

MIT License - see [LICENSE](LICENSE) for details.
