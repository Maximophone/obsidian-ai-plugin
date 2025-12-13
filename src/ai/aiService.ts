/**
 * AI Service - Unified interface for multiple AI providers
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import { AIMessage, AIResponse, AIProvider, resolveModel, ModelConfig } from '../types';
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
   * Anthropic Claude API
   */
  private async chatAnthropic(
    messages: AIMessage[],
    model: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<AIResponse> {
    const apiKey = this.plugin.settings.anthropicApiKey;
    if (!apiKey) {
      throw new Error('Anthropic API key not configured. Please add it in settings.');
    }
    
    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
    
    // Extract system prompt from messages if not provided
    let systemPrompt = options.systemPrompt;
    if (!systemPrompt) {
      const systemMsg = messages.find(m => m.role === 'system');
      if (systemMsg) {
        systemPrompt = systemMsg.content;
      }
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    if (systemPrompt) {
      body.system = systemPrompt;
    }
    
    const requestParams: RequestUrlParam = {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };
    
    const response = await requestUrl(requestParams);
    
    if (response.status !== 200) {
      throw new Error(`Anthropic API error: ${response.status} - ${response.text}`);
    }
    
    const data = response.json;
    
    // Extract text content
    let content = '';
    for (const block of data.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }
    
    return {
      content,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    };
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
    }
  ): Promise<AIResponse> {
    const apiKey = this.plugin.settings.openaiApiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please add it in settings.');
    }
    
    // Convert messages to OpenAI format
    const openaiMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    // Add system prompt if provided
    if (options.systemPrompt) {
      openaiMessages.unshift({
        role: 'system',
        content: options.systemPrompt,
      });
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    const requestParams: RequestUrlParam = {
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
    
    const response = await requestUrl(requestParams);
    
    if (response.status !== 200) {
      throw new Error(`OpenAI API error: ${response.status} - ${response.text}`);
    }
    
    const data = response.json;
    
    return {
      content: data.choices[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
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
    }
  ): Promise<AIResponse> {
    const apiKey = this.plugin.settings.googleApiKey;
    if (!apiKey) {
      throw new Error('Google AI API key not configured. Please add it in settings.');
    }
    
    // Convert messages to Gemini format
    const contents = [];
    
    // Add system instruction if provided
    let systemInstruction: { parts: { text: string }[] } | undefined;
    if (options.systemPrompt) {
      systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Handle system messages as system instruction
        if (!systemInstruction) {
          systemInstruction = {
            parts: [{ text: msg.content }],
          };
        }
        continue;
      }
      
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
    
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
        temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
      },
    };
    
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }
    
    const requestParams: RequestUrlParam = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };
    
    const response = await requestUrl(requestParams);
    
    if (response.status !== 200) {
      throw new Error(`Google AI API error: ${response.status} - ${response.text}`);
    }
    
    const data = response.json;
    
    // Extract text from response
    let content = '';
    if (data.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.text) {
          content += part.text;
        }
      }
    }
    
    return {
      content,
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
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
    }
  ): Promise<AIResponse> {
    const apiKey = this.plugin.settings.deepseekApiKey;
    if (!apiKey) {
      throw new Error('DeepSeek API key not configured. Please add it in settings.');
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
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: deepseekMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    const requestParams: RequestUrlParam = {
      url: 'https://api.deepseek.com/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
    
    const response = await requestUrl(requestParams);
    
    if (response.status !== 200) {
      throw new Error(`DeepSeek API error: ${response.status} - ${response.text}`);
    }
    
    const data = response.json;
    
    return {
      content: data.choices[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
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
    }
  ): Promise<AIResponse> {
    const apiKey = this.plugin.settings.perplexityApiKey;
    if (!apiKey) {
      throw new Error('Perplexity API key not configured. Please add it in settings.');
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
    }
    
    const body: Record<string, unknown> = {
      model,
      messages: perplexityMessages,
      max_tokens: options.maxTokens || this.plugin.settings.defaultMaxTokens,
      temperature: options.temperature ?? this.plugin.settings.defaultTemperature,
    };
    
    const requestParams: RequestUrlParam = {
      url: 'https://api.perplexity.ai/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
    
    const response = await requestUrl(requestParams);
    
    if (response.status !== 200) {
      throw new Error(`Perplexity API error: ${response.status} - ${response.text}`);
    }
    
    const data = response.json;
    
    return {
      content: data.choices[0]?.message?.content || '',
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
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

