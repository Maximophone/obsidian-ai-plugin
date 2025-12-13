/**
 * Block Processor - Handles AI block processing
 * Port of process_ai_block.py
 */

import { TFile, Notice, Platform } from 'obsidian';
import { processTags, Replacements, escapeTags, extractTags } from '../parser/tagParser';
import { AIMessage, BEACON, ProcessingContext } from '../types';
import type ObsidianAIPlugin from '../main';
import * as path from 'path';

// Node.js fs module - only available on desktop
let fs: typeof import('fs') | null = null;
if (Platform.isDesktop) {
  try {
    fs = require('fs');
  } catch (e) {
    console.warn('Could not load fs module:', e);
  }
}

interface LoadedDocuments {
  [path: string]: { content: string; filename: string } | { error: string };
}

interface LoadedFiles {
  [path: string]: { content: string; filename: string } | { error: string };
}

export class BlockProcessor {
  private plugin: ObsidianAIPlugin;
  
  constructor(plugin: ObsidianAIPlugin) {
    this.plugin = plugin;
  }
  
  /**
   * Process all AI blocks in content
   */
  async processContent(content: string, filePath: string): Promise<string> {
    // First pass: remove content from ai blocks to get doc context
    const [docWithoutAi] = processTags(content, {
      ai: () => '',
    });
    
    const context: ProcessingContext = {
      doc: docWithoutAi,
      filePath,
    };
    
    // Second pass: process AI blocks
    const replacements: Replacements = {
      ai: (value, text, ctx) => this.processAiBlockSync(value, text, ctx as ProcessingContext),
      help: () => this.getHelpText(),
    };
    
    // We need to handle async processing differently
    // First, find all AI blocks that need processing
    const [, tags] = processTags(content);
    const aiBlocks = tags.filter(t => t.name === 'ai');
    
    let result = content;
    
    for (const block of aiBlocks) {
      if (block.text && this.hasReplyTag(block.text)) {
        const processedBlock = await this.processAiBlock(block.value, block.text, context, filePath);
        result = result.replace(block.fullMatch, processedBlock);
      }
    }
    
    // Also process help tags
    const [finalResult] = processTags(result, {
      help: () => this.getHelpText(),
    });
    
    return finalResult;
  }
  
  /**
   * Check if block text contains a reply tag
   */
  private hasReplyTag(text: string): boolean {
    const [, tags] = processTags(text);
    return tags.some(t => t.name === 'reply');
  }
  
  /**
   * Synchronous wrapper (returns placeholder) - not used for actual processing
   */
  private processAiBlockSync(value: string | null, text: string | null, context: ProcessingContext): string {
    if (!text) return `<ai!${value || ''}>`;
    return `<ai!${value || ''}>${text}</ai!>`;
  }
  
  /**
   * Pre-load all files referenced by <file!> tags
   */
  private async preloadFiles(text: string): Promise<LoadedFiles> {
    const files: LoadedFiles = {};
    const tags = extractTags(text);
    
    for (const tag of tags) {
      if (tag.name === 'file' && tag.value) {
        const filePath = tag.value;
        if (files[filePath]) continue; // Already loaded
        
        try {
          let content: string;
          let filename: string;
          
          // Check if it's an absolute path or relative to vault
          const isAbsolute = path.isAbsolute(filePath);
          
          if (isAbsolute) {
            // Absolute path - use Node.js fs (desktop only)
            if (!fs) {
              files[filePath] = { error: 'Reading files outside vault requires desktop Obsidian' };
              continue;
            }
            
            if (!fs.existsSync(filePath)) {
              files[filePath] = { error: `File not found: ${filePath}` };
              continue;
            }
            
            content = fs.readFileSync(filePath, 'utf-8');
            filename = path.basename(filePath);
          } else {
            // Relative path - try vault first, then relative to vault root
            const vaultPath = (this.plugin.app.vault.adapter as any).basePath;
            const fullPath = path.join(vaultPath, filePath);
            
            // Try reading from vault adapter first
            const abstractFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (abstractFile && abstractFile instanceof TFile) {
              content = await this.plugin.app.vault.read(abstractFile);
              filename = abstractFile.name;
            } else if (fs && fs.existsSync(fullPath)) {
              // Fall back to fs for non-tracked files in vault
              content = fs.readFileSync(fullPath, 'utf-8');
              filename = path.basename(filePath);
            } else {
              files[filePath] = { error: `File not found: ${filePath}` };
              continue;
            }
          }
          
          files[filePath] = { content, filename };
        } catch (e) {
          files[filePath] = { error: `Error reading ${filePath}: ${e.message}` };
        }
      }
    }
    
    return files;
  }
  
