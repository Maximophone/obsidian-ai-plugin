import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, MarkdownView, Editor, Platform, FuzzySuggestModal, SuggestModal } from 'obsidian';
import { ObsidianAISettings, DEFAULT_SETTINGS, resolveModel, getAllModels, ModelConfig, AIProvider, DEFAULT_MODELS } from './types';
import { processTags, hasTag } from './parser/tagParser';
import { AIService } from './ai/aiService';
import { BlockProcessor } from './processor/blockProcessor';
import { ToolManager } from './tools';

export default class ObsidianAIPlugin extends Plugin {
  settings: ObsidianAISettings;
  aiService: AIService;
  blockProcessor: BlockProcessor;
  toolManager: ToolManager;
  
  async onload() {
    console.log('Loading Obsidian AI plugin');
    
    await this.loadSettings();
    
    // Initialize services
    this.aiService = new AIService(this);
    this.blockProcessor = new BlockProcessor(this);
    this.toolManager = new ToolManager(this.app);
    
    // Add settings tab
    this.addSettingTab(new ObsidianAISettingsTab(this.app, this));
    
    // Register command to process current file
    this.addCommand({
      id: 'process-ai-blocks',
      name: 'Process AI blocks in current file',
      editorCallback: async (editor, view) => {
        if (view.file) {
          await this.processFile(view.file);
        }
      },
    });
    
    // Register command to process AI block at cursor
    this.addCommand({
      id: 'process-ai-block-at-cursor',
      name: 'Process AI block at cursor',
      editorCallback: async (editor, view) => {
        if (view.file) {
          const cursor = editor.getCursor();
          const content = editor.getValue();
          await this.processBlockAtPosition(view.file, content, cursor.line);
        }
      },
    });
    
    // ========== Beacon insertion commands ==========
    
    // Insert AI block (without reply - user adds it when ready)
    this.addCommand({
      id: 'insert-ai-block',
      name: 'Insert AI block',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<ai!>\n\n</ai!>', 6);
      },
    });
    
