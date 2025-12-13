/**
 * Obsidian Toolset - Tools for interacting with the vault
 * All read-only tools (safe=true) - no confirmation needed
 */

import { App, TFile, TFolder, TAbstractFile } from 'obsidian';
import { RegisteredTool, Toolset, ToolDefinition } from './types';

/**
 * Format byte size to human readable
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Create the Obsidian toolset
 */
export function createObsidianToolset(app: App): Toolset {
  const tools: RegisteredTool[] = [];

  // ============ list_vault ============
  tools.push({
    definition: {
      name: 'list_vault',
      description: 'List files and directories in the vault. Shows file sizes to help decide what to read. Use path="" for root.',
      parameters: {
        path: {
          type: 'string',
          description: 'Directory path relative to vault root. Use "" for root.',
          required: false,
          default: '',
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const path = (args.path as string) || '';
      
      let folder: TFolder;
      if (path === '' || path === '/') {
        folder = app.vault.getRoot();
      } else {
        const abstractFile = app.vault.getAbstractFileByPath(path);
        if (!abstractFile) {
          return `Error: Path not found: ${path}`;
        }
        if (!(abstractFile instanceof TFolder)) {
          return `Error: Path is not a directory: ${path}`;
        }
        folder = abstractFile;
      }

      const items: string[] = [];
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          items.push(`📁 ${child.name}/`);
        } else if (child instanceof TFile) {
          const size = formatSize(child.stat.size);
          items.push(`📄 ${child.name} (${size})`);
        }
      }

      if (items.length === 0) {
        return `Directory "${path || '/'}" is empty.`;
      }

      return `Contents of "${path || '/'}":\n${items.join('\n')}`;
    },
  });

  // ============ get_note_outline ============
  tools.push({
    definition: {
      name: 'get_note_outline',
      description: 'Get the outline/structure of a note without reading its full content. Shows headings hierarchy and line counts. Use this to understand a note\'s structure before reading specific sections.',
      parameters: {
        filepath: {
          type: 'string',
          description: 'Path to the note file (relative to vault root)',
          required: true,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const filepath = args.filepath as string;
      const file = app.vault.getAbstractFileByPath(filepath);
      
      if (!file || !(file instanceof TFile)) {
        return `Error: Note not found: ${filepath}`;
      }

      const content = await app.vault.read(file);
      const lines = content.split('\n');
      
      const headings: { level: number; text: string; line: number }[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          headings.push({
            level: match[1].length,
            text: match[2],
            line: i + 1,
          });
        }
      }

      if (headings.length === 0) {
        return `Note "${filepath}" has no headings.\nTotal lines: ${lines.length}\nSize: ${formatSize(file.stat.size)}`;
      }

      const outline = headings.map(h => {
        const indent = '  '.repeat(h.level - 1);
        return `${indent}${'#'.repeat(h.level)} ${h.text} (line ${h.line})`;
      }).join('\n');

      return `Outline of "${filepath}":\nTotal lines: ${lines.length}\nSize: ${formatSize(file.stat.size)}\n\n${outline}`;
    },
  });

  // ============ read_note ============
  tools.push({
    definition: {
      name: 'read_note',
      description: 'Read a note with line numbers. Supports reading specific line ranges for large notes.',
      parameters: {
        filepath: {
          type: 'string',
          description: 'Path to the note file (relative to vault root)',
          required: true,
        },
        offset: {
          type: 'number',
          description: 'Start reading from this line number (1-based). Default: 1',
          required: false,
          default: 1,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read. Default: 200',
          required: false,
          default: 200,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const filepath = args.filepath as string;
      const offset = (args.offset as number) || 1;
      const limit = (args.limit as number) || 200;
      
      const file = app.vault.getAbstractFileByPath(filepath);
      
      if (!file || !(file instanceof TFile)) {
        return `Error: Note not found: ${filepath}`;
      }

      const content = await app.vault.read(file);
      const allLines = content.split('\n');
      const totalLines = allLines.length;
      
      const startIdx = Math.max(0, offset - 1);
      const endIdx = Math.min(totalLines, startIdx + limit);
      const selectedLines = allLines.slice(startIdx, endIdx);
      
      const numberedLines = selectedLines.map((line, i) => {
        const lineNum = startIdx + i + 1;
        return `${String(lineNum).padStart(6)}| ${line}`;
      });

      let result = numberedLines.join('\n');
      
      if (endIdx < totalLines) {
        const remaining = totalLines - endIdx;
        result += `\n\n... ${remaining} more lines. Use offset=${endIdx + 1} to continue reading.`;
      }

      return result;
    },
  });

  // ============ read_note_section ============
  tools.push({
    definition: {
      name: 'read_note_section',
      description: 'Read a specific section of a note by heading name. Returns content from the heading until the next heading of same or higher level.',
      parameters: {
        filepath: {
          type: 'string',
          description: 'Path to the note file',
          required: true,
        },
        heading: {
          type: 'string',
          description: 'The heading text to find (without # symbols)',
          required: true,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const filepath = args.filepath as string;
      const heading = args.heading as string;
      
      const file = app.vault.getAbstractFileByPath(filepath);
      
      if (!file || !(file instanceof TFile)) {
        return `Error: Note not found: ${filepath}`;
      }

      const content = await app.vault.read(file);
      const lines = content.split('\n');
      
      let startLine = -1;
      let startLevel = 0;
      
      // Find the heading
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (match && match[2].trim().toLowerCase() === heading.trim().toLowerCase()) {
          startLine = i;
          startLevel = match[1].length;
          break;
        }
      }

      if (startLine === -1) {
        return `Error: Heading "${heading}" not found in ${filepath}`;
      }

      // Find the end (next heading of same or higher level)
      let endLine = lines.length;
      for (let i = startLine + 1; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,6})\s+/);
        if (match && match[1].length <= startLevel) {
          endLine = i;
          break;
        }
      }

      const sectionLines = lines.slice(startLine, endLine);
      const numberedLines = sectionLines.map((line, i) => {
        const lineNum = startLine + i + 1;
        return `${String(lineNum).padStart(6)}| ${line}`;
      });

      return numberedLines.join('\n');
    },
  });

  // ============ search_vault ============
  tools.push({
    definition: {
      name: 'search_vault',
      description: 'Search for notes by filename or content. Returns matching files with context.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search query (searches filenames and content)',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results. Default: 10',
          required: false,
          default: 10,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const query = (args.query as string).toLowerCase();
      const limit = (args.limit as number) || 10;
      
      const results: { path: string; context: string; score: number }[] = [];
      const files = app.vault.getMarkdownFiles();

      for (const file of files) {
        let score = 0;
        let context = '';

        // Check filename
        if (file.basename.toLowerCase().includes(query)) {
          score += 10;
          context = `Filename match`;
        }

        // Check content
        const content = await app.vault.cachedRead(file);
        const lowerContent = content.toLowerCase();
        const idx = lowerContent.indexOf(query);
        
        if (idx !== -1) {
          score += 5;
          // Extract context around match
          const start = Math.max(0, idx - 50);
          const end = Math.min(content.length, idx + query.length + 50);
          const snippet = content.slice(start, end).replace(/\n/g, ' ');
          context = context ? `${context}; Content: ...${snippet}...` : `...${snippet}...`;
        }

        if (score > 0) {
          results.push({ path: file.path, context, score });
        }
      }

      // Sort by score and limit
      results.sort((a, b) => b.score - a.score);
      const topResults = results.slice(0, limit);

      if (topResults.length === 0) {
        return `No results found for "${query}"`;
      }

      return topResults.map((r, i) => 
        `${i + 1}. ${r.path}\n   ${r.context}`
      ).join('\n\n');
    },
  });

  // ============ get_note_links ============
  tools.push({
    definition: {
      name: 'get_note_links',
      description: 'Get all wikilinks from a note. Use this to discover connected notes without reading the full content.',
      parameters: {
        filepath: {
          type: 'string',
          description: 'Path to the note file',
          required: true,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const filepath = args.filepath as string;
      const file = app.vault.getAbstractFileByPath(filepath);
      
      if (!file || !(file instanceof TFile)) {
        return `Error: Note not found: ${filepath}`;
      }

      const content = await app.vault.read(file);
      
      // Find all wikilinks
      const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      const links: string[] = [];
      let match;
      
      while ((match = linkRegex.exec(content)) !== null) {
        if (!links.includes(match[1])) {
          links.push(match[1]);
        }
      }

      if (links.length === 0) {
        return `Note "${filepath}" has no wikilinks.`;
      }

      return `Links in "${filepath}":\n${links.map(l => `  - [[${l}]]`).join('\n')}`;
    },
  });

  // ============ get_backlinks ============
  tools.push({
    definition: {
      name: 'get_backlinks',
      description: 'Get all notes that link TO this note (backlinks).',
      parameters: {
        filepath: {
          type: 'string',
          description: 'Path to the note file',
          required: true,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const filepath = args.filepath as string;
      const file = app.vault.getAbstractFileByPath(filepath);
      
      if (!file || !(file instanceof TFile)) {
        return `Error: Note not found: ${filepath}`;
      }

      // Get backlinks from metadata cache
      const backlinks = app.metadataCache.getBacklinksForFile(file);
      
      if (!backlinks || backlinks.data.size === 0) {
        return `No backlinks found for "${filepath}"`;
      }

      const backlinkPaths: string[] = [];
      backlinks.data.forEach((_, key) => {
        backlinkPaths.push(key);
      });

      return `Backlinks to "${filepath}":\n${backlinkPaths.map(p => `  - ${p}`).join('\n')}`;
    },
  });

  // ============ search_in_note ============
  tools.push({
    definition: {
      name: 'search_in_note',
      description: 'Search for text within a specific note. Returns matching lines with line numbers. Much faster than reading the whole note when looking for specific content.',
      parameters: {
        filepath: {
          type: 'string',
          description: 'Path to the note file',
          required: true,
        },
        query: {
          type: 'string',
          description: 'Text to search for',
          required: true,
        },
        context_lines: {
          type: 'number',
          description: 'Number of context lines before/after match. Default: 2',
          required: false,
          default: 2,
        },
      },
      safe: true,
    },
    execute: async (args) => {
      const filepath = args.filepath as string;
      const query = (args.query as string).toLowerCase();
      const contextLines = (args.context_lines as number) || 2;
      
      const file = app.vault.getAbstractFileByPath(filepath);
      
      if (!file || !(file instanceof TFile)) {
        return `Error: Note not found: ${filepath}`;
      }

      const content = await app.vault.read(file);
      const lines = content.split('\n');
      
      const matches: { lineNum: number; context: string[] }[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(query)) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length, i + contextLines + 1);
          const context = lines.slice(start, end).map((line, j) => {
            const lineNum = start + j + 1;
            const marker = (start + j === i) ? '>' : ' ';
            return `${marker}${String(lineNum).padStart(5)}| ${line}`;
          });
          matches.push({ lineNum: i + 1, context });
        }
      }

      if (matches.length === 0) {
        return `No matches found for "${query}" in ${filepath}`;
      }

      return `Found ${matches.length} match(es) for "${query}" in ${filepath}:\n\n${
        matches.map(m => m.context.join('\n')).join('\n---\n')
      }`;
    },
  });

  return {
    name: 'obsidian',
    description: 'Tools for interacting with your Obsidian vault - reading notes, searching, exploring structure',
    tools,
  };
}

