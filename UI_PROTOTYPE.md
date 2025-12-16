# AI Chat UI - Skin System

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────┐     ┌─────────────┐     ┌─────────────┐
│  Document   │ ──▶ │ Skin → Canon│ ──▶ │  Parse  │ ──▶ │Canon → Skin │ ──▶ │  Document   │
│  (any skin) │     │  Normalize  │     │ Process │     │   Output    │     │(active skin)│
└─────────────┘     └─────────────┘     └─────────┘     └─────────────┘     └─────────────┘
```

- **Canonical format**: Internal format used for parsing (current `|AI|`, `|ME|`, etc.)
- **Skins**: Visual formats that wrap/unwrap the canonical
- **Active skin**: User's preferred output format (configurable in settings)

---

## Canonical Format (Internal)

This is what the parser understands. Kept for backward compatibility:

```markdown
|==In=1500,Out=42|==
|THOUGHT|
Thinking content here...
|/THOUGHT|
|TOOL|search_web|{"query":"paris"}|Result text here|/TOOL|
|AI|
AI response content here...
|ME|
```

---

## Skin: Modern (v2)

The new clean format:

```markdown
---

**🤖 Assistant** · `sonnet` · *1.5k in* · *42 out*

<details>
<summary>💭 Thoughts</summary>

Thinking content here...

</details>

<details>
<summary>🔧 search_web</summary>

**Input:**
```json
{"query": "paris"}
```

**Output:**
```
Result text here
```

</details>

AI response content here...

---

**🧑 You**

```

---

## Mapping Table

| Element | Canonical | Modern Skin |
|---------|-----------|-------------|
| AI header | `\|AI\|` | `**🤖 Assistant**` + metadata line |
| User header | `\|ME\|` | `---\n\n**🧑 You**\n` |
| Tokens | `\|==In=X,Out=Y\|==` | `· *Xk in* · *Y out*` (on header line) |
| Thinking start | `\|THOUGHT\|` | `<details>\n<summary>💭 Thoughts</summary>\n` |
| Thinking end | `\|/THOUGHT\|` | `\n</details>` |
| Tool | `\|TOOL\|name\|args\|result\|/TOOL\|` | `<details>` block with name, input, output |
| Error | `\|ERROR\|` | `<details>\n<summary>❌ Error</summary>` |
| Processing | `\|⏳ Processing...\|` | `*⏳ Processing...*` |

---

## Live Example

### What the user sees (Modern Skin):

---

**🤖 Assistant** · `sonnet` · *1.2k in* · *87 out*

<details>
<summary>💭 Thoughts</summary>

Let me think about quantum entanglement. The user wants a simple explanation, so I should use an analogy - perhaps magic coins that are linked. I'll avoid technical jargon and focus on the "spooky action at a distance" that makes it fascinating.

</details>

Imagine you have two magic coins. When you flip them, they always land on opposite sides - if one shows heads, the other shows tails, *instantly*, no matter how far apart they are.

That's quantum entanglement! Two particles become "linked" so that measuring one immediately affects what you'll find when measuring the other.

Einstein called this "spooky action at a distance" because it seemed impossible.

---

**🧑 You**

Can we use it for faster-than-light communication?

---

**🤖 Assistant** · `sonnet` · *2.1k in* · *64 out*

Great question! Unfortunately, no.

While the correlation is instant, you can't *control* what result you get - it's random. You only discover the link when you compare results through normal (slower-than-light) communication.

---

**🧑 You**

### What's stored internally (Canonical):

```
|==In=1200,Out=87|==
|THOUGHT|
Let me think about quantum entanglement. The user wants a simple explanation...
|/THOUGHT|
|AI|
Imagine you have two magic coins. When you flip them, they always land on opposite sides...

That's quantum entanglement! Two particles become "linked"...

Einstein called this "spooky action at a distance" because it seemed impossible.
|ME|

Can we use it for faster-than-light communication?

|==In=2100,Out=64|==
|AI|
Great question! Unfortunately, no.

While the correlation is instant, you can't *control* what result you get...
|ME|
```

---

## Tool Example

### Modern Skin:

---

**🤖 Assistant** · `sonnet` · *500 in* · *120 out*

<details>
<summary>🔧 search_web</summary>

**Input:**
```json
{
  "query": "current weather in Paris"
}
```

**Output:**
```
Paris, France
Temperature: 18°C
Condition: Partly cloudy
Humidity: 65%
Wind: 12 km/h NW
```

</details>

Based on my search, Paris is currently enjoying mild weather at 18°C with partly cloudy skies. Perfect for a walk along the Seine!

---

**🧑 You**

### Canonical:

```
|==In=500,Out=120|==
|TOOL|search_web|{"query":"current weather in Paris"}|Paris, France\nTemperature: 18°C\nCondition: Partly cloudy...|/TOOL|
|AI|
Based on my search, Paris is currently enjoying mild weather at 18°C with partly cloudy skies. Perfect for a walk along the Seine!
|ME|
```

---

## Error Example

### Modern Skin:

---

<details open>
<summary>❌ Error</summary>

API rate limit exceeded. Please wait 60 seconds and try again.

</details>

---

### Canonical:

```
|ERROR|
API rate limit exceeded. Please wait 60 seconds and try again.
|/ERROR|
```

---

## Implementation Plan

### 1. Define Skin Interface

```typescript
interface Skin {
  name: string;
  
  // Convert canonical → skin (for output)
  formatAIHeader(model: string, tokensIn: number, tokensOut: number): string;
  formatUserHeader(): string;
  formatThinking(content: string): string;
  formatTool(name: string, input: string, output: string): string;
  formatError(message: string): string;
  formatProcessing(): string;
  
  // Convert skin → canonical (for parsing)
  // These are regex patterns to detect and extract
  patterns: {
    aiHeader: RegExp;
    userHeader: RegExp;
    thinking: RegExp;
    tool: RegExp;
    error: RegExp;
    processing: RegExp;
  };
}
```

### 2. Create Skin Definitions

```typescript
// skins/canonical.ts - The internal format
// skins/modern.ts - The new pretty format
// skins/minimal.ts - Future: ultra-minimal
// skins/classic.ts - Future: markdown-only, no emoji
```

### 3. Add Setting for Active Skin

```typescript
interface Settings {
  // ...existing settings
  activeSkin: 'canonical' | 'modern' | 'minimal' | 'classic';
}
```

### 4. Modify BlockProcessor

```typescript
// Before parsing:
content = skinManager.toCanonical(content);

// After processing:
output = skinManager.fromCanonical(output, settings.activeSkin);
```

---

## Questions to Decide

1. **Should we keep `<ai!>` / `</ai!>` tags or also skin those?**
   - Proposal: Keep them for now (they're functional, not visual)

2. **Token format**: `*1.5k in*` vs `*1500 in*` vs `*1.5k tokens in*`?
   - Proposal: `*1.5k in* · *42 out*` (compact)

3. **Model display**: `` `sonnet` `` vs `sonnet` vs `*sonnet*`?
   - Proposal: `` `sonnet` `` (code style, stands out)

4. **Separator**: `---` before AI and before User, or just before User?
   - Proposal: Both, for consistent visual rhythm

---

## Next Steps

1. Create `src/skins/` folder with skin system
2. Define canonical skin (current format)
3. Define modern skin (new format)
4. Add skin conversion to BlockProcessor
5. Add setting for active skin
6. Test backward compatibility