  /**
   * Pre-load all documents referenced by <doc!> tags
   */
  private async preloadDocuments(text: string): Promise<LoadedDocuments> {
    const docs: LoadedDocuments = {};
    const tags = extractTags(text);
    
    for (const tag of tags) {
      if (tag.name === 'doc' && tag.value) {
        const path = tag.value;
        if (docs[path]) continue; // Already loaded
        
        // Handle wikilink format [[Note Name]]
        let notePath = path;
        if (path.startsWith('[[') && path.endsWith(']]')) {
          notePath = path.slice(2, -2);
        }
        
        // Try to resolve the file
        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(notePath, '');
        
        if (!file) {
          docs[path] = { error: `Cannot find document: ${notePath}` };
          continue;
        }
        
        if (!(file instanceof TFile)) {
          docs[path] = { error: `Not a file: ${notePath}` };
          continue;
        }
        
        try {
          const content = await this.plugin.app.vault.read(file);
          docs[path] = { content, filename: file.name };
        } catch (e) {
          docs[path] = { error: `Error reading ${notePath}: ${e.message}` };
        }
      }
    }
    
    return docs;
  }
  
  /**
   * Process a single AI block
   */
  private async processAiBlock(
    option: string | null,
    blockText: string,
    context: ProcessingContext,
    filePath: string
  ): Promise<string> {
    const optionTxt = option || '';
    
    // Check if block needs processing (has reply tag)
    if (!this.hasReplyTag(blockText)) {
      return `<ai!${optionTxt}>${blockText}</ai!>`;
    }
    
    // Remove the reply tag from the block FIRST - this prevents infinite loops on error
    const [blockWithoutReply] = processTags(blockText, {
      reply: () => '',
    });
    
    try {
      // Pre-load all referenced documents and files
      const loadedDocs = await this.preloadDocuments(blockWithoutReply);
      const loadedFiles = await this.preloadFiles(blockWithoutReply);
      
      // Parse the block to extract parameters and process context tags
      const [processedText, tags] = this.processContextTags(blockWithoutReply.trim(), context.doc, loadedDocs, loadedFiles);
      
      // Extract parameters from tags
      const params = this.extractParams(tags);
      
      // Get model
      const modelAlias = params.model || this.plugin.settings.defaultModel;
      
      // Get system prompt if specified
      let systemPrompt: string | undefined;
      if (params.system) {
        systemPrompt = await this.loadSystemPrompt(params.system);
      }
      
      // Build conversation from block text
      const messages = this.parseConversation(processedText);
      
      // Show processing notice
      new Notice('Processing AI request...', 2000);
      
      // Call AI
      const response = await this.plugin.aiService.chat(messages, {
        model: modelAlias,
        systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      });
      
      // Escape any tags in the response
      const escapedResponse = escapeTags(response.content, [
        'ai', 'reply', 'model', 'system', 'doc', 'this', 'url', 'pdf', 'file', 
        'prompt', 'tools', 'think', 'debug', 'temperature', 'max_tokens', 'image'
      ]);
      
      // Build the result block
      let tokenInfo = '';
      if (this.plugin.settings.showTokenCount && response.inputTokens && response.outputTokens) {
        tokenInfo = `${BEACON.TOKENS_PREFIX}In=${response.inputTokens},Out=${response.outputTokens}|==\n`;
      }
      
      const newBlock = `${blockWithoutReply}${BEACON.AI}\n${tokenInfo}${escapedResponse}\n${BEACON.ME}\n`;
      
      // Play notification sound if enabled
      if (this.plugin.settings.playNotificationSound) {
        this.playNotificationSound();
      }
      
      return `<ai!${optionTxt}>${newBlock}</ai!>`;
      
    } catch (error) {
      console.error('Error processing AI block:', error);
      // Use blockWithoutReply (not original) to prevent infinite loop - reply tag is already removed
      const errorBlock = `${blockWithoutReply}${BEACON.ERROR}\n\`\`\`\n${error.message}\n\`\`\`\n`;
      return `<ai!${optionTxt}>${errorBlock}</ai!>`;
    }
  }
  
