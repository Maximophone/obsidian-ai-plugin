/**
 * Tool Confirmation Modal
 * Shows a confirmation dialog for unsafe (write) tool operations
 */

import { App, Modal, Setting } from 'obsidian';
import { ToolCall } from '../tools/types';

export interface ToolConfirmationResult {
  approved: boolean;
  feedback?: string; // Optional feedback message to send back to the AI
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
    
    // Title
    contentEl.createEl('h2', { 
      text: '🔒 Tool Confirmation Required',
      cls: 'tool-confirmation-title'
    });

    // Tool name
    contentEl.createEl('h3', { 
      text: `Tool: ${this.toolCall.name}`,
      cls: 'tool-confirmation-name'
    });

    // Description
    contentEl.createEl('p', { 
      text: this.toolDescription,
      cls: 'tool-confirmation-description'
    });

    // Arguments section
    contentEl.createEl('h4', { text: 'Arguments:' });
    
    const argsContainer = contentEl.createEl('div', {
      cls: 'tool-confirmation-args'
    });
    
    const argsCode = argsContainer.createEl('pre');
    argsCode.createEl('code', {
      text: JSON.stringify(this.toolCall.arguments, null, 2)
    });

    // Warning
    const warningEl = contentEl.createEl('div', {
      cls: 'tool-confirmation-warning'
    });
    warningEl.createEl('span', {
      text: '⚠️ This action will modify your vault. Please review carefully before approving.'
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
        text.inputEl.style.width = '100%';
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

