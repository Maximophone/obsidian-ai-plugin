/**
 * Modern Skin - Clean, readable format
 * 
 * Converts between canonical format (|AI|, |ME|, etc.) and modern format.
 * Uses lenient regex patterns that handle variable whitespace.
 */

import { Skin, TokenInfo, ToolExecution } from './types';

/**
 * Format token count in a human-readable way
 */
function formatTokenCount(count: number): string {
  if (count >= 1000) {
    const k = count / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(count);
}

/**
 * Format cost for display
 */
function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export const modernSkin: Skin = {
  name: 'modern',
  displayName: 'Modern (Clean)',
  
  formatAIHeader(model?: string, tokens?: TokenInfo): string {
    let header = '\n\n---\n\n**🤖 Assistant**';
    if (model) {
      header += ` · \`${model}\``;
    }
    if (tokens) {
      header += ` · *${formatTokenCount(tokens.inputTokens)} in* · *${formatTokenCount(tokens.outputTokens)} out*`;
    }
    return header + '\n\n';
  },
  
  formatUserHeader(): string {
    return '\n\n---\n\n**🧑 You**\n\n';
  },
  
  formatThinking(content: string): string {
    return `<details>\n<summary>💭 Thoughts</summary>\n\n${content}\n\n</details>\n\n`;
  },
  
  formatTool(tool: ToolExecution): string {
    let content = '';
    if (tool.aiMessage) {
      content += `*${tool.aiMessage}*\n\n`;
    }
    content += '**Input:**\n```json\n' + JSON.stringify(tool.args, null, 2) + '\n```\n\n';
    content += '**Output:**\n```\n' + tool.result.substring(0, 500) + (tool.result.length > 500 ? '...' : '') + '\n```';
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
   * Convert modern skin to canonical format for parsing.
   * Uses lenient patterns - any amount of whitespace around markers.
   */
  toCanonical(content: string): string {
    let result = content;
    
    // Modern AI header -> |AI| + optional token info
    // Match: ---  **🤖 [anything]** with optional model, tokens, and cost
    // Very lenient: \s* matches any whitespace including newlines
    result = result.replace(
      /\s*---\s*\*\*🤖[^*]*\*\*(?:\s*·\s*`([^`]*)`)?(?:\s*·\s*\*(\d+(?:\.\d+)?k?)\s*in\*\s*·\s*\*(\d+(?:\.\d+)?k?)\s*out\*)?(?:\s*·\s*\*\$([0-9.]+)\*)?\s*/g,
      (match, model, tokensIn, tokensOut, cost) => {
        let canonical = '|AI|\n';
        if (tokensIn && tokensOut) {
          const inNum = tokensIn.includes('k') ? parseFloat(tokensIn) * 1000 : parseInt(tokensIn);
          const outNum = tokensOut.includes('k') ? parseFloat(tokensOut) * 1000 : parseInt(tokensOut);
          const costStr = cost ? `,Cost=${cost}` : '';
          if (model) {
            canonical += `|==${model}|In=${Math.round(inNum)},Out=${Math.round(outNum)}${costStr}|==\n`;
          } else {
            canonical += `|==In=${Math.round(inNum)},Out=${Math.round(outNum)}${costStr}|==\n`;
          }
        }
        return canonical;
      }
    );
    
    // Modern user header -> |ME|
    // Match: --- **🧑 [anything]**
    result = result.replace(
      /\s*---\s*\*\*🧑[^*]*\*\*\s*/g,
      '|ME|\n'
    );
    
    // Thinking blocks
    result = result.replace(
      /<details>\s*<summary>💭[^<]*<\/summary>\s*([\s\S]*?)\s*<\/details>\s*/gi,
      (match, content) => `|THOUGHT|\n${content.trim()}\n|/THOUGHT|\n`
    );
    
    // Error blocks
    result = result.replace(
      /<details[^>]*>\s*<summary>❌[^<]*<\/summary>\s*([\s\S]*?)\s*<\/details>\s*/gi,
      (match, content) => {
        const errorMatch = content.match(/```\s*([\s\S]*?)\s*```/);
        return `|ERROR|\n\`\`\`\n${errorMatch ? errorMatch[1].trim() : content.trim()}\n\`\`\`\n`;
      }
    );
    
    // Processing indicator
    result = result.replace(/\*⏳\s*Processing\.{3}\*/gi, '|⏳ Processing...|');
    
    return result;
  },
  
  /**
   * Convert canonical format to modern skin for display.
   */
  fromCanonical(content: string): string {
    let result = content;
    
    // Thinking blocks first
    result = result.replace(
      /\|THOUGHT\|\s*([\s\S]*?)\s*\|\/THOUGHT\|\s*/g,
      (match, content) => `<details>\n<summary>💭 Thoughts</summary>\n\n${content.trim()}\n\n</details>\n\n`
    );
    
    // |AI| with model, tokens, and optional cost: |==model|In=X,Out=Y,Cost=Z|== or |==model|In=X,Out=Y|==
    result = result.replace(
      /\|AI\|\s*\|==([^|]+)\|In=(\d+),Out=(\d+)(?:,Cost=([0-9.]+))?\|==\s*/g,
      (match, model, tokensIn, tokensOut, cost) => {
        let header = `\n\n---\n\n**🤖 Assistant** · \`${model}\` · *${formatTokenCount(parseInt(tokensIn))} in* · *${formatTokenCount(parseInt(tokensOut))} out*`;
        if (cost) {
          header += ` · *${formatCost(parseFloat(cost))}*`;
        }
        return header + '\n\n';
      }
    );
    
    // |AI| with old format token info (no model): |==In=X,Out=Y|== or |==In=X,Out=Y,Cost=Z|==
    result = result.replace(
      /\|AI\|\s*\|==In=(\d+),Out=(\d+)(?:,Cost=([0-9.]+))?\|==\s*/g,
      (match, tokensIn, tokensOut, cost) => {
        let header = `\n\n---\n\n**🤖 Assistant** · *${formatTokenCount(parseInt(tokensIn))} in* · *${formatTokenCount(parseInt(tokensOut))} out*`;
        if (cost) {
          header += ` · *${formatCost(parseFloat(cost))}*`;
        }
        return header + '\n\n';
      }
    );
    
    // Standalone |AI| (no tokens)
    result = result.replace(/\|AI\|\s*/g, '\n\n---\n\n**🤖 Assistant**\n\n');
    
    // |ME| beacon
    result = result.replace(/\s*\|ME\|\s*/g, '\n\n---\n\n**🧑 You**\n\n');
    
    // Error blocks
    result = result.replace(
      /\|ERROR\|\s*([\s\S]*?)(?=\n\n---|\|ME\||$)/g,
      (match, content) => `<details open>\n<summary>❌ Error</summary>\n\n${content.trim()}\n\n</details>\n\n`
    );
    
    // Processing indicator
    result = result.replace(/\|⏳ Processing\.\.\.\|/g, '*⏳ Processing...*');
    
    // Clean up excessive whitespace (more than 2 consecutive newlines)
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
  },
};