  /**
   * Process context tags (this!, doc!, url!, etc.)
   */
  private processContextTags(
    text: string, 
    docContent: string, 
    loadedDocs: LoadedDocuments = {},
    loadedFiles: LoadedFiles = {}
  ): [string, Array<{name: string; value: string | null; text: string | null}>] {
    const collectedTags: Array<{name: string; value: string | null; text: string | null}> = [];
    
    const replacements: Replacements = {
      // Remove parameter tags (we'll extract them separately)
      reply: () => '',
      back: () => '',
      model: (v) => { collectedTags.push({name: 'model', value: v, text: null}); return ''; },
      system: (v) => { collectedTags.push({name: 'system', value: v, text: null}); return ''; },
      debug: () => { collectedTags.push({name: 'debug', value: null, text: null}); return ''; },
      temperature: (v) => { collectedTags.push({name: 'temperature', value: v, text: null}); return ''; },
      max_tokens: (v) => { collectedTags.push({name: 'max_tokens', value: v, text: null}); return ''; },
      tools: (v) => { collectedTags.push({name: 'tools', value: v, text: null}); return ''; },
      think: () => { collectedTags.push({name: 'think', value: null, text: null}); return ''; },
      
      // Context tags
      this: () => `<document>\n${docContent}\n</document>\n`,
      doc: (v) => this.insertDocRef(v, loadedDocs),
      file: (v) => this.insertFileRef(v, loadedFiles),
      url: (v) => this.insertUrlRef(v),
      prompt: (v) => this.insertPromptRef(v),
    };
    
    const [processed, parsedTags] = processTags(text, replacements);
    
    // Add parsed tags to collected
    for (const tag of parsedTags) {
      if (!collectedTags.some(t => t.name === tag.name)) {
        collectedTags.push({name: tag.name, value: tag.value, text: tag.text});
      }
    }
    
    return [processed, collectedTags];
  }
  
  /**
   * Extract parameters from tags
   */
  private extractParams(tags: Array<{name: string; value: string | null; text: string | null}>): {
    model?: string;
    system?: string;
    temperature?: number;
    maxTokens?: number;
    debug?: boolean;
  } {
    const params: Record<string, string | number | boolean> = {};
    
    for (const tag of tags) {
      switch (tag.name) {
        case 'model':
          if (tag.value) params.model = tag.value;
          break;
        case 'system':
          if (tag.value) params.system = tag.value;
          break;
        case 'temperature':
          if (tag.value) params.temperature = parseFloat(tag.value);
          break;
        case 'max_tokens':
          if (tag.value) params.maxTokens = parseInt(tag.value);
          break;
        case 'debug':
          params.debug = true;
          break;
      }
    }
    
    return params;
  }
  
  /**
   * Parse conversation text into messages
   */
  private parseConversation(text: string): AIMessage[] {
    const messages: AIMessage[] = [];
    
    // Split by AI and ME beacons
    const parts = text.split(new RegExp(`(${escapeRegex(BEACON.AI)}|${escapeRegex(BEACON.ME)})`));
    
    let currentRole: 'user' | 'assistant' = 'user';
    let currentContent = '';
    
    for (const part of parts) {
      if (part === BEACON.AI) {
        // Save current content and switch to assistant
        if (currentContent.trim()) {
          messages.push({ role: currentRole, content: currentContent.trim() });
        }
        currentRole = 'assistant';
        currentContent = '';
      } else if (part === BEACON.ME) {
        // Save current content and switch to user
        if (currentContent.trim()) {
          messages.push({ role: currentRole, content: currentContent.trim() });
        }
        currentRole = 'user';
        currentContent = '';
      } else {
        currentContent += part;
      }
    }
    
    // Add final content
    if (currentContent.trim()) {
      messages.push({ role: currentRole, content: currentContent.trim() });
    }
    
    // Ensure we have at least one user message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: text.trim() });
    }
    
