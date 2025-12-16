/**
 * Modern Skin - Clean, readable format with details/summary for collapsibles
 * 
 * Format:
 * ---
 * **🤖 Assistant** · `model` · *1.5k in* · *42 out*
 * <details><summary>💭 Thoughts</summary>
 * thinking content
 * </details>
 * <details><summary>🔧 tool_name</summary>
 * tool details
 * </details>
 * AI response content
 * ---
 * **🧑 You**
 * user content
 */

import { Skin, TokenInfo, ToolExecution } from './types';
import { BEACON } from '../types';

/**
 * Format token count in a human-readable way
 * e.g., 1500 -> "1.5k", 500 -> "500"
 */
function formatTokenCount(count: number): string {
  if (count >= 1000) {
    const k = count / 1000;
    // Show one decimal if it's not a round number
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(count);
}

/**
 * Escape content for use inside HTML details tag
 * We don't need > prefixes like with callouts
 */
function escapeDetailsContent(content: string): string {
  // Content inside <details> is free-form, just ensure we don't break the closing tag
  return content.replace(/<\/details>/gi, '&lt;/details&gt;');
}

// Patterns for detecting modern skin elements
const PATTERNS = {
  // Match: \n---\n\n**🤖 Assistant** · `model` · *Xk in* · *Y out*
  // or just: \n---\n\n**🤖 Assistant**
  aiHeader: /\n?---\n\n\*\*🤖 Assistant\*\*(?:\s*·\s*`([^`]+)`)?(?:\s*·\s*\*([^*]+) in\*)?(?:\s*·\s*\*([^*]+) out\*)?/g,
  
  // Match: \n\n---\n\n**🧑 You**
  userHeader: /\n\n---\n\n\*\*🧑 You\*\*/g,
  
  // Match: <details>\n<summary>💭 Thoughts</summary>\n...\n</details>
  thinking: /<details>\s*\n<summary>💭 Thoughts<\/summary>\s*\n([\s\S]*?)\n<\/details>/g,
  
  // Match: <details>\n<summary>🔧 tool_name</summary>\n...\n</details>
  tool: /<details>\s*\n<summary>🔧 ([^<]+)<\/summary>\s*\n([\s\S]*?)\n<\/details>/g,
  
  // Match: <details open>\n<summary>❌ Error</summary>\n...\n</details>
  error: /<details open>\s*\n<summary>❌ Error<\/summary>\s*\n([\s\S]*?)\n<\/details>/g,
  
  // Match: *⏳ Processing...*
  processing: /\*⏳ Processing\.\.\.\*/g,
};

// Patterns for canonical format
const CANONICAL_PATTERNS = {
  // Match token info: |==In=X,Out=Y|==
  tokens: /\|==In=(\d+),Out=(\d+)\|==/g,
  
  // Match thinking: |THOUGHT|\n...\n|/THOUGHT|
  thinking: /\|THOUGHT\|\n([\s\S]*?)\n\|\/THOUGHT\|/g,
  
  // Match AI beacon
  ai: /\|AI\|/g,
  
  // Match ME beacon  
  me: /\|ME\|/g,
  
  // Match error
  error: /\|ERROR\|/g,
  
  // Match processing
  processing: /\|⏳ Processing\.\.\.\|/g,
};

export const modernSkin: Skin = {
  name: 'modern',
  displayName: 'Modern (Clean Details)',
  
  formatAIHeader(model?: string, tokens?: TokenInfo): string {
    // Blank line before ---, then blank line after ---, then header
    let header = '\n---\n\n**🤖 Assistant**';
    
    if (model) {
      header += ` · \`${model}\``;
    }
    
    if (tokens) {
      header += ` · *${formatTokenCount(tokens.inputTokens)} in* · *${formatTokenCount(tokens.outputTokens)} out*`;
    }
    
    return header + '\n\n';
  },
  
  formatUserHeader(): string {
    // Blank line before ---, then blank line after ---, then header
    return '\n\n---\n\n**🧑 You**\n\n';
  },
  
  formatThinking(content: string): string {
    const escaped = escapeDetailsContent(content);
    return `<details>\n<summary>💭 Thoughts</summary>\n\n${escaped}\n\n</details>\n\n`;
  },
  
  formatTool(tool: ToolExecution): string {
    let content = '';
    
    if (tool.aiMessage) {
      content += `*${tool.aiMessage}*\n\n`;
    }
    
    content += '**Input:**\n';
    content += '```json\n';
    content += JSON.stringify(tool.args, null, 2);
    content += '\n```\n\n';
    
    content += '**Output:**\n';
    content += '```\n';
    const truncatedResult = tool.result.length > 500 
      ? tool.result.substring(0, 500) + '...' 
      : tool.result;
    content += truncatedResult;
    content += '\n```';
    
    return `<details>\n<summary>🔧 ${tool.name}</summary>\n\n${content}\n\n</details>\n\n`;
  },
  
  formatError(message: string, debug?: string[]): string {
    let content = '```\n' + message + '\n```';
    
    if (debug && debug.length > 0) {
      content += '\n\n**Debug Log:**\n' + debug.join('\n');
    }
    
    return `<details open>\n<summary>❌ Error</summary>\n\n${content}\n\n</details>\n\n`;
  },
  
  formatProcessing(): string {
    return '*⏳ Processing...*';
  },
  
  /**
   * Convert modern skin format to canonical format for parsing
   */
  toCanonical(content: string): string {
    let result = content;
    
    // Convert modern AI header WITH inline tokens to canonical
    // ---\n\n**🤖 Assistant** · *Xk in* · *Y out*\n\n -> |AI|\n|==In=X,Out=Y|==\n
    result = result.replace(
      /\n?---\n\n\*\*🤖 [^*]+\*\*(?:\s*·\s*`[^`]+`)?\s*·\s*\*([0-9.]+)k? in\*\s*·\s*\*([0-9.]+)k? out\*\n\n/g,
      (match, tokensIn, tokensOut) => {
        // Convert back from "1.5k" to number
        const inNum = tokensIn.includes('k') ? parseFloat(tokensIn) * 1000 : parseInt(tokensIn);
        const outNum = tokensOut.includes('k') ? parseFloat(tokensOut) * 1000 : parseInt(tokensOut);
        return `|AI|\n|==In=${Math.round(inNum)},Out=${Math.round(outNum)}|==\n`;
      }
    );
    
    // Handle broken format: header followed by token info on next line
    // ---\n\n**🤖 Assistant**\n\n|==In=X,Out=Y|== -> |AI|\n|==In=X,Out=Y|==
    result = result.replace(
      /\n?---\n\n\*\*🤖 [^*]+\*\*(?:\s*·\s*`[^`]+`)?\n\n\|==In=(\d+),Out=(\d+)\|==\n/g,
      (match, tokensIn, tokensOut) => {
        return `|AI|\n|==In=${tokensIn},Out=${tokensOut}|==\n`;
      }
    );
    
    // Convert modern AI header WITHOUT tokens to canonical
    result = result.replace(
      /\n?---\n\n\*\*🤖 [^*]+\*\*(?:\s*·\s*`[^`]+`)?\n\n/g,
      '|AI|\n'
    );
    
    // Convert modern user header to canonical
    // ---\n\n**🧑 You** -> |ME|
    // Handle various spacing patterns
    result = result.replace(/\n?\n?---\n\n\*\*🧑 [^*]+\*\*\n\n/g, '\n|ME|\n');
    
    // Convert modern thinking to canonical
    // <details>\n<summary>💭 Thoughts</summary>\n...\n</details> -> |THOUGHT|\n...\n|/THOUGHT|
    result = result.replace(
      /<details>\s*\n<summary>💭 Thoughts<\/summary>\s*\n\n?([\s\S]*?)\n?\n<\/details>\n?\n?/g,
      (match, content) => `|THOUGHT|\n${content.trim()}\n|/THOUGHT|\n`
    );
    
    // Convert modern error to canonical
    result = result.replace(
      /<details open>\s*\n<summary>❌ Error<\/summary>\s*\n\n?([\s\S]*?)\n?\n<\/details>\n?\n?/g,
      (match, content) => {
        // Extract the error message from the code block
        const errorMatch = content.match(/```\n([\s\S]*?)\n```/);
        const errorMsg = errorMatch ? errorMatch[1] : content;
        return `|ERROR|\n\`\`\`\n${errorMsg}\n\`\`\`\n`;
      }
    );
    
    // Convert modern processing to canonical
    result = result.replace(/\*⏳ Processing\.\.\.\*/g, '|⏳ Processing...|');
    
    // Note: Tool blocks are not converted back since they're not parsed for re-processing
    // They're just display artifacts from previous responses
    
    return result;
  },
  
  /**
   * Convert canonical format to modern skin format for display
   */
  fromCanonical(content: string): string {
    let result = content;
    
    // Convert thinking blocks first (they don't depend on token info)
    result = result.replace(
      /\|THOUGHT\|\n([\s\S]*?)\n\|\/THOUGHT\|\n?/g,
      (match, thinkContent) => `<details>\n<summary>💭 Thoughts</summary>\n\n${thinkContent.trim()}\n\n</details>\n\n`
    );
    
    // Convert AI beacon + token info together in a single pass
    // Canonical format is: |AI|\n|==In=X,Out=Y|== (AI beacon FIRST, then tokens)
    result = result.replace(
      /\|AI\|\n\|==In=(\d+),Out=(\d+)\|==\n?/g,
      (match, tokensIn, tokensOut) => {
        const inTokens = parseInt(tokensIn);
        const outTokens = parseInt(tokensOut);
        return `\n---\n\n**🤖 Assistant** · *${formatTokenCount(inTokens)} in* · *${formatTokenCount(outTokens)} out*\n\n`;
      }
    );
    
    // Convert standalone AI beacon (without token info) - for mock mode or old format
    result = result.replace(
      /\|AI\|\n?/g,
      '\n---\n\n**🤖 Assistant**\n\n'
    );
    
    // Convert ME beacon - blank line before ---, blank line after
    result = result.replace(/\n?\|ME\|\n?/g, '\n\n---\n\n**🧑 You**\n\n');
    
    // Convert error blocks
    result = result.replace(
      /\|ERROR\|\n([\s\S]*?)(?=\n\n---|\n\*\*🧑|$)/g,
      (match, errorContent) => `<details open>\n<summary>❌ Error</summary>\n\n${errorContent.trim()}\n\n</details>\n\n`
    );
    
    // Convert processing indicator
    result = result.replace(/\|⏳ Processing\.\.\.\|/g, '*⏳ Processing...*');
    
    return result;
  },
};

