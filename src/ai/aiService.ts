/**
 * AI Service - Unified interface for multiple AI providers
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIMessage, AIResponse, AIProvider, resolveModel, ModelConfig, MessageContent, ThinkingConfig, THINKING_CAPABLE_MODELS, AIToolCall } from '../types';
import { ToolDefinition, toolsToAnthropicFormat, toolsToOpenAIFormat, toolsToGoogleFormat } from '../tools';
import type ObsidianAIPlugin from '../main';

export class AIService {
  private plugin: ObsidianAIPlugin;
  
  constructor(plugin: ObsidianAIPlugin) {
    this.plugin = plugin;
  }
  
  /**
   * Send messages to an AI model and get a response
   */
  async chat(
    messages: AIMessage[],
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingConfig;
      debug?: boolean;
      tools?: ToolDefinition[];
    } = {}
  ): Promise<AIResponse> {
    const modelAlias = options.model || this.plugin.settings.defaultModel;
    const modelConfig = resolveModel(modelAlias, this.plugin.settings);
    
    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelAlias}. Add it in settings or use format "provider:model-id".`);
    }
    
    const { provider, modelId } = modelConfig;
    
    switch (provider) {
      case 'anthropic':
        return this.chatAnthropic(messages, modelId, options);
      case 'openai':
        return this.chatOpenAI(messages, modelId, options);
      case 'google':
        return this.chatGoogle(messages, modelId, options);
      case 'deepseek':
        return this.chatDeepSeek(messages, modelId, options);
      case 'perplexity':
        return this.chatPerplexity(messages, modelId, options);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
  
  /**
   * Convert AIMessage content to Anthropic format
   */
  private convertToAnthropicContent(content: string | MessageContent[] | unknown[]): unknown {
    if (typeof content === 'string') {
      return content;
    }
    
    // If it's already an array, map each part
    return (content as any[]).map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      } else if (part.type === 'image') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.mediaType,
            data: part.base64Data,
          },
        };
      } else if (part.type === 'pdf') {
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: part.base64Data,
          },
        };
      } else if (part.type === 'tool_use' || part.type === 'tool_result') {
        // Pass through tool-related blocks unchanged
        return part;
      }
      // Pass through any other format unchanged
      return part;
    });
  }
  
  /**
   * Anthropic Claude API
   */
  private async chatAnthropic(
    messages: AIMessage[],
    model: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingConfig;
      debug?: boolean;
      tools?: ToolDefinition[];
    }
  ): Promise<AIResponse> {
    const debugLog: string[] = [];
    const log = (msg: string) => {
      if (options.debug) debugLog.push(msg);
    };
    
    log(`**Provider:** Anthropic`);
    log(`**Model:** ${model}`);
    
    const apiKey = this.plugin.settings.anthropicApiKey;
    if (!apiKey) {
      log(`**Error:** API key not configured`);
      const error = new Error('Anthropic API key not configured. Please add it in settings.');
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: this.convertToAnthropicContent(m.content),
      }));
    
    // Extract system prompt from messages if not provided
    let systemPrompt = options.systemPrompt;
    if (!systemPrompt) {
      const systemMsg = messages.find(m => m.role === 'system');
      if (systemMsg && typeof systemMsg.content === 'string') {
        systemPrompt = systemMsg.content;
      }
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
    };
    
    // Handle extended thinking
    if (options.thinking?.enabled) {
      // Check if model supports thinking
      const thinkingCapability = THINKING_CAPABLE_MODELS[model];
      log(`**Thinking requested:** yes (budget: ${options.thinking.budgetTokens || 10000})`);
      log(`**Model thinking capability:** ${thinkingCapability || 'unknown'}`);
      
      if (thinkingCapability === 'full') {
        body.thinking = {
          type: 'enabled',
          budget_tokens: options.thinking.budgetTokens || 10000,
        };
        // When thinking is enabled, temperature must be 1 for Claude
        body.temperature = 1;
      } else {
        log(`**Warning:** Model may not support extended thinking`);
      }
    } else {
      body.temperature = options.temperature ?? this.plugin.settings.defaultTemperature;
    }
    
    if (systemPrompt) {
      body.system = systemPrompt;
      log(`**System prompt:** (${systemPrompt.length} chars)`);
    }
    
    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      body.tools = toolsToAnthropicFormat(options.tools);
      log(`**Tools:** ${options.tools.map(t => t.name).join(', ')}`);
    }
    
    log(`**Temperature:** ${body.temperature}`);
    log(`**Max tokens:** ${body.max_tokens}`);
    log(`**Messages count:** ${anthropicMessages.length}`);
    
    // Use newer API version when thinking is enabled
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': '[REDACTED]',
      'anthropic-version': '2023-06-01',
    };
    
    // Extended thinking requires the interleaved-thinking beta header
    if (options.thinking?.enabled && body.thinking) {
      headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
      log(`**Beta header:** interleaved-thinking-2025-05-14`);
    }
    
    log(`\n**Request body:**\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``);
    
    const requestParams: RequestUrlParam = {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        ...headers,
        'x-api-key': apiKey, // Use actual key for request
      },
      body: JSON.stringify(body),
    };
    
    let response;
    try {
      response = await requestUrl(requestParams);
    } catch (e) {
      log(`\n**Request failed:** ${e.message || String(e)}`);
      const error = new Error(`Anthropic API error: ${e.message || String(e)}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    log(`\n**Response status:** ${response.status}`);
    
    if (response.status !== 200) {
      log(`**Response body:**\n\`\`\`\n${response.text}\n\`\`\``);
      const error = new Error(`Anthropic API error: ${response.status} - ${response.text}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    const data = response.json;
    log(`**Response received successfully**`);
    log(`**Input tokens:** ${data.usage?.input_tokens}`);
    log(`**Output tokens:** ${data.usage?.output_tokens}`);
    
    // Extract text, thinking, and tool calls from response
    let content = '';
    let thinking = '';
    const toolCalls: AIToolCall[] = [];
    
    for (const block of data.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'thinking') {
        thinking += block.thinking;
        log(`**Thinking block received:** ${block.thinking.length} chars`);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
        log(`**Tool call:** ${block.name}(${JSON.stringify(block.input)})`);
      }
    }
    
    // Determine stop reason
    let stopReason: AIResponse['stopReason'] = 'end_turn';
    if (data.stop_reason === 'tool_use') {
      stopReason = 'tool_use';
    } else if (data.stop_reason === 'max_tokens') {
      stopReason = 'max_tokens';
    } else if (data.stop_reason === 'stop_sequence') {
      stopReason = 'stop_sequence';
    }
    
    return {
      content,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      debugLog: options.debug ? debugLog : undefined,
    };
  }
  
  /**
   * Convert AIMessage content to OpenAI format
   */
  private convertToOpenAIContent(content: string | MessageContent[]): unknown {
    if (typeof content === 'string') {
      return content;
    }
    
    // Multi-part content with images
    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      } else if (part.type === 'image') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${part.mediaType};base64,${part.base64Data}`,
          },
        };
      }
      return part;
    });
  }
  
  /**
   * OpenAI API
   */
  private async chatOpenAI(
    messages: AIMessage[],
    model: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingConfig;
      debug?: boolean;
    }
  ): Promise<AIResponse> {
    const debugLog: string[] = [];
    const log = (msg: string) => {
      if (options.debug) debugLog.push(msg);
    };
    
    log(`**Provider:** OpenAI`);
    log(`**Model:** ${model}`);
    
    const apiKey = this.plugin.settings.openaiApiKey;
    if (!apiKey) {
      log(`**Error:** API key not configured`);
      const error = new Error('OpenAI API key not configured. Please add it in settings.');
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    // Check if this is an o-series reasoning model or GPT-5.x (which use max_completion_tokens)
    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4');
    const isGpt5 = model.startsWith('gpt-5');
    const usesCompletionTokens = isReasoningModel || isGpt5;
    log(`**Is reasoning model:** ${isReasoningModel}`);
    log(`**Is GPT-5.x:** ${isGpt5}`);
    
    // Convert messages to OpenAI format
    const openaiMessages = messages.map(m => ({
      role: m.role,
      content: this.convertToOpenAIContent(m.content),
    }));
    
    // Add system prompt if provided (use 'developer' role for o-series)
    if (options.systemPrompt) {
      openaiMessages.unshift({
        role: isReasoningModel ? 'developer' : 'system',
        content: options.systemPrompt,
      });
      log(`**System prompt:** (${options.systemPrompt.length} chars)`);
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
    };
    
    if (usesCompletionTokens) {
      // o-series and GPT-5.x models use max_completion_tokens instead of max_tokens
      body.max_completion_tokens = options.maxTokens || this.plugin.settings.defaultMaxTokens;
      
      // Add reasoning effort if thinking is enabled (o-series only)
      if (isReasoningModel && options.thinking?.enabled) {
        body.reasoning_effort = 'high';
        log(`**Reasoning effort:** high`);
      }
      
      // GPT-5.x supports temperature, o-series doesn't
      if (!isReasoningModel) {
        body.temperature = options.temperature ?? this.plugin.settings.defaultTemperature;
      }
    } else {
      body.max_tokens = options.maxTokens || this.plugin.settings.defaultMaxTokens;
      body.temperature = options.temperature ?? this.plugin.settings.defaultTemperature;
    }
    
    log(`**Max tokens param:** ${usesCompletionTokens ? 'max_completion_tokens' : 'max_tokens'}`);
    log(`**Max tokens value:** ${body.max_tokens || body.max_completion_tokens}`);
    log(`**Temperature:** ${body.temperature ?? 'N/A (reasoning model)'}`);
    log(`**Messages count:** ${openaiMessages.length}`);
    log(`\n**Request body:**\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``);
    
    const requestParams: RequestUrlParam = {
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer [REDACTED]`,
      },
      body: JSON.stringify(body),
    };
    
    let response;
    try {
      response = await requestUrl({
        ...requestParams,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        throw: false, // Don't throw on non-2xx, let us handle it
      });
    } catch (e: any) {
      // Try to extract response body from error
      const responseText = e.response?.text || e.body || e.message || String(e);
      log(`\n**Request failed:** ${e.message || String(e)}`);
      log(`**Error details:**\n\`\`\`\n${responseText}\n\`\`\``);
      const error = new Error(`OpenAI API error: ${responseText}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    log(`\n**Response status:** ${response.status}`);
    log(`**Response body:**\n\`\`\`\n${response.text}\n\`\`\``);
    
    if (response.status !== 200) {
      const error = new Error(`OpenAI API error: ${response.status} - ${response.text}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    const data = response.json;
    log(`**Response received successfully**`);
    log(`**Input tokens:** ${data.usage?.prompt_tokens}`);
    log(`**Output tokens:** ${data.usage?.completion_tokens}`);
    
    // For o-series, include reasoning token count in thinking info
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) {
      log(`**Reasoning tokens:** ${reasoningTokens}`);
    }
    
    return {
      content: data.choices[0]?.message?.content || '',
      thinkingTokens: reasoningTokens,
      thinking: reasoningTokens ? `[Reasoning used ${reasoningTokens} tokens]` : undefined,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      debugLog: options.debug ? debugLog : undefined,
    };
  }
  
  /**
   * Convert AIMessage content to Google Gemini format (parts array)
   */
  private convertToGoogleParts(content: string | MessageContent[]): unknown[] {
    if (typeof content === 'string') {
      return [{ text: content }];
    }
    
    // Multi-part content with images and PDFs
    return content.map(part => {
      if (part.type === 'text') {
        return { text: part.text };
      } else if (part.type === 'image') {
        return {
          inline_data: {
            mime_type: part.mediaType,
            data: part.base64Data,
          },
        };
      } else if (part.type === 'pdf') {
        return {
          inline_data: {
            mime_type: 'application/pdf',
            data: part.base64Data,
          },
        };
      }
      return part;
    });
  }
  
  /**
   * Google Gemini API
   */
  private async chatGoogle(
    messages: AIMessage[],
    model: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingConfig;
      debug?: boolean;
    }
  ): Promise<AIResponse> {
    const debugLog: string[] = [];
    const log = (msg: string) => {
      if (options.debug) debugLog.push(msg);
    };
    
    log(`**Provider:** Google`);
    log(`**Model:** ${model}`);
    
    const apiKey = this.plugin.settings.googleApiKey;
    if (!apiKey) {
      log(`**Error:** API key not configured`);
      const error = new Error('Google AI API key not configured. Please add it in settings.');
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    // Check if this is a thinking model
    const isThinkingModel = model.includes('thinking');
    
    // If thinking is requested but not using thinking model, suggest switching
    let actualModel = model;
    if (options.thinking?.enabled && !isThinkingModel) {
      // Try to use thinking variant if available
      if (model.includes('gemini-flash') || model === 'gemini-flash') {
        actualModel = 'gemini-2.0-flash-thinking-exp';
        log(`**Switched to thinking model:** ${actualModel}`);
      }
    }
    
    log(`**Actual model:** ${actualModel}`);
    log(`**Is thinking model:** ${isThinkingModel || actualModel.includes('thinking')}`);
    
    // Convert messages to Gemini format
    const contents = [];
    
    // Add system instruction if provided
    let systemInstruction: { parts: { text: string }[] } | undefined;
    if (options.systemPrompt) {
      systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
      log(`**System prompt:** (${options.systemPrompt.length} chars)`);
    }
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Handle system messages as system instruction
        if (!systemInstruction && typeof msg.content === 'string') {
          systemInstruction = {
            parts: [{ text: msg.content }],
          };
        }
        continue;
      }
      
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: this.convertToGoogleParts(msg.content),
      });
    }
    
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    // Add thinking budget if using thinking model
    if (actualModel.includes('thinking') && options.thinking?.budgetTokens) {
      generationConfig.thinkingConfig = {
        thinkingBudget: options.thinking.budgetTokens,
      };
      log(`**Thinking budget:** ${options.thinking.budgetTokens}`);
    }
    
    log(`**Max tokens:** ${generationConfig.maxOutputTokens}`);
    log(`**Temperature:** ${generationConfig.temperature}`);
    log(`**Messages count:** ${contents.length}`);
    
    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };
    
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }
    
    log(`\n**Request body:**\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``);
    
    const requestParams: RequestUrlParam = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=[REDACTED]`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };
    
    log(`**Request URL:** https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`);
    
    let response;
    try {
      response = await requestUrl({
        ...requestParams,
        url: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${apiKey}`,
      });
    } catch (e) {
      log(`\n**Request failed:** ${e.message || String(e)}`);
      const error = new Error(`Google AI API error: ${e.message || String(e)}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    log(`\n**Response status:** ${response.status}`);
    
    if (response.status !== 200) {
      log(`**Response body:**\n\`\`\`\n${response.text}\n\`\`\``);
      const error = new Error(`Google AI API error: ${response.status} - ${response.text}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    const data = response.json;
    log(`**Response received successfully**`);
    
    // Extract text and thinking from response
    let content = '';
    let thinking = '';
    
    if (data.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.thought) {
          // Gemini thinking models return thought in a separate field
          thinking += part.text || '';
        } else if (part.text) {
          content += part.text;
        }
      }
    }
    
    // For thinking models, check thinkingMetadata
    const thinkingTokens = data.usageMetadata?.thoughtsTokenCount;
    
    log(`**Input tokens:** ${data.usageMetadata?.promptTokenCount}`);
    log(`**Output tokens:** ${data.usageMetadata?.candidatesTokenCount}`);
    if (thinkingTokens) {
      log(`**Thinking tokens:** ${thinkingTokens}`);
    }
    
    return {
      content,
      thinking: thinking || (thinkingTokens ? `[Thinking used ${thinkingTokens} tokens]` : undefined),
      thinkingTokens,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      debugLog: options.debug ? debugLog : undefined,
    };
  }
  
  /**
   * DeepSeek API (OpenAI-compatible)
   */
  private async chatDeepSeek(
    messages: AIMessage[],
    model: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      debug?: boolean;
    }
  ): Promise<AIResponse> {
    const debugLog: string[] = [];
    const log = (msg: string) => {
      if (options.debug) debugLog.push(msg);
    };
    
    log(`**Provider:** DeepSeek`);
    log(`**Model:** ${model}`);
    
    const apiKey = this.plugin.settings.deepseekApiKey;
    if (!apiKey) {
      log(`**Error:** API key not configured`);
      const error = new Error('DeepSeek API key not configured. Please add it in settings.');
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    // DeepSeek uses OpenAI-compatible API
    const deepseekMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    if (options.systemPrompt) {
      deepseekMessages.unshift({
        role: 'system',
        content: options.systemPrompt,
      });
      log(`**System prompt:** (${options.systemPrompt.length} chars)`);
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: deepseekMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    log(`**Max tokens:** ${body.max_tokens}`);
    log(`**Temperature:** ${body.temperature}`);
    log(`**Messages count:** ${deepseekMessages.length}`);
    log(`\n**Request body:**\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``);
    
    let response;
    try {
      response = await requestUrl({
        url: 'https://api.deepseek.com/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      log(`\n**Request failed:** ${e.message || String(e)}`);
      const error = new Error(`DeepSeek API error: ${e.message || String(e)}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    log(`\n**Response status:** ${response.status}`);
    
    if (response.status !== 200) {
      log(`**Response body:**\n\`\`\`\n${response.text}\n\`\`\``);
      const error = new Error(`DeepSeek API error: ${response.status} - ${response.text}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    const data = response.json;
    log(`**Response received successfully**`);
    log(`**Input tokens:** ${data.usage?.prompt_tokens}`);
    log(`**Output tokens:** ${data.usage?.completion_tokens}`);
    
    return {
      content: data.choices[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      debugLog: options.debug ? debugLog : undefined,
    };
  }
  
  /**
   * Perplexity API (OpenAI-compatible)
   */
  private async chatPerplexity(
    messages: AIMessage[],
    model: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      debug?: boolean;
    }
  ): Promise<AIResponse> {
    const debugLog: string[] = [];
    const log = (msg: string) => {
      if (options.debug) debugLog.push(msg);
    };
    
    log(`**Provider:** Perplexity`);
    log(`**Model:** ${model}`);
    
    const apiKey = this.plugin.settings.perplexityApiKey;
    if (!apiKey) {
      log(`**Error:** API key not configured`);
      const error = new Error('Perplexity API key not configured. Please add it in settings.');
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    // Perplexity uses OpenAI-compatible API
    const perplexityMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    if (options.systemPrompt) {
      perplexityMessages.unshift({
        role: 'system',
        content: options.systemPrompt,
      });
      log(`**System prompt:** (${options.systemPrompt.length} chars)`);
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: perplexityMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    log(`**Max tokens:** ${body.max_tokens}`);
    log(`**Temperature:** ${body.temperature}`);
    log(`**Messages count:** ${perplexityMessages.length}`);
    log(`\n**Request body:**\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``);
    
    let response;
    try {
      response = await requestUrl({
        url: 'https://api.perplexity.ai/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      log(`\n**Request failed:** ${e.message || String(e)}`);
      const error = new Error(`Perplexity API error: ${e.message || String(e)}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    log(`\n**Response status:** ${response.status}`);
    
    if (response.status !== 200) {
      log(`**Response body:**\n\`\`\`\n${response.text}\n\`\`\``);
      const error = new Error(`Perplexity API error: ${response.status} - ${response.text}`);
      (error as any).debugLog = debugLog;
      throw error;
    }
    
    const data = response.json;
    log(`**Response received successfully**`);
    log(`**Input tokens:** ${data.usage?.prompt_tokens}`);
    log(`**Output tokens:** ${data.usage?.completion_tokens}`);
    
    return {
      content: data.choices[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      debugLog: options.debug ? debugLog : undefined,
    };
  }
  
  /**
   * Get the provider for a given model alias
   */
  getProvider(modelAlias: string): AIProvider | null {
    const modelConfig = resolveModel(modelAlias, this.plugin.settings);
    return modelConfig?.provider || null;
  }
  
  /**
   * Check if API key is configured for a provider
   */
  hasApiKey(provider: AIProvider): boolean {
    switch (provider) {
      case 'anthropic':
        return !!this.plugin.settings.anthropicApiKey;
      case 'openai':
        return !!this.plugin.settings.openaiApiKey;
      case 'google':
        return !!this.plugin.settings.googleApiKey;
      case 'deepseek':
        return !!this.plugin.settings.deepseekApiKey;
      case 'perplexity':
        return !!this.plugin.settings.perplexityApiKey;
      default:
        return false;
    }
  }
}

