/**
 * Block Processor - Handles AI block processing
 * Port of process_ai_block.py
 */

import { TFile, Notice, Platform, requestUrl } from 'obsidian';
import { processTags, Replacements, escapeTags, extractTags } from '../parser/tagParser';
import { AIMessage, BEACON, ProcessingContext, MessageContent, PDF_CAPABLE_PROVIDERS, resolveModel, ThinkingConfig, AIToolResult } from '../types';
import { ToolDefinition } from '../tools';
import { showToolConfirmation, ToolConfirmationResult } from '../ui/ToolConfirmationModal';
import { getSkin } from '../skins';
import { computeRequestPrice } from '../pricing';
import type ObsidianAIPlugin from '../main';

// Node.js modules for reading external files - desktop only
// Using dynamic require to satisfy eslint and for mobile compatibility
type FSModule = typeof import('fs');
type PathModule = typeof import('path');

let fs: FSModule | null = null;
let path: PathModule | null = null;

if (Platform.isDesktop) {
  try {
    // Use dynamic require for external file reading (desktop-only feature)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs = (window as unknown as { require: NodeRequire }).require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    path = (window as unknown as { require: NodeRequire }).require('path');
  } catch {
    // Modules not available
    console.warn('Node.js fs/path modules not available');
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

/**
 * Extract raw wikilinks from text that are NOT already inside tags
 * Returns array of link targets (without the [[ and ]])
 */
function extractRawWikilinks(text: string): string[] {
  // First, remove all tag contents to avoid matching wikilinks inside tags
  // This regex matches <tagname!...> patterns including wikilinks inside them
  const textWithoutTags = text.replace(/<[a-z][a-z0-9_]*!(?:"[^"]*"|[^>])*>/gi, '');

  // Now find all wikilinks in the remaining text
  const wikilinks: string[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(textWithoutTags)) !== null) {
    const linkTarget = match[1].trim();
    if (linkTarget && !wikilinks.includes(linkTarget)) {
      wikilinks.push(linkTarget);
    }
  }

  return wikilinks;
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
    // Convert from current skin to canonical for processing
    const activeSkin = getSkin(this.plugin.settings.chatSkin);
    const canonicalContent = activeSkin.toCanonical(content);

    // First pass: remove content from ai blocks to get doc context
    const [docWithoutAi] = processTags(canonicalContent, {
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
    const [, tags] = processTags(canonicalContent);
    const aiBlocks = tags.filter(t => t.name === 'ai');

    let result = canonicalContent;

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

    // Convert from canonical back to active skin for output
    return activeSkin.fromCanonical(finalResult);
  }

  /**
   * Check if block text contains a reply tag
   */
  private hasReplyTag(text: string): boolean {
    const [, tags] = processTags(text);
    return tags.some(t => t.name === 'reply');
  }

  /**
   * Check if block text contains the processing placeholder
   */
  private hasProcessingPlaceholder(text: string): boolean {
    return text.includes(BEACON.PROCESSING);
  }

  /**
   * Replace reply tags with processing placeholder
   * This is called first to show the user that processing has started
   */
  replaceReplyWithPlaceholder(content: string): { newContent: string; hasChanges: boolean } {
    // Convert to canonical first to ensure we find reply tags consistently
    const activeSkin = getSkin(this.plugin.settings.chatSkin);
    const canonicalContent = activeSkin.toCanonical(content);

    const [, tags] = processTags(canonicalContent);
    const aiBlocks = tags.filter(t => t.name === 'ai');

    let result = canonicalContent;
    let hasChanges = false;

    for (const block of aiBlocks) {
      if (block.text && this.hasReplyTag(block.text)) {
        // Replace <reply!> with processing placeholder in this block (canonical format)
        const newBlockText = block.text.replace(/<reply!>/gi, BEACON.PROCESSING);
        const newBlock = `<ai!${block.value || ''}>${newBlockText}</ai!>`;
        result = result.replace(block.fullMatch, newBlock);
        hasChanges = true;
      }
    }

    // Convert back to active skin for display
    return { newContent: activeSkin.fromCanonical(result), hasChanges };
  }

  /**
   * Process content that has processing placeholders
   * This replaces the placeholders with actual AI responses
   */
  async processPlaceholders(content: string, filePath: string): Promise<string> {
    // Convert from current skin to canonical for processing
    const activeSkin = getSkin(this.plugin.settings.chatSkin);
    const canonicalContent = activeSkin.toCanonical(content);

    // First pass: remove content from ai blocks to get doc context
    const [docWithoutAi] = processTags(canonicalContent, {
      ai: () => '',
    });

    const context: ProcessingContext = {
      doc: docWithoutAi,
      filePath,
    };

    // Find all AI blocks that have processing placeholders
    const [, tags] = processTags(canonicalContent);
    const aiBlocks = tags.filter(t => t.name === 'ai');

    let result = canonicalContent;

    for (const block of aiBlocks) {
      if (block.text && this.hasProcessingPlaceholder(block.text)) {
        const processedBlock = await this.processAiBlockWithPlaceholder(block.value, block.text, context, filePath);
        result = result.replace(block.fullMatch, processedBlock);
      }
    }

    // Also process help tags
    const [finalResult] = processTags(result, {
      help: () => this.getHelpText(),
    });

    // Convert from canonical back to active skin for output
    return activeSkin.fromCanonical(finalResult);
  }

  /**
   * Process a single AI block that has the processing placeholder
   * (called after replaceReplyWithPlaceholder)
   */
  private async processAiBlockWithPlaceholder(
    option: string | null,
    blockText: string,
    context: ProcessingContext,
    filePath: string
  ): Promise<string> {
    const optionTxt = option || '';

    // Check if block has processing placeholder
    if (!this.hasProcessingPlaceholder(blockText)) {
      return `<ai!${optionTxt}>${blockText}</ai!>`;
    }

    // Remove the processing placeholder from the block
    const blockWithoutPlaceholder = blockText.replace(BEACON.PROCESSING, '');

    return this.executeAiBlock(optionTxt, blockWithoutPlaceholder, context, filePath);
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
  private async preloadDocuments(text: string, inlineMode: boolean = false): Promise<LoadedDocuments> {
    const docs: LoadedDocuments = {};
    const tags = extractTags(text);

    // Collect all paths to load
    const pathsToLoad: string[] = [];

    // Add paths from <doc!> tags
    for (const tag of tags) {
      if (tag.name === 'doc' && tag.value) {
        pathsToLoad.push(tag.value);
      }
    }

    // Add raw wikilinks if inline mode is active
    if (inlineMode) {
      const wikilinks = extractRawWikilinks(text);
      for (const link of wikilinks) {
        // Store as [[link]] format to match how we'll look them up later
        const key = `[[${link}]]`;
        if (!pathsToLoad.includes(key)) {
          pathsToLoad.push(key);
        }
      }
    }

    // Load all documents
    for (const path of pathsToLoad) {
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

    return docs;
  }

  /**
   * Call AI with tool support - handles the tool execution loop
   */
  private async callAIWithTools(
    messages: AIMessage[],
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      thinking?: ThinkingConfig;
      debug?: boolean;
      tools?: ToolDefinition[];
    }
  ): Promise<{
    content: string;
    thinking?: string;
    toolExecutions?: Array<{ name: string; args: Record<string, unknown>; result: string; aiMessage?: string }>;
    inputTokens?: number;
    outputTokens?: number;
    debugLog?: string[];
  }> {
    const debugLog: string[] = [];
    const log = (msg: string) => {
      if (options.debug) debugLog.push(msg);
    };

    const toolExecutions: Array<{ name: string; args: Record<string, unknown>; result: string; aiMessage?: string }> = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalContent = '';
    let finalThinking = '';

    // Clone messages to avoid modifying original
    const conversationMessages = [...messages];

    // Maximum tool iterations to prevent infinite loops
    const MAX_TOOL_ITERATIONS = 10;
    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      // Call AI
      const response = await this.plugin.aiService.chat(conversationMessages, options);

      // Accumulate tokens
      if (response.inputTokens) totalInputTokens += response.inputTokens;
      if (response.outputTokens) totalOutputTokens += response.outputTokens;
      if (response.debugLog) debugLog.push(...response.debugLog);
      if (response.thinking) finalThinking += response.thinking;

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalContent = response.content;
        break;
      }

      // Execute tool calls
      log(`\n**Tool Loop Iteration ${iteration}:**`);

      const toolResults: AIToolResult[] = [];

      for (const toolCall of response.toolCalls) {
        log(`  Executing: ${toolCall.name}`);

        // Check if tool requires confirmation (unsafe)
        const requiresConfirmation = this.plugin.toolManager.toolRequiresConfirmation(toolCall.name);

        if (requiresConfirmation) {
          // Get tool description for the modal
          const tool = this.plugin.toolManager.getTool(toolCall.name);
          const toolDescription = tool?.definition.description || 'No description available';

          log(`    Showing confirmation modal for unsafe tool`);

          // Show confirmation modal and wait for user response
          const confirmation: ToolConfirmationResult = await showToolConfirmation(
            this.plugin.app,
            {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
            toolDescription
          );

          if (!confirmation.approved) {
            // User rejected - pass feedback to AI
            const feedbackMsg = confirmation.feedback
              ? `User rejected this action with feedback: "${confirmation.feedback}"`
              : 'User rejected this action without providing feedback.';

            toolResults.push({
              toolCallId: toolCall.id,
              error: feedbackMsg,
            });
            log(`    User rejected tool execution`);

            // Record as a rejected tool execution
            toolExecutions.push({
              name: toolCall.name,
              args: toolCall.arguments,
              result: `❌ REJECTED: ${feedbackMsg}`,
              aiMessage: response.content,
            });

            continue;
          }

          log(`    User approved tool execution`);
        }

        // Execute the tool
        const result = await this.plugin.toolManager.executeTool({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        toolResults.push({
          toolCallId: toolCall.id,
          result: result.result,
          error: result.error,
        });

        // Record tool execution with AI's message if present
        toolExecutions.push({
          name: toolCall.name,
          args: toolCall.arguments,
          result: result.result || result.error || 'No result',
          aiMessage: response.content || undefined,
        });

        log(`    Result: ${(result.result || result.error || '').substring(0, 100)}...`);
      }

      // Add assistant message with tool calls to conversation
      // The assistant's response needs to include the tool_use blocks
      // For Gemini 3, we must also include thought_signature if present
      const assistantContent: any[] = [];
      if (response.content) {
        assistantContent.push({ type: 'text', text: response.content });
      }
      for (const tc of response.toolCalls) {
        const toolUseBlock: Record<string, unknown> = {
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        };

        // Include thought_signature if present (required for Gemini 3 models)
        if (tc.thoughtSignature) {
          toolUseBlock.thought_signature = tc.thoughtSignature;
        }

        assistantContent.push(toolUseBlock);
      }
      conversationMessages.push({
        role: 'assistant',
        content: assistantContent,
      } as any);

      // Add tool results as user message
      // Include both tool_use_id (for Anthropic) and name + thought_signature (for Gemini)
      const toolResultContents = toolResults.map((r, i) => {
        const toolCall = response.toolCalls![i];
        const result: Record<string, unknown> = {
          type: 'tool_result' as const,
          tool_use_id: r.toolCallId,
          name: toolCall?.name, // For Gemini
          content: r.error ? `Error: ${r.error}` : r.result || '',
        };

        // Include thought_signature if present (required for Gemini 3 models)
        if (toolCall?.thoughtSignature) {
          result.thought_signature = toolCall.thoughtSignature;
        }

        return result;
      });
      conversationMessages.push({
        role: 'user',
        content: toolResultContents,
      } as any);
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      log(`**Warning:** Max tool iterations (${MAX_TOOL_ITERATIONS}) reached`);
    }

    return {
      content: finalContent,
      thinking: finalThinking || undefined,
      toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      debugLog: debugLog.length > 0 ? debugLog : undefined,
    };
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

    return this.executeAiBlock(optionTxt, blockWithoutReply, context, filePath);
  }

  /**
   * Execute AI processing on a block (shared logic for both paths)
   */
  private async executeAiBlock(
    optionTxt: string,
    blockWithoutReply: string,
    context: ProcessingContext,
    filePath: string
  ): Promise<string> {
    try {
      // Check if inline mode is enabled (via <inline!> tag or global setting)
      const tags = extractTags(blockWithoutReply);
      const hasInlineTag = tags.some(t => t.name === 'inline');
      const inlineMode = hasInlineTag || this.plugin.settings.inlineWikilinks;

      // Pre-load all referenced documents, files, images, PDFs, URLs, and prompts
      const loadedDocs = await this.preloadDocuments(blockWithoutReply, inlineMode);
      const loadedFiles = await this.preloadFiles(blockWithoutReply);
      const loadedImages = await this.preloadImages(blockWithoutReply);
      const loadedPDFs = await this.preloadPDFs(blockWithoutReply);
      const loadedUrls = await this.preloadUrls(blockWithoutReply);
      const loadedPrompts = await this.preloadPrompts(blockWithoutReply);

      // Parse the block to extract parameters and process context tags
      const [processedText, extractedTags, images, pdfs] = this.processContextTags(
        blockWithoutReply.trim(),
        context.doc,
        loadedDocs,
        loadedFiles,
        loadedImages,
        loadedPDFs,
        loadedUrls,
        loadedPrompts,
        inlineMode
      );

      // Extract parameters from tags
      const params = this.extractParams(extractedTags);

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
          tokenInfo = `${BEACON.TOKENS_PREFIX}${modelAlias}|In=0,Out=0 (MOCK)|==\n`;
        }

        const newBlock = `${blockWithoutReply}${BEACON.AI}\n${tokenInfo}${thinkingBlock}${mockContent}\n${BEACON.ME}\n`;

        if (this.plugin.settings.playNotificationSound) {
          this.playNotificationSound();
        }

        return `<ai!${optionTxt}>${newBlock}</ai!>`;
      }

      // Show processing notice
      new Notice('Processing AI request...', 2000);

      // Get tools if specified
      let tools: ToolDefinition[] | undefined;
      if (params.toolsets && params.toolsets.length > 0) {
        tools = this.plugin.toolManager.getToolDefinitions(params.toolsets);
        if (tools.length === 0) {
          throw new Error(`No tools found for toolsets: ${params.toolsets.join(', ')}`);
        }
      }

      // Call AI with tool loop
      const response = await this.callAIWithTools(messages, {
        model: modelAlias,
        systemPrompt,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        thinking: params.thinking,
        debug: params.debug,
        tools,
      });

      // Escape any tags in the response
      const escapedResponse = escapeTags(response.content, [
        'ai', 'reply', 'model', 'system', 'doc', 'this', 'url', 'pdf', 'file',
        'prompt', 'tools', 'think', 'debug', 'temperature', 'max_tokens', 'image'
      ]);

      // Build the result block
      let tokenInfo = '';
      if (this.plugin.settings.showTokenCount && response.inputTokens && response.outputTokens) {
        // Calculate cost if available
        const cost = computeRequestPrice(response.inputTokens, response.outputTokens, modelAlias);
        const costStr = cost !== null ? `,Cost=${cost.toFixed(6)}` : '';
        tokenInfo = `${BEACON.TOKENS_PREFIX}${modelAlias}|In=${response.inputTokens},Out=${response.outputTokens}${costStr}|==\n`;
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

      // Add tool executions if present (before the final response)
      let toolsBlock = '';
      if (response.toolExecutions && response.toolExecutions.length > 0) {
        const toolsContent = response.toolExecutions.map(te => {
          let block = '';
          // Show AI's intermediate message if present
          if (te.aiMessage) {
            block += `*${te.aiMessage}*\n\n`;
          }
          block += `🔧 **${te.name}**\n`;
          block += `\`\`\`json\n${JSON.stringify(te.args, null, 2)}\n\`\`\`\n`;
          block += `\`\`\`\n${te.result.substring(0, 500)}${te.result.length > 500 ? '...' : ''}\n\`\`\``;
          return block;
        }).join('\n\n---\n\n');
        toolsBlock = `### Tool Executions\n\n${toolsContent}\n\n---\n\n`;
      }

      // Add debug log if present
      let debugBlock = '';
      if (response.debugLog && response.debugLog.length > 0) {
        debugBlock = `\n---\n### Debug Log\n${response.debugLog.join('\n')}\n---\n`;
      }

      // Order: tokens -> thinking -> tools -> final response -> debug
      const newBlock = `${blockWithoutReply}${BEACON.AI}\n${tokenInfo}${thinkingBlock}${toolsBlock}${escapedResponse}${debugBlock}\n${BEACON.ME}\n`;

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
   * Process context tags (this!, doc!, url!, image!, pdf!, dock!, etc.)
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
    loadedPrompts: LoadedPrompts = {},
    inlineMode: boolean = false
  ): [string, Array<{ name: string; value: string | null; text: string | null }>, Array<{ base64: string; mediaType: string }>, Array<{ base64: string }>] {
    const collectedTags: Array<{ name: string; value: string | null; text: string | null }> = [];
    const collectedImages: Array<{ base64: string; mediaType: string }> = [];
    const collectedPDFs: Array<{ base64: string }> = [];

    const replacements: Replacements = {
      // Remove parameter tags (we'll extract them separately)
      reply: () => '',
      back: () => '',
      ignore: (v, text) => '', // Content in <ignore!>...</ignore!> is stripped from AI context
      model: (v) => { collectedTags.push({ name: 'model', value: v, text: null }); return ''; },
      system: (v) => { collectedTags.push({ name: 'system', value: v, text: null }); return ''; },
      debug: () => { collectedTags.push({ name: 'debug', value: null, text: null }); return ''; },
      temperature: (v) => { collectedTags.push({ name: 'temperature', value: v, text: null }); return ''; },
      max_tokens: (v) => { collectedTags.push({ name: 'max_tokens', value: v, text: null }); return ''; },
      tools: (v) => { collectedTags.push({ name: 'tools', value: v, text: null }); return ''; },
      think: () => { collectedTags.push({ name: 'think', value: null, text: null }); return ''; },
      inline: () => { collectedTags.push({ name: 'inline', value: null, text: null }); return ''; },

      // Context tags
      this: () => `<document>\n${docContent}\n</document>\n`,
      doc: (v) => this.insertDocRef(v, loadedDocs),
      file: (v) => this.insertFileRef(v, loadedFiles),
      url: (v) => this.insertUrlRef(v, loadedUrls),
      prompt: (v) => this.insertPromptRef(v, loadedPrompts),
      image: (v) => this.insertImageRef(v, loadedImages, collectedImages),
      pdf: (v) => this.insertPDFRef(v, loadedPDFs, collectedPDFs),
    };

    let [processed, parsedTags] = processTags(text, replacements);

    // Add parsed tags to collected
    for (const tag of parsedTags) {
      if (!collectedTags.some(t => t.name === tag.name)) {
        collectedTags.push({ name: tag.name, value: tag.value, text: tag.text });
      }
    }

    // If inline mode is active, convert raw wikilinks to doc references
    if (inlineMode) {
      processed = this.convertWikilinksToDocRefs(processed, loadedDocs);
    }

    return [processed, collectedTags, collectedImages, collectedPDFs];
  }

  /**
   * Convert raw [[wikilinks]] to doc references using pre-loaded content.
   * 
   * IMPORTANT: Wikilinks inside existing <document> blocks are NOT expanded.
   * Those blocks came from explicit <doc!> tags, and their content should be
   * preserved as-is. This prevents double-inclusion when a referenced document
   * contains wikilinks to other documents that were also explicitly included.
   */
  private convertWikilinksToDocRefs(text: string, loadedDocs: LoadedDocuments): string {
    // Protect existing <document> blocks from wikilink expansion
    // These came from <doc!> tags and should not have their content modified
    const documentBlockPattern = /<document>[\s\S]*?<\/document>/g;
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    // Replace document blocks with placeholders to protect them
    const documentBlocks: string[] = [];
    let textWithPlaceholders = text.replace(documentBlockPattern, (match) => {
      const index = documentBlocks.length;
      documentBlocks.push(match);
      return `__DOCBLOCK_PLACEHOLDER_${index}__`;
    });

    // Expand wikilinks only in the unprotected text
    textWithPlaceholders = textWithPlaceholders.replace(wikiLinkPattern, (match, target, displayText) => {
      const key = `[[${target.trim()}]]`;
      const loaded = loadedDocs[key];

      if (loaded) {
        if ('error' in loaded) {
          // Keep the original link with an error note
          return `${match} *(Error: ${loaded.error})*`;
        }
        // Insert the document content
        return `<document><filename>${loaded.filename}</filename>\n<contents>\n${loaded.content}\n</contents></document>\n`;
      }

      // Keep original if not found in loaded docs
      return match;
    });

    // Restore the protected document blocks
    for (let i = 0; i < documentBlocks.length; i++) {
      textWithPlaceholders = textWithPlaceholders.replace(`__DOCBLOCK_PLACEHOLDER_${i}__`, documentBlocks[i]);
    }

    return textWithPlaceholders;
  }

  /**
   * Insert PDF reference and collect PDF data
   */
  private insertPDFRef(
    pdfPath: string | null,
    loadedPDFs: LoadedPDFs,
    collectedPDFs: Array<{ base64: string }>
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
    collectedImages: Array<{ base64: string; mediaType: string }>
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
  private extractParams(tags: Array<{ name: string; value: string | null; text: string | null }>): {
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
          // Multiple tools tags should accumulate, not overwrite
          if (tag.value) {
            const toolsetNames = tag.value.split(',').map(s => s.trim());
            if (!params.toolsets) {
              params.toolsets = [];
            }
            // Add new toolsets, avoiding duplicates
            for (const name of toolsetNames) {
              if (!(params.toolsets as string[]).includes(name)) {
                (params.toolsets as string[]).push(name);
              }
            }
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
    images: Array<{ base64: string; mediaType: string }> = [],
    pdfs: Array<{ base64: string }> = []
  ): AIMessage[] {
    const messages: AIMessage[] = [];
    const hasMedia = images.length > 0 || pdfs.length > 0;

    // Strip token info before parsing (it's metadata, not conversation content)
    // Handle all formats: |==In=X,Out=Y|==, |==model|In=X,Out=Y|==, |==model|In=X,Out=Y,Cost=Z|==
    let cleanedText = text.replace(/\|==[^|]*\|?In=\d+,Out=\d+[^|]*\|==\n?/g, '');

    // Strip thinking blocks (they're internal reasoning, not conversation)
    cleanedText = cleanedText.replace(/\|THOUGHT\|\n[\s\S]*?\n\|\/THOUGHT\|\n?/g, '');

    // Split by AI and ME beacons
    const parts = cleanedText.split(new RegExp(`(${escapeRegex(BEACON.AI)}|${escapeRegex(BEACON.ME)})`));

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
- \`<TOOLS!obsidian>\` - Enable Obsidian vault tools

## Tools

Enable AI to use tools to interact with your vault:

\`\`\`
<AI!>
<TOOLS!obsidian>
Find all notes mentioning "project" and summarize them.
<REPLY!>
</AI!>
\`\`\`

**Available Obsidian tools:**
- \`list_vault\` - List files and directories
- \`get_note_outline\` - Get heading structure
- \`read_note\` - Read note content with line numbers
- \`read_note_section\` - Read specific section by heading
- \`search_vault\` - Search filenames and content
- \`get_note_links\` - Get outgoing wikilinks
- \`get_backlinks\` - Get incoming links
- \`search_in_note\` - Search within a note

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
- \`<INLINE!>\` - Treat all [[links]] as document references (include their content)

## Branching Conversations

Use \`<BRANCH!>\` to create a new note with a copy of the conversation up to that point:

\`\`\`
<AI!>
<MODEL!sonnet4>
What should I cook tonight?
|AI|
How about a Thai curry or pasta?
|ME|
<BRANCH!"exploring thai">
Tell me more about the Thai curry option.
<REPLY!>
</AI!>
\`\`\`

When saved, this creates a new note "Your Note (branch exploring thai)" containing the conversation up to the branch point, and replaces the \`<BRANCH!>\` tag with a link to the new note.

- \`<BRANCH!>\` - Create branch with auto-generated timestamp name
- \`<BRANCH!"name">\` - Create branch with custom name

The branch link is wrapped in \`<IGNORE!>\` so it doesn't affect AI context if you continue the original conversation.

### Ignoring Content

Use \`<IGNORE!>...\` to exclude content from AI processing while keeping it visible:

\`\`\`
<IGNORE!>This text is visible but the AI won't see it</IGNORE!>
\`\`\`

### Inline Mode

Use \`<INLINE!>\` to automatically include the content of all [[linked notes]] in your prompt:

\`\`\`
<AI!>
<INLINE!>
Compare the approaches described in [[Project A]] and [[Project B]].
<REPLY!>
</AI!>
\`\`\`

With \`<INLINE!>\`, you don't need to write \`<DOC![[Project A]]>\` - just use regular Obsidian links.
You can also enable this globally in settings ("Inline linked notes").

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

  /**
   * Check if content has a branch tag (including inside AI blocks)
   */
  hasBranchTag(content: string): boolean {
    // Convert to canonical for consistent processing
    const activeSkin = getSkin(this.plugin.settings.chatSkin);
    const canonicalContent = activeSkin.toCanonical(content);

    // First check top-level tags
    const [, tags] = processTags(canonicalContent);
    if (tags.some(t => t.name === 'branch')) {
      return true;
    }

    // Also check inside AI blocks (branch tags are nested inside <ai!>)
    const aiBlocks = tags.filter(t => t.name === 'ai');
    for (const block of aiBlocks) {
      if (block.text) {
        const [, innerTags] = processTags(block.text);
        if (innerTags.some(t => t.name === 'branch')) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Process branch tags in content
   * Creates new notes for branches and replaces branch tags with links
   * @returns The modified content with branch tags replaced by links
   */
  async processBranchTags(content: string, sourceFile: TFile): Promise<string> {
    // Convert to canonical for consistent processing
    const activeSkin = getSkin(this.plugin.settings.chatSkin);
    const canonicalContent = activeSkin.toCanonical(content);

    // Find all AI blocks
    const [, tags] = processTags(canonicalContent);
    const aiBlocks = tags.filter(t => t.name === 'ai');

    let result = canonicalContent;

    for (const block of aiBlocks) {
      if (block.text && this.hasBranchTag(block.text)) {
        const processedBlock = await this.processBranchInBlock(block, sourceFile);
        result = result.replace(block.fullMatch, processedBlock);
      }
    }

    // Convert back to active skin
    return activeSkin.fromCanonical(result);
  }

  /**
   * Process branch tags within a single AI block
   */
  private async processBranchInBlock(block: { value: string | null; text: string | null; fullMatch: string }, sourceFile: TFile): Promise<string> {
    if (!block.text) return block.fullMatch;

    // Find all branch tags in the block
    const branchTags = extractTags(block.text).filter(t => t.name === 'branch');

    if (branchTags.length === 0) return block.fullMatch;

    let blockText = block.text;
    const newBranchLinks: string[] = [];

    // Process each branch tag (in reverse order to preserve indices)
    for (let i = branchTags.length - 1; i >= 0; i--) {
      const branchTag = branchTags[i];

      // Extract content up to (but not including) the branch tag
      const contentUpToBranch = blockText.substring(0, branchTag.startIndex);

      // Create the new branch note
      const branchName = branchTag.value || this.generateBranchName();
      const sanitizedBranchName = sanitizeNoteTitle(branchName);
      const newNotePath = await this.createBranchNote(sourceFile, contentUpToBranch, sanitizedBranchName, block.value);

      if (newNotePath) {
        // Get just the note name for the wikilink (without .md extension and folder)
        const noteName = newNotePath.replace(/\.md$/, '').split('/').pop() || newNotePath;

        // Replace the branch tag with an ignored link
        const branchLink = `<ignore!>🌿 Branch: [[${noteName}]]</ignore!>`;
        blockText = blockText.substring(0, branchTag.startIndex) + branchLink + blockText.substring(branchTag.endIndex);

        // Track the new branch for the index
        newBranchLinks.push(noteName);

        new Notice(`Created branch: ${noteName}`, 3000);
      } else {
        // Failed to create branch - replace with error message
        blockText = blockText.substring(0, branchTag.startIndex) +
          `<ignore!>❌ Failed to create branch "${sanitizedBranchName}"</ignore!>` +
          blockText.substring(branchTag.endIndex);
      }
    }

    // Update or create the branch index at the top of the block
    blockText = this.updateBranchIndex(blockText, newBranchLinks);

    // Reconstruct the AI block
    const optionTxt = block.value || '';
    return `<ai!${optionTxt}>${blockText}</ai!>`;
  }

  /**
   * Update or create the branch index at the top of the AI block
   * The index lists all branches in this conversation
   */
  private updateBranchIndex(blockText: string, newBranchLinks: string[]): string {
    // Pattern to find existing branch index
    const indexPattern = /<ignore!>\s*🌿\s*\*\*Branches:\*\*\n([\s\S]*?)<\/ignore!>\n*/;
    const indexMatch = blockText.match(indexPattern);

    // Collect existing branches from the index
    let existingBranches: string[] = [];
    if (indexMatch) {
      // Parse the existing branch list
      const branchListText = indexMatch[1];
      const linkPattern = /\[\[([^\]]+)\]\]/g;
      let match;
      while ((match = linkPattern.exec(branchListText)) !== null) {
        existingBranches.push(match[1]);
      }
      // Remove the old index from the block text
      blockText = blockText.replace(indexPattern, '');
    }

    // Combine existing and new branches (new ones first since they were processed in reverse)
    const allBranches = [...newBranchLinks.reverse(), ...existingBranches];

    // Remove duplicates while preserving order
    const uniqueBranches = [...new Set(allBranches)];

    if (uniqueBranches.length === 0) {
      return blockText;
    }

    // Create the new branch index
    const branchList = uniqueBranches.map(b => `- [[${b}]]`).join('\n');
    const branchIndex = `<ignore!>🌿 **Branches:**\n${branchList}\n</ignore!>\n\n`;

    // Insert at the very beginning of the block (after any leading whitespace)
    const leadingWhitespace = blockText.match(/^(\s*)/)?.[1] || '';
    const contentWithoutLeading = blockText.substring(leadingWhitespace.length);

    return leadingWhitespace + branchIndex + contentWithoutLeading;
  }

  /**
   * Generate a branch name when none is specified
   * Uses timestamp for uniqueness
   */
  private generateBranchName(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
  }

  /**
   * Create a new branch note
   * @returns The path of the created note, or null if failed
   */
  private async createBranchNote(
    sourceFile: TFile,
    conversationContent: string,
    branchName: string,
    aiBlockOption: string | null
  ): Promise<string | null> {
    try {
      // Get the source note's basename (without extension)
      const sourceBasename = sourceFile.basename;
      const sourceFolder = sourceFile.parent?.path || '';

      // Create the new note name
      const newNoteName = `${sourceBasename} (branch ${branchName})`;
      const newNotePath = sourceFolder ? `${sourceFolder}/${newNoteName}.md` : `${newNoteName}.md`;

      // Check if a note with this name already exists
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(newNotePath);
      if (existingFile) {
        // Append a number to make it unique
        let counter = 2;
        let uniquePath = newNotePath;
        while (this.plugin.app.vault.getAbstractFileByPath(uniquePath)) {
          const uniqueName = `${sourceBasename} (branch ${branchName} ${counter})`;
          uniquePath = sourceFolder ? `${sourceFolder}/${uniqueName}.md` : `${uniqueName}.md`;
          counter++;
        }
        return await this.writeBranchNote(uniquePath, conversationContent, sourceFile, aiBlockOption);
      }

      return await this.writeBranchNote(newNotePath, conversationContent, sourceFile, aiBlockOption);
    } catch (error) {
      console.error('Error creating branch note:', error);
      return null;
    }
  }

  /**
   * Write the branch note content
   */
  private async writeBranchNote(
    notePath: string,
    conversationContent: string,
    sourceFile: TFile,
    aiBlockOption: string | null
  ): Promise<string | null> {
    try {
      // Build the note content in canonical format
      const optionTxt = aiBlockOption || '';

      // Add a header linking back to the source
      const branchHeader = `> [!info] Branched from [[${sourceFile.basename}]]\n\n`;

      // Wrap the conversation content in AI tags (still in canonical format)
      const canonicalContent = `${branchHeader}<ai!${optionTxt}>${conversationContent}</ai!>`;

      // Convert from canonical to active skin before writing
      const activeSkin = getSkin(this.plugin.settings.chatSkin);
      const noteContent = activeSkin.fromCanonical(canonicalContent);

      // Create the note
      await this.plugin.app.vault.create(notePath, noteContent);

      return notePath;
    } catch (error) {
      console.error('Error writing branch note:', error);
      return null;
    }
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a string for use as a note title
 * Removes characters that are invalid in Obsidian note names: [ ] # ^ | \
 */
function sanitizeNoteTitle(title: string): string {
  return title.replace(/[\[\]#^|\\]/g, '').trim();
}

