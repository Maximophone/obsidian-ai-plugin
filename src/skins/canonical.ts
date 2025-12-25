/**
 * Canonical Skin - The internal format used for parsing
 * 
 * This is the "raw" format with |AI|, |ME|, etc. beacons.
 * It's kept for backward compatibility and as the intermediate format.
 */

import { Skin, TokenInfo, ToolExecution } from './types';
import { BEACON } from '../types';

export const canonicalSkin: Skin = {
  name: 'canonical',
  displayName: 'Classic (Raw Beacons)',
  
  formatAIHeader(model?: string, tokens?: TokenInfo): string {
    let result = '';
    if (tokens) {
      result += `${BEACON.TOKENS_PREFIX}In=${tokens.inputTokens},Out=${tokens.outputTokens}|==\n`;
    }
    result += BEACON.AI;
    return result;
  },
  
  formatUserHeader(): string {
    return BEACON.ME;
  },
  
  formatThinking(content: string): string {
    return `${BEACON.THOUGHT}\n${content}\n${BEACON.END_THOUGHT}`;
  },
  
  formatTool(tool: ToolExecution): string {
    // Current format for tools (used in toolsBlock building)
    let block = '';
    if (tool.aiMessage) {
      block += `*${tool.aiMessage}*\n\n`;
    }
    block += `🔧 **${tool.name}**\n`;
    block += `\`\`\`json\n${JSON.stringify(tool.args, null, 2)}\n\`\`\`\n`;
    const truncatedResult = tool.result.length > 500 
      ? tool.result.substring(0, 500) + '...' 
      : tool.result;
    block += `\`\`\`\n${truncatedResult}\n\`\`\``;
    return block;
  },
  
  formatError(message: string, debug?: string[]): string {
    let result = `${BEACON.ERROR}\n\`\`\`\n${message}\n\`\`\``;
    if (debug && debug.length > 0) {
      result += `\n---\n### Debug Log\n${debug.join('\n')}\n---\n`;
    }
    return result;
  },
  
  formatProcessing(): string {
    return BEACON.PROCESSING;
  },
  
  // Identity transforms - canonical is the base format
  toCanonical(content: string): string {
    return content;
  },
  
  fromCanonical(content: string): string {
    return content;
  },
};