    return messages;
  }
  
  /**
   * Insert document reference using pre-loaded content
   */
  private insertDocRef(path: string | null, loadedDocs: LoadedDocuments = {}): string {
    if (!path) return 'Error: No document path specified';
    
    // Check if we have pre-loaded content
    const loaded = loadedDocs[path];
    if (loaded) {
      if ('error' in loaded) {
        return `Error: ${loaded.error}`;
      }
      return `<document><filename>${loaded.filename}</filename>\n<contents>\n${loaded.content}\n</contents></document>\n`;
    }
    
    // Fallback: try to resolve but can't read synchronously
    let notePath = path;
    if (path.startsWith('[[') && path.endsWith(']]')) {
      notePath = path.slice(2, -2);
    }
    
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(notePath, '');
    if (!file) {
      return `Error: Cannot find document ${notePath}`;
    }
    
    return `Error: Document ${notePath} was not pre-loaded`;
  }
  
  /**
   * Insert file reference using pre-loaded content
   */
  private insertFileRef(filePath: string | null, loadedFiles: LoadedFiles = {}): string {
    if (!filePath) return 'Error: No file path specified';
    
    // Check if we have pre-loaded content
    const loaded = loadedFiles[filePath];
    if (loaded) {
      if ('error' in loaded) {
        return `Error: ${loaded.error}`;
      }
      return `<file><filename>${loaded.filename}</filename>\n<contents>\n${loaded.content}\n</contents></file>\n`;
    }
    
    return `Error: File ${filePath} was not pre-loaded`;
  }
  
  /**
   * Insert URL reference
   */
  private insertUrlRef(url: string | null): string {
    if (!url) return 'Error: No URL specified';
    return `<url>${url}</url>\n<content>[[Content will be fetched]]</content>`;
  }
  
  /**
   * Insert prompt reference
   */
  private insertPromptRef(name: string | null): string {
    if (!name) return 'Error: No prompt name specified';
    return `[[Prompt ${name} will be loaded]]`;
  }
  
  /**
   * Load system prompt from prompts folder
   */
  private async loadSystemPrompt(name: string): Promise<string | undefined> {
    const promptPath = `${this.plugin.settings.promptsFolder}/${name}.md`;
    const file = this.plugin.app.vault.getAbstractFileByPath(promptPath);
    
    if (!file || !(file instanceof TFile)) {
      console.warn(`System prompt not found: ${promptPath}`);
      return undefined;
    }
    
    try {
      const content = await this.plugin.app.vault.read(file);
      // Remove frontmatter if present
      return this.removeFrontmatter(content);
    } catch (e) {
      console.error(`Error loading system prompt: ${e}`);
      return undefined;
    }
  }
  
  /**
   * Remove YAML frontmatter from content
   */
  private removeFrontmatter(content: string): string {
    if (!content.startsWith('---')) {
      return content;
    }
    
    const lines = content.split('\n');
    let endIndex = -1;
    
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        endIndex = i;
        break;
      }
    }
    
    if (endIndex === -1) {
      return content;
    }
    
    return lines.slice(endIndex + 1).join('\n').trim();
  }
  
  /**
   * Play notification sound
   */
  private playNotificationSound(): void {
    // Use Web Audio API for a simple notification
    try {
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      // Ignore audio errors
    }
  }
  
  /**
   * Get help text
   */
  private getHelpText(): string {
    return `# Obsidian AI Help

> [!warning] About the examples below
> All tag examples in this help use **UPPERCASE** (e.g., \`<AI!>\`, \`<REPLY!>\`) to prevent them from being processed when you view this help. When you write your own tags, **use lowercase**: \`<ai!>\`, \`<reply!>\`, \`<model!>\`, etc.

## Basic Usage

Add an AI block to any note, include \`<REPLY!>\` where you want the response:

\`\`\`
<AI!>
What are the key points in this note?
<REPLY!>
</AI!>
\`\`\`

Save the file, and the AI will respond where \`<REPLY!>\` was placed.

## AI Model & Parameters

- \`<MODEL!name>\` - Choose model: haiku, sonnet, opus, gpt4, gemini, etc.
- \`<TEMPERATURE!0.7>\` - Set randomness (0.0-1.0)
- \`<MAX_TOKENS!4000>\` - Set max response length
- \`<SYSTEM!prompt_name>\` - Use a prompt from your vault's Prompts folder
- \`<THINK!>\` - Enable extended thinking mode
- \`<DEBUG!>\` - Show debug info

## Content References

- \`<THIS!>\` - Include the current document
- \`<DOC!path>\` or \`<DOC![[Note Name]]>\` - Include another document
- \`<FILE!path>\` - Include any file
- \`<URL!https://...>\` - Fetch and include webpage content

## Examples

**Simple question:**
\`\`\`
<AI!>
Summarize this note in 3 bullet points.
<REPLY!>
</AI!>
\`\`\`

**With a custom model and system prompt:**
\`\`\`
<AI!>
<MODEL!opus>
<SYSTEM!code_reviewer>
Review this code for potential issues.
<REPLY!>
</AI!>
\`\`\`

## Model Aliases

**Anthropic:** haiku, haiku3.5, sonnet, sonnet3.5, sonnet3.7, sonnet4, sonnet4.5, opus3, opus4, opus4.1, opus4.5
**OpenAI:** gpt3.5, gpt4, gpt4o, gpt4.1, mini, gpt5, gpt5-mini, o1, o1-mini, o3, o4-mini
**Google:** gemini, gemini-flash, gemini-pro, gemini1.0, gemini1.5, gemini2.0flash, gemini2.5pro, gemini3.0pro
**DeepSeek:** deepseek, deepseek-chat, deepseek-reasoner
**Perplexity:** sonar, sonar-pro

You can also use direct format: \`<MODEL!anthropic:claude-3-opus-20240229>\`

Add custom models in plugin settings.
`;
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