    // Insert reply beacon
    this.addCommand({
      id: 'insert-reply',
      name: 'Insert reply beacon',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<reply!>');
      },
    });
    
    // Insert model with selector
    this.addCommand({
      id: 'insert-model',
      name: 'Insert model tag',
      editorCallback: (editor) => {
        const models = getAllModels(this.settings);
        new ModelSuggestModal(this.app, models, (model) => {
          this.insertAtCursor(editor, `<model!${model.alias}>`);
        }).open();
      },
    });
    
    // Insert system tag (manual - for inline system prompts)
    this.addCommand({
      id: 'insert-system',
      name: 'Insert system prompt tag (manual)',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<system!>', 8);
      },
    });
    
    // Insert prompt tag with selector (loads from prompts folder)
    this.addCommand({
      id: 'insert-prompt',
      name: 'Insert prompt tag',
      editorCallback: (editor) => {
        const promptsFolder = this.settings.promptsFolder;
        new PromptSuggestModal(this.app, promptsFolder, (file) => {
          this.insertAtCursor(editor, `<prompt!"${file.basename}">`);
        }).open();
      },
    });
    
    // Insert this tag
    this.addCommand({
      id: 'insert-this',
      name: 'Insert this document tag',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<this!>');
      },
    });
    
    // Insert doc with note selector
    this.addCommand({
      id: 'insert-doc',
      name: 'Insert document reference tag',
      editorCallback: (editor) => {
        new NoteSuggestModal(this.app, (file) => {
          // Use wiki-link style for vault notes, wrapped in quotes
          this.insertAtCursor(editor, `<doc!"[[${file.basename}]]">`);
        }).open();
      },
    });
    
    // Insert url tag
    this.addCommand({
      id: 'insert-url',
      name: 'Insert URL tag',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<url!"...">', 6);
      },
    });
    
    // Insert think tag
    this.addCommand({
      id: 'insert-think',
      name: 'Insert thinking tag',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<think!>');
      },
    });
    
    // Insert debug tag
    this.addCommand({
      id: 'insert-debug',
      name: 'Insert debug tag',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<debug!>');
      },
    });
    
    // Insert mock tag
    this.addCommand({
      id: 'insert-mock',
      name: 'Insert mock tag',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<mock!>');
      },
    });
    
    // Insert help tag
    this.addCommand({
      id: 'insert-help',
      name: 'Insert help tag',
      editorCallback: (editor) => {
        this.insertAtCursor(editor, '<help!>');
      },
    });
    
    // ========== File picker commands (Desktop only) ==========
    
    // Insert file with picker
    this.addCommand({
      id: 'insert-file',
      name: 'Insert file tag',
      editorCallback: async (editor) => {
        await this.insertFileWithPicker(editor, 'file');
      },
    });
    
    // Insert image with picker
    this.addCommand({
      id: 'insert-image',
      name: 'Insert image tag',
      editorCallback: async (editor) => {
        await this.insertFileWithPicker(editor, 'image');
      },
    });
    
    // Insert PDF with picker
    this.addCommand({
      id: 'insert-pdf',
      name: 'Insert PDF tag',
      editorCallback: async (editor) => {
        await this.insertFileWithPicker(editor, 'pdf');
      },
    });
    
    // Auto-process on file save if enabled
    if (this.settings.autoProcess) {
      this.registerEvent(
        this.app.vault.on('modify', async (file) => {
          if (file instanceof TFile && file.extension === 'md') {
            await this.checkAndProcessFile(file);
          }
        })
      );
    }
    
    // Add ribbon icon
    this.addRibbonIcon('sparkles', 'Process AI blocks', async () => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView?.file) {
        await this.processFile(activeView.file);
      } else {
        new Notice('No active markdown file');
      }
    });
  }
  
  async onunload() {
    console.log('Unloading Obsidian AI plugin');
  }
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  
  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  /**
   * Check if file needs processing and process if needed
   */
  async checkAndProcessFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    
    // Check if file has any AI blocks with reply tags
    if (this.needsAnswer(content)) {
      await this.processFile(file);
    }
  }
  
  /**
   * Check if content needs processing
   */
  needsAnswer(content: string): boolean {
    const [, tags] = processTags(content);
    
    // Tags that trigger processing when found at top level
    const triggerTags = new Set(['help']);
    
    for (const tag of tags) {
      // Check for standalone trigger tags (like <help!>)
      if (triggerTags.has(tag.name)) {
        return true;
      }
      
      // Check for AI blocks that contain reply tags
      if (tag.name === 'ai' && tag.text) {
        if (hasTag(tag.text, 'reply')) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Insert text at cursor position
   * @param editor The editor instance
   * @param text The text to insert
   * @param cursorOffset Optional offset from start of inserted text to place cursor
   */
  private insertAtCursor(editor: Editor, text: string, cursorOffset?: number): void {
    const cursor = editor.getCursor();
    editor.replaceRange(text, cursor);
    
    if (cursorOffset !== undefined) {
      // Calculate new cursor position
      const newPos = {
        line: cursor.line,
        ch: cursor.ch + cursorOffset
      };
      editor.setCursor(newPos);
    }
  }
  
  /**
   * Open file picker and insert file/image/pdf tag
   */
  private async insertFileWithPicker(editor: Editor, type: 'file' | 'image' | 'pdf'): Promise<void> {
    if (!Platform.isDesktop) {
      new Notice('File picker is only available on desktop');
      return;
    }
    
    try {
      // Use Electron's dialog
      const electron = require('electron');
      const dialog = electron.remote?.dialog || electron.dialog;
      
      if (!dialog) {
        new Notice('File picker not available');
        return;
      }
      
      // Configure file filters based on type
      let filters: { name: string; extensions: string[] }[] = [];
      let title = 'Select file';
      
      switch (type) {
        case 'image':
          title = 'Select image';
          filters = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }];
          break;
        case 'pdf':
          title = 'Select PDF';
          filters = [{ name: 'PDF', extensions: ['pdf'] }];
          break;
        case 'file':
        default:
          title = 'Select file';
          filters = [{ name: 'All Files', extensions: ['*'] }];
          break;
      }
      
      const result = await dialog.showOpenDialog({
        title,
        filters,
        properties: ['openFile']
      });
      
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return; // User cancelled
      }
      
      const filePath = result.filePaths[0];
      const tag = `<${type}!"${filePath}">`;
      
      this.insertAtCursor(editor, tag);
      
    } catch (e) {
      console.error('Error opening file picker:', e);
      new Notice(`Error opening file picker: ${e.message}`);
    }
  }
  
  /**
   * Process all AI blocks in a file
   */
  async processFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      const newContent = await this.blockProcessor.processContent(content, file.path);
      
      if (newContent !== content) {
        await this.app.vault.modify(file, newContent);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      new Notice(`Error processing file: ${error.message}`);
    }
  }
  
  /**
   * Process AI block at a specific line position
   */
  async processBlockAtPosition(file: TFile, content: string, line: number): Promise<void> {
    // Find the AI block that contains this line
    const lines = content.split('\n');
    let blockStart = -1;
    let blockEnd = -1;
    let depth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<ai!')) {
        if (depth === 0) {
          blockStart = i;
        }
        depth++;
      }
      if (lines[i].includes('</ai!>')) {
        depth--;
        if (depth === 0) {
          blockEnd = i;
          if (line >= blockStart && line <= blockEnd) {
            // Found the block containing the cursor
            break;
          }
          blockStart = -1;
          blockEnd = -1;
        }
      }
    }
    
    if (blockStart === -1 || blockEnd === -1) {
      new Notice('No AI block found at cursor position');
      return;
    }
    
    // Process the file normally - the block processor will handle it
    await this.processFile(file);
  }
  
  /**
   * Resolve model identifier (handle aliases) - returns the model ID to use with API
   */
  resolveModelId(modelAlias: string): string {
    const config = resolveModel(modelAlias, this.settings);
    if (config) {
      return config.modelId;
    }
    // Fall back to default model
    const defaultConfig = resolveModel(this.settings.defaultModel, this.settings);
    return defaultConfig?.modelId || 'claude-sonnet-4-20250514';
  }
}

