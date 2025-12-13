/**
 * Block Processor - Handles AI block processing
 * Port of process_ai_block.py
 */

import { TFile, Notice, Platform, requestUrl } from 'obsidian';
import { processTags, Replacements, escapeTags, extractTags } from '../parser/tagParser';
import { AIMessage, BEACON, ProcessingContext, MessageContent, PDF_CAPABLE_PROVIDERS, resolveModel, ThinkingConfig } from '../types';
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

interface LoadedImages {
  [path: string]: { base64: string; mediaType: string; filename: string } | { error: string };
}

interface LoadedPDFs {
  [path: string]: { base64: string; filename: string } | { error: string };
}

interface LoadedUrls {
  [url: string]: { content: string; title?: string } | { error: string };
}

interface LoadedPrompts {
  [name: string]: { content: string } | { error: string };
}

// Supported image extensions and their MIME types
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

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
   * Pre-load all images referenced by <image!> tags
   */
  private async preloadImages(text: string): Promise<LoadedImages> {
    const images: LoadedImages = {};
    const tags = extractTags(text);
    
    for (const tag of tags) {
      if (tag.name === 'image' && tag.value) {
        const imagePath = tag.value;
        if (images[imagePath]) continue; // Already loaded
        
        try {
          // Get file extension and MIME type
          const ext = path.extname(imagePath).toLowerCase();
          const mediaType = IMAGE_MIME_TYPES[ext];
          
          if (!mediaType) {
            images[imagePath] = { error: `Unsupported image format: ${ext}. Supported: png, jpg, jpeg, gif, webp` };
            continue;
          }
          
          let imageBuffer: Buffer;
          let filename: string;
          
          const isAbsolute = path.isAbsolute(imagePath);
          
          if (isAbsolute) {
            // Absolute path - use Node.js fs
            if (!fs) {
              images[imagePath] = { error: 'Reading images outside vault requires desktop Obsidian' };
              continue;
            }
            
            if (!fs.existsSync(imagePath)) {
              images[imagePath] = { error: `Image not found: ${imagePath}` };
              continue;
            }
            
            imageBuffer = fs.readFileSync(imagePath);
            filename = path.basename(imagePath);
          } else {
            // Relative path - try vault first
            const vaultPath = (this.plugin.app.vault.adapter as any).basePath;
            const fullPath = path.join(vaultPath, imagePath);
            
            // Check if file exists in vault
            const abstractFile = this.plugin.app.vault.getAbstractFileByPath(imagePath);
            if (abstractFile && abstractFile instanceof TFile) {
              // Read as binary using adapter
              const arrayBuffer = await this.plugin.app.vault.readBinary(abstractFile);
              imageBuffer = Buffer.from(arrayBuffer);
              filename = abstractFile.name;
            } else if (fs && fs.existsSync(fullPath)) {
              imageBuffer = fs.readFileSync(fullPath);
              filename = path.basename(imagePath);
            } else {
              images[imagePath] = { error: `Image not found: ${imagePath}` };
              continue;
            }
          }
          
          // Convert to base64
          const base64 = imageBuffer.toString('base64');
          images[imagePath] = { base64, mediaType, filename };
          
        } catch (e) {
          images[imagePath] = { error: `Error reading image ${imagePath}: ${e.message}` };
        }
      }
    }
    
    return images;
  }
  
  /**
   * Pre-load all PDFs referenced by <pdf!> tags
   */
  private async preloadPDFs(text: string): Promise<LoadedPDFs> {
    const pdfs: LoadedPDFs = {};
    const tags = extractTags(text);
    
    for (const tag of tags) {
      if (tag.name === 'pdf' && tag.value) {
        const pdfPath = tag.value;
        if (pdfs[pdfPath]) continue; // Already loaded
        
        try {
          // Check file extension
          const ext = path.extname(pdfPath).toLowerCase();
          if (ext !== '.pdf') {
            pdfs[pdfPath] = { error: `Not a PDF file: ${pdfPath}` };
            continue;
          }
          
          let pdfBuffer: Buffer;
          let filename: string;
          
          const isAbsolute = path.isAbsolute(pdfPath);
          
          if (isAbsolute) {
            // Absolute path - use Node.js fs
            if (!fs) {
              pdfs[pdfPath] = { error: 'Reading PDFs outside vault requires desktop Obsidian' };
              continue;
            }
            
            if (!fs.existsSync(pdfPath)) {
              pdfs[pdfPath] = { error: `PDF not found: ${pdfPath}` };
              continue;
            }
            
            pdfBuffer = fs.readFileSync(pdfPath);
            filename = path.basename(pdfPath);
          } else {
            // Relative path - try vault first
            const vaultPath = (this.plugin.app.vault.adapter as any).basePath;
            const fullPath = path.join(vaultPath, pdfPath);
            
            // Check if file exists in vault
            const abstractFile = this.plugin.app.vault.getAbstractFileByPath(pdfPath);
            if (abstractFile && abstractFile instanceof TFile) {
              // Read as binary using adapter
              const arrayBuffer = await this.plugin.app.vault.readBinary(abstractFile);
              pdfBuffer = Buffer.from(arrayBuffer);
              filename = abstractFile.name;
            } else if (fs && fs.existsSync(fullPath)) {
              pdfBuffer = fs.readFileSync(fullPath);
              filename = path.basename(pdfPath);
            } else {
              pdfs[pdfPath] = { error: `PDF not found: ${pdfPath}` };
              continue;
            }
          }
          
          // Convert to base64
          const base64 = pdfBuffer.toString('base64');
          pdfs[pdfPath] = { base64, filename };
          
        } catch (e) {
          pdfs[pdfPath] = { error: `Error reading PDF ${pdfPath}: ${e.message}` };
        }
      }
    }
    
    return pdfs;
  }
  
  /**
   * Pre-load all URLs referenced by <url!> tags
   */
  private async preloadUrls(text: string): Promise<LoadedUrls> {
    const urls: LoadedUrls = {};
    const tags = extractTags(text);
    
    for (const tag of tags) {
      if (tag.name === 'url' && tag.value) {
        const url = tag.value;
        if (urls[url]) continue; // Already loaded
        
        try {
          // Validate URL
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            urls[url] = { error: `Invalid URL (must start with http:// or https://): ${url}` };
            continue;
          }
          
          // Fetch the URL using Obsidian's requestUrl
          const response = await requestUrl({
            url,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ObsidianAI/1.0)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          
          if (response.status !== 200) {
            urls[url] = { error: `Failed to fetch URL (status ${response.status}): ${url}` };
            continue;
          }
          
          const html = response.text;
          
          // Extract title from HTML
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : undefined;
          
          // Convert HTML to plain text
          const textContent = this.htmlToText(html);
          
          urls[url] = { content: textContent, title };
          
        } catch (e) {
          urls[url] = { error: `Error fetching URL ${url}: ${e.message}` };
        }
      }
    }
    
    return urls;
  }
  
  /**
   * Pre-load all prompts referenced by <prompt!> tags
   */
  private async preloadPrompts(text: string): Promise<LoadedPrompts> {
    const prompts: LoadedPrompts = {};
    const tags = extractTags(text);
    
    for (const tag of tags) {
      if (tag.name === 'prompt' && tag.value) {
        const promptName = tag.value;
        if (prompts[promptName]) continue; // Already loaded
        
        try {
          // Try to find the prompt file in the prompts folder
          const promptsFolder = this.plugin.settings.promptsFolder;
          const promptPath = `${promptsFolder}/${promptName}.md`;
          
          const file = this.plugin.app.vault.getAbstractFileByPath(promptPath);
          if (file && file instanceof TFile) {
            const content = await this.plugin.app.vault.read(file);
            prompts[promptName] = { content };
          } else {
            // Try without .md extension (maybe user included it)
            const altPath = `${promptsFolder}/${promptName}`;
            const altFile = this.plugin.app.vault.getAbstractFileByPath(altPath);
            if (altFile && altFile instanceof TFile) {
              const content = await this.plugin.app.vault.read(altFile);
              prompts[promptName] = { content };
            } else {
              prompts[promptName] = { error: `Prompt not found: ${promptName} (looked in ${promptsFolder}/)` };
            }
          }
        } catch (e) {
          prompts[promptName] = { error: `Error reading prompt ${promptName}: ${e.message}` };
        }
      }
    }
    
    return prompts;
  }
  
  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    // Remove script and style elements
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
    
    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    
    // Replace common block elements with newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
    text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n');
    
    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');
    
    // Decode HTML entities
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;/gi, "'");
    text = text.replace(/&apos;/gi, "'");
    
    // Clean up whitespace
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n[ \t]+/g, '\n');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    
    return text;
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
      // Pre-load all referenced documents, files, images, PDFs, URLs, and prompts
      const loadedDocs = await this.preloadDocuments(blockWithoutReply);
      const loadedFiles = await this.preloadFiles(blockWithoutReply);
      const loadedImages = await this.preloadImages(blockWithoutReply);
      const loadedPDFs = await this.preloadPDFs(blockWithoutReply);
      const loadedUrls = await this.preloadUrls(blockWithoutReply);
      const loadedPrompts = await this.preloadPrompts(blockWithoutReply);
      
      // Parse the block to extract parameters and process context tags
      const [processedText, tags, images, pdfs] = this.processContextTags(
        blockWithoutReply.trim(), 
        context.doc, 
        loadedDocs, 
        loadedFiles, 
        loadedImages,
        loadedPDFs,
        loadedUrls,
        loadedPrompts
      );
      
      // Extract parameters from tags
      const params = this.extractParams(tags);
      
      // Get model
      const modelAlias = params.model || this.plugin.settings.defaultModel;
      
      // Get system prompt if specified
      let systemPrompt: string | undefined;
      if (params.system) {
        systemPrompt = await this.loadSystemPrompt(params.system);
      }
      
      // Check if PDFs are used with unsupported model
      if (pdfs.length > 0) {
        const modelConfig = resolveModel(modelAlias, this.plugin.settings);
        if (modelConfig && !PDF_CAPABLE_PROVIDERS.includes(modelConfig.provider)) {
          throw new Error(`PDF files are only supported with Claude (Anthropic) and Gemini (Google) models. Current model "${modelAlias}" uses provider "${modelConfig.provider}".`);
        }
      }
      
      // Build conversation from block text, including images and PDFs
      const messages = this.parseConversation(processedText, images, pdfs);
      
      // Check for mock mode - echoes back what would be sent to the AI
      if (params.mock) {
        new Notice('Mock mode: Echoing request (no API call)', 2000);
        
        // Build mock response that shows what would be sent
        let mockContent = '---PARAMETERS START---\n';
        mockContent += `model: ${modelAlias}\n`;
        mockContent += `max_tokens: ${params.maxTokens || this.plugin.settings.defaultMaxTokens}\n`;
        mockContent += `temperature: ${params.temperature ?? this.plugin.settings.defaultTemperature}\n`;
        if (params.thinking) {
          mockContent += `thinking: enabled\n`;
          mockContent += `thinking_budget_tokens: ${params.thinking.budgetTokens || 'auto'}\n`;
        }
        mockContent += '---PARAMETERS END---\n\n';
        
        mockContent += '---SYSTEM PROMPT START---\n';
        mockContent += (systemPrompt || '(none)') + '\n';
        mockContent += '---SYSTEM PROMPT END---\n\n';
        
        mockContent += '---MESSAGES START---\n';
        for (const msg of messages) {
          mockContent += `role: ${msg.role}\n`;
          mockContent += 'content:\n';
          if (typeof msg.content === 'string') {
            mockContent += msg.content + '\n';
          } else {
            for (const part of msg.content) {
              if (part.type === 'text') {
                mockContent += part.text + '\n';
              } else if (part.type === 'image') {
                mockContent += `[image: ${part.mediaType}, ${Math.round(part.base64Data.length / 1024)}KB base64]\n`;
              } else if (part.type === 'pdf') {
                mockContent += `[pdf: ${Math.round(part.base64Data.length / 1024)}KB base64]\n`;
              }
            }
          }
          mockContent += '\n';
        }
        mockContent += '---MESSAGES END---\n';
        
        // Add mock thinking if enabled
        let thinkingBlock = '';
        if (params.thinking) {
          const mockThinking = `Mock reasoning: This is a simulated chain of thought from the mock wrapper.
I would have used up to ${params.thinking.budgetTokens || 'auto'} tokens for this reasoning.
Step 1: First, I analyze the problem...
Step 2: Then, I consider possible approaches...
Step 3: Finally, I select the best solution...`;
          thinkingBlock = `${BEACON.THOUGHT}\n${mockThinking}\n${BEACON.END_THOUGHT}\n`;
        }
        
        let tokenInfo = '';
        if (this.plugin.settings.showTokenCount) {
          tokenInfo = `${BEACON.TOKENS_PREFIX}In=0,Out=0 (MOCK)|==\n`;
        }
        
        const newBlock = `${blockWithoutReply}${BEACON.AI}\n${tokenInfo}${thinkingBlock}${mockContent}\n${BEACON.ME}\n`;
        
        if (this.plugin.settings.playNotificationSound) {
          this.playNotificationSound();
        }
        
        return `<ai!${optionTxt}>${newBlock}</ai!>`;
      }
      
      // Show processing notice
      new Notice('Processing AI request...', 2000);
      
      // Call AI
      const response = await this.plugin.aiService.chat(messages, {
        model: modelAlias,
        systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        thinking: params.thinking,
        debug: params.debug,
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
      
      // Add thinking content if present
      let thinkingBlock = '';
      if (response.thinking) {
        const escapedThinking = escapeTags(response.thinking, [
          'ai', 'reply', 'model', 'system', 'doc', 'this', 'url', 'pdf', 'file', 
          'prompt', 'tools', 'think', 'debug', 'temperature', 'max_tokens', 'image'
        ]);
        thinkingBlock = `${BEACON.THOUGHT}\n${escapedThinking}\n${BEACON.END_THOUGHT}\n`;
      }
      
      // Add debug log if present
      let debugBlock = '';
      if (response.debugLog && response.debugLog.length > 0) {
        debugBlock = `\n---\n### Debug Log\n${response.debugLog.join('\n')}\n---\n`;
      }
      
      const newBlock = `${blockWithoutReply}${BEACON.AI}\n${tokenInfo}${thinkingBlock}${escapedResponse}${debugBlock}\n${BEACON.ME}\n`;
      
      // Play notification sound if enabled
      if (this.plugin.settings.playNotificationSound) {
        this.playNotificationSound();
      }
      
      return `<ai!${optionTxt}>${newBlock}</ai!>`;
      
    } catch (error) {
      console.error('Error processing AI block:', error);
      
      // Extract debug log from error if present
      let debugBlock = '';
      if ((error as any).debugLog && Array.isArray((error as any).debugLog)) {
        const debugLog = (error as any).debugLog as string[];
        debugBlock = `\n---\n### Debug Log\n${debugLog.join('\n')}\n---\n`;
      }
      
      // Use blockWithoutReply (not original) to prevent infinite loop - reply tag is already removed
      const errorBlock = `${blockWithoutReply}${BEACON.ERROR}\n\`\`\`\n${error.message}\n\`\`\`${debugBlock}\n`;
      return `<ai!${optionTxt}>${errorBlock}</ai!>`;
    }
  }
  
  /**
   * Process context tags (this!, doc!, url!, image!, pdf!, etc.)
   * Returns [processed text, collected tags, collected images, collected PDFs]
   */
  private processContextTags(
    text: string, 
    docContent: string, 
    loadedDocs: LoadedDocuments = {},
    loadedFiles: LoadedFiles = {},
    loadedImages: LoadedImages = {},
    loadedPDFs: LoadedPDFs = {},
    loadedUrls: LoadedUrls = {},
    loadedPrompts: LoadedPrompts = {}
  ): [string, Array<{name: string; value: string | null; text: string | null}>, Array<{base64: string; mediaType: string}>, Array<{base64: string}>] {
    const collectedTags: Array<{name: string; value: string | null; text: string | null}> = [];
    const collectedImages: Array<{base64: string; mediaType: string}> = [];
    const collectedPDFs: Array<{base64: string}> = [];
    
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
      url: (v) => this.insertUrlRef(v, loadedUrls),
      prompt: (v) => this.insertPromptRef(v, loadedPrompts),
      image: (v) => this.insertImageRef(v, loadedImages, collectedImages),
      pdf: (v) => this.insertPDFRef(v, loadedPDFs, collectedPDFs),
    };
    
    const [processed, parsedTags] = processTags(text, replacements);
    
    // Add parsed tags to collected
    for (const tag of parsedTags) {
      if (!collectedTags.some(t => t.name === tag.name)) {
        collectedTags.push({name: tag.name, value: tag.value, text: tag.text});
      }
    }
    
    return [processed, collectedTags, collectedImages, collectedPDFs];
  }
  
  /**
   * Insert PDF reference and collect PDF data
   */
  private insertPDFRef(
    pdfPath: string | null, 
    loadedPDFs: LoadedPDFs,
    collectedPDFs: Array<{base64: string}>
  ): string {
    if (!pdfPath) return 'Error: No PDF path specified';
    
    const loaded = loadedPDFs[pdfPath];
    if (loaded) {
      if ('error' in loaded) {
        return `Error: ${loaded.error}`;
      }
      // Add to collected PDFs for later use in API call
      collectedPDFs.push({ base64: loaded.base64 });
      return `[PDF: ${loaded.filename}]\n`;
    }
    
    return `Error: PDF ${pdfPath} was not pre-loaded`;
  }
  
  /**
   * Insert image reference and collect image data
   */
  private insertImageRef(
    imagePath: string | null, 
    loadedImages: LoadedImages,
    collectedImages: Array<{base64: string; mediaType: string}>
  ): string {
    if (!imagePath) return 'Error: No image path specified';
    
    const loaded = loadedImages[imagePath];
    if (loaded) {
      if ('error' in loaded) {
        return `Error: ${loaded.error}`;
      }
      // Add to collected images for later use in API call
      collectedImages.push({ base64: loaded.base64, mediaType: loaded.mediaType });
      return `[Image: ${loaded.filename}]\n`;
    }
    
    return `Error: Image ${imagePath} was not pre-loaded`;
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
    thinking?: ThinkingConfig;
    mock?: boolean;
    toolsets?: string[];
  } {
    const params: Record<string, unknown> = {};
    
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
        case 'think':
          // <think!> or <think!16000> for custom budget
          const thinkingConfig: ThinkingConfig = { enabled: true };
          if (tag.value) {
            const budget = parseInt(tag.value);
            if (!isNaN(budget) && budget > 0) {
              thinkingConfig.budgetTokens = budget;
            }
          }
          params.thinking = thinkingConfig;
          break;
        case 'mock':
          // <mock!> - echo back what would be sent to the AI
          params.mock = true;
          break;
        case 'tools':
          // <tools!obsidian> or <tools!obsidian,system>
          if (tag.value) {
            const toolsetNames = tag.value.split(',').map(s => s.trim());
            params.toolsets = toolsetNames;
          }
          break;
      }
    }
    
    return params as {
      model?: string;
      system?: string;
      temperature?: number;
      maxTokens?: number;
      debug?: boolean;
      thinking?: ThinkingConfig;
      mock?: boolean;
      toolsets?: string[];
    };
  }
  
  /**
   * Parse conversation text into messages, optionally including images and PDFs
   */
  private parseConversation(
    text: string, 
    images: Array<{base64: string; mediaType: string}> = [],
    pdfs: Array<{base64: string}> = []
  ): AIMessage[] {
    const messages: AIMessage[] = [];
    const hasMedia = images.length > 0 || pdfs.length > 0;
    
    // Split by AI and ME beacons
    const parts = text.split(new RegExp(`(${escapeRegex(BEACON.AI)}|${escapeRegex(BEACON.ME)})`));
    
    let currentRole: 'user' | 'assistant' = 'user';
    let currentContent = '';
    let isFirstUserMessage = true;
    
    // Helper to build content with media
    const buildContentWithMedia = (textContent: string): string | MessageContent[] => {
      if (!isFirstUserMessage || !hasMedia) {
        return textContent;
      }
      
      const content: MessageContent[] = [
        { type: 'text', text: textContent }
      ];
      
      // Add images
      for (const img of images) {
        content.push({
          type: 'image',
          mediaType: img.mediaType,
          base64Data: img.base64,
        });
      }
      
      // Add PDFs
      for (const pdf of pdfs) {
        content.push({
          type: 'pdf',
          base64Data: pdf.base64,
        });
      }
      
      isFirstUserMessage = false;
      return content;
    };
    
    for (const part of parts) {
      if (part === BEACON.AI) {
        // Save current content and switch to assistant
        if (currentContent.trim()) {
          if (currentRole === 'user') {
            messages.push({ role: currentRole, content: buildContentWithMedia(currentContent.trim()) });
          } else {
            messages.push({ role: currentRole, content: currentContent.trim() });
          }
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
      if (currentRole === 'user') {
        messages.push({ role: currentRole, content: buildContentWithMedia(currentContent.trim()) });
      } else {
        messages.push({ role: currentRole, content: currentContent.trim() });
      }
    }
    
    // Ensure we have at least one user message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: buildContentWithMedia(text.trim()) });
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
  private insertUrlRef(url: string | null, loadedUrls: LoadedUrls = {}): string {
    if (!url) return 'Error: No URL specified';
    
    // Check if we have pre-loaded content
    const loaded = loadedUrls[url];
    if (loaded) {
      if ('error' in loaded) {
        return `<url>${url}</url>\n<error>${loaded.error}</error>`;
      }
      const title = loaded.title ? `\n<title>${loaded.title}</title>` : '';
      return `<url>${url}</url>${title}\n<content>\n${loaded.content}\n</content>`;
    }
    
    return `<url>${url}</url>\n<error>URL was not pre-loaded</error>`;
  }
  
  /**
   * Insert prompt reference using pre-loaded content
   */
  private insertPromptRef(name: string | null, loadedPrompts: LoadedPrompts = {}): string {
    if (!name) return 'Error: No prompt name specified';
    
    // Check if we have pre-loaded content
    const loaded = loadedPrompts[name];
    if (loaded) {
      if ('error' in loaded) {
        return `<error>${loaded.error}</error>`;
      }
      return `<system_prompt name="${name}">\n${loaded.content}\n</system_prompt>`;
    }
    
    return `<error>Prompt "${name}" was not pre-loaded</error>`;
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
- \`<SYSTEM!prompt_name>\` - Set system prompt (loads from Prompts folder)
- \`<PROMPT!prompt_name>\` - Include prompt content inline (from Prompts folder)
- \`<THINK!>\` - Enable extended thinking (Claude, o-series, Gemini)
- \`<THINK!16000>\` - Enable thinking with custom token budget
- \`<DEBUG!>\` - Show debug info
- \`<MOCK!>\` - Echo what would be sent to AI (no API call, for debugging)

## Thinking Mode

Enable extended thinking for complex reasoning tasks:

\`\`\`
<AI!>
<MODEL!sonnet4>
<THINK!>
Solve this step by step: What is 17 * 23 + 45 / 9?
<REPLY!>
</AI!>
\`\`\`

**Provider support:**
- **Claude**: Full thinking visibility (shown in |THOUGHT| blocks)
- **OpenAI o-series**: Hidden reasoning (only token count shown)
- **Gemini thinking**: Full thinking visibility

## Content References

- \`<THIS!>\` - Include the current document
- \`<DOC!path>\` or \`<DOC![[Note Name]]>\` - Include another document
- \`<FILE!path>\` - Include any file
- \`<IMAGE!path>\` - Include an image (png, jpg, gif, webp) for vision models
- \`<PDF!path>\` - Include a PDF (Claude and Gemini only)
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

