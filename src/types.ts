/**
 * Core types for the Obsidian AI plugin
 */

// AI Provider types
export type AIProvider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'perplexity';

export interface ImageContent {
  type: 'image';
  mediaType: string;  // e.g., 'image/png', 'image/jpeg'
  base64Data: string;
}

export interface PDFContent {
  type: 'pdf';
  base64Data: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = TextContent | ImageContent | PDFContent;

// Providers that support native PDF handling
export const PDF_CAPABLE_PROVIDERS: AIProvider[] = ['anthropic', 'google'];

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
}

export interface AIResponse {
  content: string;
  thinking?: string;          // Full thinking content (Claude, Gemini thinking models)
  thinkingTokens?: number;    // Thinking/reasoning token count
  toolCalls?: ToolCall[];
  inputTokens?: number;
  outputTokens?: number;
  debugLog?: string[];        // Debug log entries
}

// Thinking configuration for AI requests
export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens?: number;  // Optional token budget for thinking
}

// Models that support extended thinking
export const THINKING_CAPABLE_MODELS: Record<string, 'full' | 'hidden' | 'none'> = {
  // Claude - full thinking visibility
  'claude-sonnet-4-20250514': 'full',
  'claude-sonnet-4-5-20250929': 'full',
  'claude-opus-4-20250514': 'full',
  'claude-opus-4-1-20250805': 'full',
  'claude-opus-4-5-20251101': 'full',
  
  // OpenAI o-series - hidden reasoning (only token count)
  'o1': 'hidden',
  'o1-2024-12-17': 'hidden',
  'o1-preview': 'hidden',
  'o1-mini': 'hidden',
  'o3': 'hidden',
  'o4-mini': 'hidden',
  
  // Gemini thinking - full visibility
  'gemini-flash-thinking-exp': 'full',
};

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: unknown;
  toolCallId: string;
  error?: string;
}

// Tag parser types
export interface ParsedTag {
  name: string;
  value: string | null;
  text: string | null;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

export interface ProcessingContext {
  doc: string;
  filePath: string;
  newDoc?: string;
}

// Model configuration - user can add custom models
export interface ModelConfig {
  alias: string;           // Short name used in <model!alias>
  provider: AIProvider;    // Which provider handles this model
  modelId: string;         // The actual model ID sent to the API
  displayName?: string;    // Human-readable name for settings UI
}

// Settings
export interface ObsidianAISettings {
  // API Keys
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  deepseekApiKey: string;
  perplexityApiKey: string;
  
  // Defaults
  defaultModel: string;  // Alias of the default model
  defaultTemperature: number;
  defaultMaxTokens: number;
  
  // Behavior
  autoProcess: boolean;
  showTokenCount: boolean;
  playNotificationSound: boolean;
  
  // Prompts folder
  promptsFolder: string;
  