/**
 * Model selector modal
 */
class ModelSuggestModal extends FuzzySuggestModal<ModelConfig> {
  private models: ModelConfig[];
  private onSelect: (model: ModelConfig) => void;
  
  constructor(app: App, models: ModelConfig[], onSelect: (model: ModelConfig) => void) {
    super(app);
    this.models = models;
    this.onSelect = onSelect;
    this.setPlaceholder('Select a model...');
  }
  
  getItems(): ModelConfig[] {
    return this.models;
  }
  
  getItemText(model: ModelConfig): string {
    return `${model.alias} - ${model.displayName} (${model.provider})`;
  }
  
  onChooseItem(model: ModelConfig): void {
    this.onSelect(model);
  }
}

/**
 * Note selector modal with fuzzy search
 */
class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onSelect: (file: TFile) => void;
  
  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.files = app.vault.getMarkdownFiles();
    this.onSelect = onSelect;
    this.setPlaceholder('Search for a note...');
  }
  
  getItems(): TFile[] {
    return this.files;
  }
  
  getItemText(file: TFile): string {
    return file.path;
  }
  
  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}

/**
 * Prompt selector modal - shows prompts from the configured prompts folder
 */
class PromptSuggestModal extends FuzzySuggestModal<TFile> {
  private prompts: TFile[];
  private onSelect: (file: TFile) => void;
  
  constructor(app: App, promptsFolder: string, onSelect: (file: TFile) => void) {
    super(app);
    // Get only markdown files from the prompts folder
    this.prompts = app.vault.getMarkdownFiles().filter(file => 
      file.path.startsWith(promptsFolder + '/') || file.path.startsWith(promptsFolder + '\\')
    );
    this.onSelect = onSelect;
    this.setPlaceholder('Search for a prompt...');
  }
  
  getItems(): TFile[] {
    return this.prompts;
  }
  
  getItemText(file: TFile): string {
    // Show just the filename without extension for cleaner display
    return file.basename;
  }
  
  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}

/**
 * Settings tab for the plugin
 */
class ObsidianAISettingsTab extends PluginSettingTab {
  plugin: ObsidianAIPlugin;
  
