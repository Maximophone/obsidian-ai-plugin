/**
 * Skin System Types
 * 
 * Skins define the visual format of AI conversations in the document.
 * The "canonical" skin is the internal format used for parsing.
 * Other skins are visual representations that get converted to/from canonical.
 */

/**
 * Token information for display
 */
export interface TokenInfo {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Tool execution information
 */
export interface ToolExecution {
  name: string;
  args: Record<string, unknown>;
  result: string;
  aiMessage?: string;  // AI's message before tool call
}

/**
 * Parsed AI response block (extracted from canonical format)
 */
export interface ParsedAIBlock {
  tokens?: TokenInfo;
  thinking?: string;
  tools?: ToolExecution[];
  content: string;
  debug?: string[];
  isError?: boolean;
}

/**
 * Skin definition interface
 * 
 * Each skin must provide:
 * - Formatters: Convert structured data to skin's string format
 * - Patterns: Regex patterns to detect and extract skin elements
 */
export interface Skin {
  name: string;
  displayName: string;
  
  /**
   * Format the AI response header line
   */
  formatAIHeader(model?: string, tokens?: TokenInfo): string;
  
  /**
   * Format the user message header/separator
   */
  formatUserHeader(): string;
  
  /**
   * Format thinking content (collapsible)
   */
  formatThinking(content: string): string;
  
  /**
   * Format a tool execution (collapsible)
   */
  formatTool(tool: ToolExecution): string;
  
  /**
   * Format an error message
   */
  formatError(message: string, debug?: string[]): string;
  
  /**
   * Format the processing indicator
   */
  formatProcessing(): string;
  
  /**
   * Convert this skin's format to canonical format
   * @param content Document content in this skin's format
   * @returns Content in canonical format
   */
  toCanonical(content: string): string;
  
  /**
   * Convert canonical format to this skin's format
   * @param content Document content in canonical format
   * @returns Content in this skin's format
   */
  fromCanonical(content: string): string;
}

/**
 * Available skin names
 */
export type SkinName = 'canonical' | 'modern';




