# Inline AI

Add AI capabilities directly into your Obsidian notes. Write questions, reference documents, include images—and get AI responses inline.

## ✨ Features

- **Native [[Links]]** — Just use `[[Note Name]]` to include document content—no special syntax needed
- **5 AI Providers** — Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek, Perplexity
- **50+ Built-in Models** — From GPT-4o to Claude Opus 4.5, Gemini 3.0, and more
- **Vision Support** — Include images for visual AI models
- **PDF Support** — Native PDF handling with Claude and Gemini
- **Tool Use** — AI can read and create notes in your vault
- **Extended Thinking** — Enable reasoning modes for complex tasks
- **Token & Cost Tracking** — See token usage and estimated costs per response
- **Quick Commands** — Insert all tags via the Command Palette

---

## 🚀 Quick Start

### 1. Install the Plugin

**Option A: Community Plugins (Coming Soon)**

Once approved, search for "Inline AI" in Settings → Community Plugins → Browse.

**Option B: BRAT (Beta Testing)**

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open Settings → BRAT → "Add Beta Plugin"
3. Enter: `Maximophone/obsidian-ai-plugin`
4. Enable the plugin in Community Plugins

**Option C: Manual Download**

1. Go to the [latest release](https://github.com/Maximophone/obsidian-ai-plugin/releases/latest)
2. Download `main.js`, `manifest.json`, and `styles.css`
3. Create folder: `YourVault/.obsidian/plugins/inline-ai/`
4. Move the 3 files into that folder
5. Restart Obsidian and enable the plugin in Settings → Community Plugins

**Option D: Build from Source**

```bash
git clone https://github.com/Maximophone/obsidian-ai-plugin.git
cd obsidian-ai-plugin
npm install && npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/inline-ai/` folder.

### 2. Add Your API Key

Open **Settings → Obsidian AI** and add at least one API key.

### 3. Start Using It

The easiest way to use the plugin is through **Commands**:

1. Press `Cmd+P` (or `Ctrl+P`) to open the Command Palette
2. Type "Obsidian AI" to see all available commands
3. Select a command to insert the appropriate tag

Or type `/` in your note to access commands directly!

---

## 📝 Using Commands (Recommended)

Commands are the fastest way to insert AI tags. Open the Command Palette (`Cmd+P`) and search for:

| Command | What It Does |
|---------|--------------|
| **Insert AI block** | Creates an AI conversation block |
| **Insert reply tag** | Triggers AI response |
| **Insert model tag** | Opens model selector |
| **Insert document reference** | Pick a note to include |
| **Insert file tag** | Pick any file to include |
| **Insert image tag** | Pick an image for vision |
| **Insert PDF tag** | Pick a PDF document |
| **Insert prompt tag** | Select from your prompts folder |
| **Insert tools tag** | Enable AI tool use |
| **Insert think tag** | Enable extended thinking |
| **Insert debug tag** | Show detailed API logs |
| **Insert mock tag** | Test without API calls |
| **Insert URL tag** | Fetch webpage content |
| **Insert system prompt** | Set system instructions |
| **Insert inline tag** | Include all linked notes |

---

## 💬 Basic Usage

### Simple Question

```markdown
<ai!>
What are the main principles of good note-taking?
<reply!>
</ai!>
```

Save the file → AI response appears where `<reply!>` was:

```markdown
<ai!>
What are the main principles of good note-taking?
|AI|
The main principles include:
1. Be concise but complete...
|/AI|
</ai!>
```

### Choose a Model

```markdown
<ai!>
<model!gpt4o>
Explain quantum computing simply.
<reply!>
</ai!>
```

### Include Context

**Link to notes directly** (recommended):
```markdown
<ai!>
Compare the ideas in [[Project A]] and [[Project B]].
<reply!>
</ai!>
```

Just use standard Obsidian `[[links]]`—the content is automatically included! This is the easiest way to give context to the AI.

**Current document:**
```markdown
<ai!>
<this!>
Summarize the above content.
<reply!>
</ai!>
```

**Any file (outside vault):**
```markdown
<ai!>
<file!"/path/to/config.json">
Explain this configuration.
<reply!>
</ai!>
```

---

## 🖼️ Vision & Documents

### Images

Use vision-capable models (GPT-4o, Claude, Gemini) to analyze images:

```markdown
<ai!>
<model!gpt4o>
<image!"/path/to/screenshot.png">
What's shown in this screenshot?
<reply!>
</ai!>
```

### PDFs

Claude and Gemini can read PDFs natively:

```markdown
<ai!>
<model!sonnet4>
<pdf!"/path/to/paper.pdf">
Summarize the key findings.
<reply!>
</ai!>
```

### URLs

Fetch and include webpage content:

```markdown
<ai!>
<url!"https://example.com/article">
What are the main points?
<reply!>
</ai!>
```

---

## 🛠️ Tool Use

Enable AI to interact with your vault:

```markdown
<ai!>
<tools!obsidian>
Search my vault for notes about "project planning" and summarize what you find.
<reply!>
</ai!>
```

### Available Tools

**Read-only** (automatic):
- `list_vault` — Browse folders
- `read_note` — Read note content
- `search_vault` — Find notes by content
- `get_backlinks` — Find linked notes
- And more...

**Write tools** (require confirmation):
- `create_note` — Create new notes

When the AI tries to create or modify content, you'll see a confirmation dialog.

---

## 🧠 Extended Thinking

Enable reasoning mode for complex problems:

```markdown
<ai!>
<model!sonnet4>
<think!>
Solve this logic puzzle step by step...
<reply!>
</ai!>
```

Specify a token budget for thinking:

```markdown
<ai!>
<think!50000>
...
</ai!>
```

---

## 🔧 Debugging

### Debug Mode

See exactly what's sent to the API:

```markdown
<ai!>
<debug!>
Why isn't this working?
<reply!>
</ai!>
```

### Mock Mode

Test your setup without making API calls:

```markdown
<ai!>
<mock!>
This will echo the request parameters.
<reply!>
</ai!>
```

---

## 📋 All Tags Reference

| Tag | Purpose | Example |
|-----|---------|---------|
| `<ai!>...</ai!>` | AI conversation block | `<ai!>content</ai!>` |
| `<reply!>` | Trigger AI response | `<reply!>` |
| `<model!name>` | Select model | `<model!gpt4o>` |
| `<system!"prompt">` | System instructions | `<system!"Be concise">` |
| `<this!>` | Include current document | `<this!>` |
| `[[Note]]` | Include vault note (auto) | `[[My Note]]` |
| `<doc!"[[Note]]">` | Include vault note (explicit) | `<doc!"[[My Note]]">` |
| `<file!"/path">` | Include any file | `<file!"/tmp/data.txt">` |
| `<image!"/path">` | Include image | `<image!"/img.png">` |
| `<pdf!"/path">` | Include PDF | `<pdf!"/doc.pdf">` |
| `<url!"url">` | Fetch webpage | `<url!"https://...">` |
| `<prompt!"name">` | Load saved prompt | `<prompt!"coding">` |
| `<tools!name>` | Enable tool use | `<tools!obsidian>` |
| `<think!>` | Extended thinking | `<think!50000>` |
| `<debug!>` | Show API details | `<debug!>` |
| `<mock!>` | Test without API | `<mock!>` |
| `<inline!>` | Include all [[links]] (on by default) | `<inline!>` |
| `<help!>` | Show help | `<help!>` |
| `<temperature!n>` | Set temperature | `<temperature!0.5>` |
| `<max_tokens!n>` | Set max tokens | `<max_tokens!8000>` |

---

## 🤖 Available Models

### Anthropic (Claude)
`haiku`, `sonnet4`, `sonnet45`, `opus4`, `opus45`

### OpenAI
`gpt4o`, `gpt4turbo`, `gpt5`, `gpt5.1`, `gpt5.2`, `o1`, `o3`, `o4-mini`

### Google (Gemini)
`gemini`, `gemini2.5pro`, `gemini2.5flash`, `gemini3pro`

### DeepSeek
`deepseek`, `deepseek-reasoner`

### Perplexity
`sonar`, `sonar-pro`, `sonar-deep`

### Direct Format
Specify any model: `<model!anthropic:claude-3-opus-20240229>`

---

## ⚙️ Configuration

Open **Settings → Obsidian AI** to configure:

- **API Keys** — Add keys for each provider you want to use
- **Default Model** — Model to use when not specified
- **Temperature** — Response randomness (0-1)
- **Max Tokens** — Maximum response length
- **Prompts Folder** — Where to find your prompt files
- **Inline Linked Notes** — Automatically include `[[linked]]` note content (enabled by default)
- **Show Token Count** — Display token usage in AI responses

---

## 💰 Token & Cost Tracking

Each AI response shows token usage and an estimated cost:

```
**🤖 Assistant** · `sonnet4` · *12.5k in* · *834 out* · *$0.06*
```

This displays:
- **Model** — The model alias used for this response
- **Tokens in** — Input tokens (your messages + context)
- **Tokens out** — Output tokens (AI response)
- **Cost** — Estimated cost in USD

### Important Notes

⚠️ **Rough Estimation** — The cost shown is an approximation based on published API pricing. Actual costs may vary slightly.

⚠️ **Cumulative Cost** — The cost displayed represents the cumulative cost of the entire conversation up to that point, assuming you used the same model throughout. If you switch models mid-conversation, the cost estimate will not be accurate since it calculates based on the current model's pricing for all tokens.

⚠️ **Not All Models** — Cost estimates are only available for models with known pricing. If a model doesn't have pricing data, no cost will be shown.

To enable token counting, go to **Settings → Obsidian AI → Show Token Count**.

---

## 🔨 Development

### Hot Reload Setup

```bash
# Symlink to your vault
ln -s /path/to/obsidian-ai-plugin /path/to/vault/.obsidian/plugins/obsidian-ai

# Install Hot Reload plugin in Obsidian

# Run dev build
npm run dev
```

Changes auto-rebuild and auto-reload!

---

## 📜 Credits

This plugin is a TypeScript port of [obsidian_ai](https://github.com/Maximophone/obsidian_ai), originally written in Python.

## License

MIT License