  constructor(app: App, plugin: ObsidianAIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    containerEl.createEl('h1', { text: 'Obsidian AI Settings' });
    
    // API Keys section
    containerEl.createEl('h2', { text: 'API Keys' });
    
    new Setting(containerEl)
      .setName('Anthropic API Key')
      .setDesc('Your Claude API key from console.anthropic.com')
      .addText(text => text
        .setPlaceholder('sk-ant-...')
        .setValue(this.plugin.settings.anthropicApiKey)
        .onChange(async (value) => {
          this.plugin.settings.anthropicApiKey = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Your OpenAI API key from platform.openai.com')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.openaiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.openaiApiKey = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('Google AI API Key')
      .setDesc('Your Google AI API key from aistudio.google.com')
      .addText(text => text
        .setPlaceholder('...')
        .setValue(this.plugin.settings.googleApiKey)
        .onChange(async (value) => {
          this.plugin.settings.googleApiKey = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('DeepSeek API Key')
      .setDesc('Your DeepSeek API key from platform.deepseek.com')
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.deepseekApiKey)
        .onChange(async (value) => {
          this.plugin.settings.deepseekApiKey = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('Perplexity API Key')
      .setDesc('Your Perplexity API key from perplexity.ai')
      .addText(text => text
        .setPlaceholder('pplx-...')
        .setValue(this.plugin.settings.perplexityApiKey)
        .onChange(async (value) => {
          this.plugin.settings.perplexityApiKey = value;
          await this.plugin.saveSettings();
        })
      );
    
    // Defaults section
    containerEl.createEl('h2', { text: 'Defaults' });
    
    new Setting(containerEl)
      .setName('Default Model')
      .setDesc('Model alias to use by default (e.g., sonnet, gpt4, gemini)')
      .addText(text => text
        .setPlaceholder('sonnet')
        .setValue(this.plugin.settings.defaultModel)
        .onChange(async (value) => {
          this.plugin.settings.defaultModel = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('Default Temperature')
      .setDesc('Response randomness (0 = deterministic, 1 = creative)')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.1)
        .setValue(this.plugin.settings.defaultTemperature)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultTemperature = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('Default Max Tokens')
      .setDesc('Maximum response length')
      .addText(text => text
        .setValue(String(this.plugin.settings.defaultMaxTokens))
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.defaultMaxTokens = num;
            await this.plugin.saveSettings();
          }
        })
      );
    
    // Behavior section
    containerEl.createEl('h2', { text: 'Behavior' });
    
    new Setting(containerEl)
      .setName('Auto-process on save')
      .setDesc('Automatically process AI blocks when you save a file')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoProcess)
        .onChange(async (value) => {
          this.plugin.settings.autoProcess = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('Show token count')
      .setDesc('Display input/output token counts in responses')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showTokenCount)
        .onChange(async (value) => {
          this.plugin.settings.showTokenCount = value;
          await this.plugin.saveSettings();
        })
      );
    
    new Setting(containerEl)
      .setName('Play notification sound')
      .setDesc('Play a sound when AI processing completes')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.playNotificationSound)
        .onChange(async (value) => {
          this.plugin.settings.playNotificationSound = value;
          await this.plugin.saveSettings();
        })
      );
    
    // Folders section
    containerEl.createEl('h2', { text: 'Folders' });
    
    new Setting(containerEl)
      .setName('Prompts folder')
      .setDesc('Folder containing system prompt files')
      .addText(text => text
        .setValue(this.plugin.settings.promptsFolder)
        .onChange(async (value) => {
          this.plugin.settings.promptsFolder = value;
          await this.plugin.saveSettings();
        })
      );
    
    // Models section
    containerEl.createEl('h2', { text: 'Available Models' });
    
    containerEl.createEl('p', { 
      text: 'Built-in model aliases. Use these in <model!alias> tags.',
      cls: 'setting-item-description'
    });
    
    // Show default models as a reference table
    const defaultModelsEl = containerEl.createEl('details');
    defaultModelsEl.createEl('summary', { text: 'Show built-in models' });
    const table = defaultModelsEl.createEl('table', { cls: 'obsidian-ai-models-table' });
    const headerRow = table.createEl('tr');
    headerRow.createEl('th', { text: 'Alias' });
    headerRow.createEl('th', { text: 'Provider' });
    headerRow.createEl('th', { text: 'Model ID' });
    
    for (const model of DEFAULT_MODELS) {
      const row = table.createEl('tr');
      row.createEl('td', { text: model.alias });
      row.createEl('td', { text: model.provider });
      row.createEl('td', { text: model.modelId });
    }
    
    // Custom models section
    containerEl.createEl('h3', { text: 'Custom Models' });
    containerEl.createEl('p', { 
      text: 'Add your own model aliases. These override built-in models with the same alias.',
      cls: 'setting-item-description'
    });
    
    // Add new model button
    new Setting(containerEl)
      .setName('Add Custom Model')
      .setDesc('Define a new model alias')
      .addButton(button => button
        .setButtonText('+ Add Model')
        .onClick(async () => {
          this.plugin.settings.customModels.push({
            alias: 'new-model',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            displayName: 'New Model',
          });
          await this.plugin.saveSettings();
          this.display(); // Refresh
        })
      );
    
    // List existing custom models
    for (let i = 0; i < this.plugin.settings.customModels.length; i++) {
      const model = this.plugin.settings.customModels[i];
      
      const setting = new Setting(containerEl)
        .setClass('obsidian-ai-custom-model');
      
      setting.addText(text => text
        .setPlaceholder('alias')
        .setValue(model.alias)
        .onChange(async (value) => {
          this.plugin.settings.customModels[i].alias = value;
          await this.plugin.saveSettings();
        })
      );
      
      setting.addDropdown(dropdown => dropdown
        .addOption('anthropic', 'Anthropic')
        .addOption('openai', 'OpenAI')
        .addOption('google', 'Google')
        .addOption('deepseek', 'DeepSeek')
        .addOption('perplexity', 'Perplexity')
        .setValue(model.provider)
        .onChange(async (value: AIProvider) => {
          this.plugin.settings.customModels[i].provider = value;
          await this.plugin.saveSettings();
        })
      );
      
      setting.addText(text => text
        .setPlaceholder('model-id')
        .setValue(model.modelId)
        .onChange(async (value) => {
          this.plugin.settings.customModels[i].modelId = value;
          await this.plugin.saveSettings();
        })
      );
      
      setting.addButton(button => button
        .setButtonText('Delete')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.customModels.splice(i, 1);
          await this.plugin.saveSettings();
          this.display(); // Refresh
        })
      );
    }
  }
}

