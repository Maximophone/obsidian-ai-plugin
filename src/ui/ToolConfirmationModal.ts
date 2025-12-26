/**
 * Tool Confirmation Modal
 * Shows a confirmation dialog for unsafe (write) tool operations
 * With smart formatting for different argument types
 */

import { App, Modal, Setting } from 'obsidian';
import { ToolCall } from '../tools/types';

export interface ToolConfirmationResult {
  approved: boolean;
  feedback?: string; // Optional feedback message to send back to the AI
}

/**
 * Detect if a string looks like code (Python, JS, etc.)
 */
function looksLikeCode(value: string): boolean {
  // Check for common code patterns
  const codePatterns = [
    /^(import |from |def |class |function |const |let |var |if |for |while )/m,
    /[{}();]/,
    /^\s*(print|console\.log|return)\s*\(/m,
    /\n\s{2,}/,  // Indented lines
  ];
  return codePatterns.some(pattern => pattern.test(value));
}

/**
 * Detect the language of code for syntax highlighting hints
 */
function detectLanguage(value: string, paramName: string): string {
  if (paramName === 'code' || paramName === 'python_code') {
    if (value.includes('import ') || value.includes('def ') || value.includes('print(')) {
      return 'python';
    }
  }
  if (value.includes('function ') || value.includes('const ') || value.includes('console.log')) {
    return 'javascript';
  }
  if (value.includes('#!/bin/bash') || value.includes('#!/bin/sh')) {
    return 'bash';
  }
  return 'text';
}

/**
 * Format a parameter value for display
 */
function formatParamValue(name: string, value: unknown): { type: 'code' | 'path' | 'text' | 'boolean' | 'json', display: string, language?: string } {
  if (typeof value === 'boolean') {
    return { type: 'boolean', display: value ? 'Yes' : 'No' };
  }

  if (typeof value === 'number') {
    return { type: 'text', display: String(value) };
  }

  if (typeof value === 'string') {
    // Check if it's a path
    const pathNames = ['path', 'filepath', 'source', 'destination', 'directory', 'folder', 'file'];
    if (pathNames.some(p => name.toLowerCase().includes(p)) || value.startsWith('/') || value.startsWith('~')) {
      return { type: 'path', display: value };
    }

    // Check if it's code or multi-line content
    const codeNames = ['code', 'content', 'body', 'script', 'command', 'query'];
    if (codeNames.some(p => name.toLowerCase().includes(p)) || value.includes('\n') || looksLikeCode(value)) {
      const language = detectLanguage(value, name);
      return { type: 'code', display: value, language };
    }

    // Regular string
    return { type: 'text', display: value };
  }

  // Objects and arrays - show as formatted JSON
  if (typeof value === 'object' && value !== null) {
    return { type: 'json', display: JSON.stringify(value, null, 2) };
  }

  return { type: 'text', display: String(value) };
}

export class ToolConfirmationModal extends Modal {
  private toolCall: ToolCall;
  private toolDescription: string;
  private resolve: (result: ToolConfirmationResult) => void;
  private feedbackText: string = '';

  constructor(
    app: App,
    toolCall: ToolCall,
    toolDescription: string,
    resolve: (result: ToolConfirmationResult) => void
  ) {
    super(app);
    this.toolCall = toolCall;
    this.toolDescription = toolDescription;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;

    // Add modal class for styling
    this.modalEl.addClass('tool-confirmation-modal');

    // Title
    contentEl.createEl('h2', {
      text: '🔒 Tool confirmation required',
      cls: 'tool-confirmation-title'
    });

    // Tool name with icon based on tool type
    const toolIcon = this.getToolIcon(this.toolCall.name);
    contentEl.createEl('h3', {
      text: `${toolIcon} ${this.formatToolName(this.toolCall.name)}`,
      cls: 'tool-confirmation-name'
    });

    // Description
    contentEl.createEl('p', {
      text: this.toolDescription,
      cls: 'tool-confirmation-description'
    });

    // Arguments section - smart formatting
    this.renderArguments(contentEl);

    // Warning
    const warningEl = contentEl.createEl('div', {
      cls: 'tool-confirmation-warning'
    });
    warningEl.createEl('span', {
      text: '⚠️ This action will modify your system. Please review carefully before approving.'
    });

    // Feedback input
    new Setting(contentEl)
      .setName('Feedback (optional)')
      .setDesc('Provide feedback to the AI if you reject this action')
      .addTextArea(text => {
        text
          .setPlaceholder('e.g., "Use a different folder" or "Include a header in the content"')
          .onChange(value => {
            this.feedbackText = value;
          });
        text.inputEl.rows = 3;
        text.inputEl.addClass('tool-confirmation-feedback');
      });

    // Buttons container
    const buttonsContainer = contentEl.createEl('div', {
      cls: 'tool-confirmation-buttons'
    });

    // Approve button
    const approveBtn = buttonsContainer.createEl('button', {
      text: '✓ Approve',
      cls: 'mod-cta tool-confirmation-approve'
    });
    approveBtn.addEventListener('click', () => {
      this.resolve({ approved: true });
      this.close();
    });

    // Reject button
    const rejectBtn = buttonsContainer.createEl('button', {
      text: '✗ Reject',
      cls: 'tool-confirmation-reject'
    });
    rejectBtn.addEventListener('click', () => {
      this.resolve({
        approved: false,
        feedback: this.feedbackText || undefined
      });
      this.close();
    });
  }

  /**
   * Render arguments with smart formatting
   */
  private renderArguments(container: HTMLElement): void {
    const args = this.toolCall.arguments;

    if (!args || Object.keys(args).length === 0) {
      container.createEl('p', { text: 'No arguments', cls: 'tool-confirmation-no-args' });
      return;
    }

    const argsContainer = container.createEl('div', { cls: 'tool-confirmation-args' });

    for (const [name, value] of Object.entries(args)) {
      const formatted = formatParamValue(name, value);

      const argEl = argsContainer.createEl('div', { cls: 'tool-arg' });

      // Argument name/label
      const labelEl = argEl.createEl('div', { cls: 'tool-arg-label' });
      labelEl.createEl('span', {
        text: this.formatParamName(name),
        cls: 'tool-arg-name'
      });

      // Value based on type
      switch (formatted.type) {
        case 'code':
          this.renderCodeBlock(argEl, formatted.display, formatted.language);
          break;

        case 'path': {
          const pathEl = argEl.createEl('div', { cls: 'tool-arg-path' });
          pathEl.createEl('code', { text: formatted.display });
          break;
        }

        case 'boolean': {
          const boolEl = argEl.createEl('div', { cls: 'tool-arg-boolean' });
          boolEl.createEl('span', {
            text: formatted.display,
            cls: formatted.display === 'Yes' ? 'bool-yes' : 'bool-no'
          });
          break;
        }

        case 'json':
          this.renderCodeBlock(argEl, formatted.display, 'json');
          break;

        case 'text':
        default: {
          const textEl = argEl.createEl('div', { cls: 'tool-arg-text' });
          textEl.createEl('span', { text: formatted.display });
          break;
        }
      }
    }
  }

  /**
   * Render a code block with optional language hint
   */
  private renderCodeBlock(container: HTMLElement, code: string, language?: string): void {
    const codeContainer = container.createEl('div', { cls: 'tool-arg-code' });

    // Language badge if known
    if (language && language !== 'text') {
      codeContainer.createEl('span', {
        text: language,
        cls: 'code-language-badge'
      });
    }

    const pre = codeContainer.createEl('pre');
    const codeEl = pre.createEl('code');

    // Actually display the code with proper newlines (not escaped)
    codeEl.textContent = code;

    // Add line numbers for multi-line code
    const lines = code.split('\n');
    if (lines.length > 1) {
      codeContainer.addClass('multiline');
    }
  }

  /**
   * Format a parameter name for display (snake_case -> Title Case)
   */
  private formatParamName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Format tool name for display
   */
  private formatToolName(name: string): string {
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Get an icon for the tool type
   */
  private getToolIcon(toolName: string): string {
    const icons: Record<string, string> = {
      'save_file': '💾',
      'create_file': '📝',
      'write_file': '✏️',
      'copy_file': '📋',
      'run_command': '⚡',
      'execute_python': '🐍',
      'persistent_shell': '💻',
      'send_email': '📧',
      'reply_to_email': '↩️',
      'send_discord_dm': '💬',
      'create_note': '📄',
      'append_to_file': '➕',
      'create_directory': '📁',
      'download_email_attachments': '📎',
    };
    return icons[toolName] || '🔧';
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Show a confirmation modal and wait for user response
 */
export function showToolConfirmation(
  app: App,
  toolCall: ToolCall,
  toolDescription: string
): Promise<ToolConfirmationResult> {
  return new Promise((resolve) => {
    const modal = new ToolConfirmationModal(app, toolCall, toolDescription, resolve);
    modal.open();
  });
}