  // Custom models (user-defined, merged with defaults)
  customModels: ModelConfig[];
}

// Default model configurations - these ship with the plugin
// Based on ai_engine model aliases
export const DEFAULT_MODELS: ModelConfig[] = [
  // ===== Anthropic =====
  { alias: 'haiku', provider: 'anthropic', modelId: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku' },
  { alias: 'haiku3.5', provider: 'anthropic', modelId: 'claude-3-5-haiku-latest', displayName: 'Claude 3.5 Haiku' },
  { alias: 'sonnet', provider: 'anthropic', modelId: 'claude-3-sonnet-20240229', displayName: 'Claude 3 Sonnet' },
  { alias: 'sonnet3.5', provider: 'anthropic', modelId: 'claude-3-5-sonnet-latest', displayName: 'Claude 3.5 Sonnet' },
  { alias: 'sonnet3.7', provider: 'anthropic', modelId: 'claude-3-7-sonnet-latest', displayName: 'Claude 3.7 Sonnet' },
  { alias: 'sonnet4', provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
  { alias: 'sonnet4.5', provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929', displayName: 'Claude Sonnet 4.5' },
  { alias: 'opus3', provider: 'anthropic', modelId: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus' },
  { alias: 'opus4', provider: 'anthropic', modelId: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
  { alias: 'opus4.1', provider: 'anthropic', modelId: 'claude-opus-4-1-20250805', displayName: 'Claude Opus 4.1' },
  { alias: 'opus4.5', provider: 'anthropic', modelId: 'claude-opus-4-5-20251101', displayName: 'Claude Opus 4.5' },
  
  // ===== OpenAI =====
  { alias: 'gpt3.5', provider: 'openai', modelId: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo' },
  { alias: 'gpt4', provider: 'openai', modelId: 'gpt-4-turbo-preview', displayName: 'GPT-4 Turbo' },
  { alias: 'gpt4o', provider: 'openai', modelId: 'gpt-4o', displayName: 'GPT-4o' },
  { alias: 'gpt4.1', provider: 'openai', modelId: 'gpt-4.1', displayName: 'GPT-4.1' },
  { alias: 'mini', provider: 'openai', modelId: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
  { alias: 'gpt5', provider: 'openai', modelId: 'gpt-5', displayName: 'GPT-5' },
  { alias: 'gpt5-mini', provider: 'openai', modelId: 'gpt-5-mini', displayName: 'GPT-5 Mini' },
  { alias: 'gpt5-nano', provider: 'openai', modelId: 'gpt-5-nano', displayName: 'GPT-5 Nano' },
  { alias: 'gpt5.1', provider: 'openai', modelId: 'gpt-5.1', displayName: 'GPT-5.1' },
  { alias: 'gpt5.2', provider: 'openai', modelId: 'gpt-5.2', displayName: 'GPT-5.2' },
  { alias: 'o1-preview', provider: 'openai', modelId: 'o1-preview', displayName: 'o1 Preview' },
  { alias: 'o1-mini', provider: 'openai', modelId: 'o1-mini', displayName: 'o1 Mini' },
  { alias: 'o1', provider: 'openai', modelId: 'o1-2024-12-17', displayName: 'o1' },
  { alias: 'o3', provider: 'openai', modelId: 'o3', displayName: 'o3' },
  { alias: 'o4-mini', provider: 'openai', modelId: 'o4-mini', displayName: 'o4 Mini' },
  
  // ===== Google =====
  { alias: 'gemini1.0', provider: 'google', modelId: 'gemini-1.0-pro-latest', displayName: 'Gemini 1.0 Pro' },
  { alias: 'gemini1.5', provider: 'google', modelId: 'gemini-1.5-pro-latest', displayName: 'Gemini 1.5 Pro' },
  { alias: 'gemini2.0flash', provider: 'google', modelId: 'gemini-flash', displayName: 'Gemini 2.0 Flash' },
  { alias: 'gemini2.0flashlite', provider: 'google', modelId: 'gemini-flash-lite', displayName: 'Gemini 2.0 Flash Lite' },
  { alias: 'gemini2.0flashthinking', provider: 'google', modelId: 'gemini-flash-thinking-exp', displayName: 'Gemini 2.0 Flash Thinking' },
  { alias: 'gemini2.0exp', provider: 'google', modelId: 'gemini-exp-1206', displayName: 'Gemini 2.0 Exp' },
  { alias: 'gemini2.5exp', provider: 'google', modelId: 'gemini-2.5-pro-exp-03-25', displayName: 'Gemini 2.5 Pro Exp' },
  { alias: 'gemini2.5pro', provider: 'google', modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  { alias: 'gemini2.5flash', provider: 'google', modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
  { alias: 'gemini2.5flashlite', provider: 'google', modelId: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite' },
  { alias: 'gemini3.0pro', provider: 'google', modelId: 'gemini-3-pro-preview', displayName: 'Gemini 3.0 Pro' },
  // Convenience aliases
  { alias: 'gemini', provider: 'google', modelId: 'gemini-2.5-flash', displayName: 'Gemini (2.5 Flash)' },
  { alias: 'gemini-flash', provider: 'google', modelId: 'gemini-2.5-flash', displayName: 'Gemini Flash' },
  { alias: 'gemini-pro', provider: 'google', modelId: 'gemini-2.5-pro', displayName: 'Gemini Pro' },
  
  // ===== DeepSeek =====
  { alias: 'deepseek', provider: 'deepseek', modelId: 'deepseek-chat', displayName: 'DeepSeek Chat' },
  { alias: 'deepseek-chat', provider: 'deepseek', modelId: 'deepseek-chat', displayName: 'DeepSeek Chat' },
  { alias: 'deepseek-reasoner', provider: 'deepseek', modelId: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
  
  // ===== Perplexity =====
  { alias: 'sonar', provider: 'perplexity', modelId: 'sonar', displayName: 'Perplexity Sonar' },
  { alias: 'sonar-pro', provider: 'perplexity', modelId: 'sonar-pro', displayName: 'Perplexity Sonar Pro' },
];

export const DEFAULT_SETTINGS: ObsidianAISettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  googleApiKey: '',
  deepseekApiKey: '',
  perplexityApiKey: '',
  
  defaultModel: 'sonnet4',  // Same default as ai_engine
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
  
  autoProcess: true,
  showTokenCount: true,
  playNotificationSound: true,
  
  promptsFolder: 'Prompts',
  
  customModels: [],
};

/**
 * Get all available models (defaults + custom, with custom overriding defaults)
 */
export function getAllModels(settings: ObsidianAISettings): ModelConfig[] {
  const modelMap = new Map<string, ModelConfig>();
  
  // Add defaults first
  for (const model of DEFAULT_MODELS) {
    modelMap.set(model.alias, model);
  }
  
  // Override with custom models
  for (const model of settings.customModels) {
    modelMap.set(model.alias, model);
  }
  
  return Array.from(modelMap.values());
}

/**
 * Resolve a model alias to its configuration
 */
export function resolveModel(alias: string, settings: ObsidianAISettings): ModelConfig | null {
  // Check custom models first (they override defaults)
  const custom = settings.customModels.find(m => m.alias === alias);
  if (custom) return custom;
  
  // Check defaults
  const defaultModel = DEFAULT_MODELS.find(m => m.alias === alias);
  if (defaultModel) return defaultModel;
  
  // Try treating it as a direct provider:model format
  if (alias.includes(':')) {
    const [provider, modelId] = alias.split(':', 2);
    if (['anthropic', 'openai', 'google', 'deepseek', 'perplexity'].includes(provider)) {
      return {
        alias: alias,
        provider: provider as AIProvider,
        modelId: modelId,
      };
    }
  }
  
  return null;
}

// Beacons (markers in the document)
export const BEACON = {
  AI: '|AI|',
  ME: '|ME|',
  ERROR: '|ERROR|',
  THOUGHT: '|THOUGHT|',
  END_THOUGHT: '|/THOUGHT|',
  TOOL_START: '|TOOL|',
  TOOL_END: '|/TOOL|',
  TOKENS_PREFIX: '|==',
};

