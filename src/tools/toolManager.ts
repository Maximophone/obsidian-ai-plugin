/**
 * Tool Manager - Handles tool registration and execution
 */

import { App } from 'obsidian';
import { Toolset, RegisteredTool, ToolDefinition, ToolCall, ToolResult } from './types';
import { createObsidianToolset } from './obsidianTools';

export class ToolManager {
  private app: App;
  private toolsets: Map<string, Toolset> = new Map();
  private allTools: Map<string, RegisteredTool> = new Map();

  constructor(app: App) {
    this.app = app;
    this.registerBuiltInToolsets();
  }

  /**
   * Register built-in toolsets
   */
  private registerBuiltInToolsets(): void {
    // Register Obsidian toolset
    const obsidianToolset = createObsidianToolset(this.app);
    this.registerToolset(obsidianToolset);
  }

  /**
   * Register a toolset
   */
  registerToolset(toolset: Toolset): void {
    this.toolsets.set(toolset.name, toolset);
    
    // Add all tools to the flat map for quick lookup
    for (const tool of toolset.tools) {
      this.allTools.set(tool.definition.name, tool);
    }
  }

  /**
   * Get a toolset by name
   */
  getToolset(name: string): Toolset | undefined {
    return this.toolsets.get(name);
  }

  /**
   * Get all tools from specified toolsets
   */
  getToolsFromToolsets(toolsetNames: string[]): RegisteredTool[] {
    const tools: RegisteredTool[] = [];
    
    for (const name of toolsetNames) {
      const toolset = this.toolsets.get(name);
      if (toolset) {
        tools.push(...toolset.tools);
      }
    }
    
    return tools;
  }

  /**
   * Get tool definitions for AI API (just the definitions, not executors)
   */
  getToolDefinitions(toolsetNames: string[]): ToolDefinition[] {
    return this.getToolsFromToolsets(toolsetNames).map(t => t.definition);
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.allTools.get(name);
  }

  /**
   * Execute a tool call
   * Returns the result or throws if tool not found
   */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.allTools.get(toolCall.name);
    
    if (!tool) {
      return {
        name: toolCall.name,
        toolCallId: toolCall.id,
        error: `Tool not found: ${toolCall.name}`,
      };
    }

    try {
      const result = await tool.execute(toolCall.arguments);
      return {
        name: toolCall.name,
        toolCallId: toolCall.id,
        result,
      };
    } catch (error) {
      return {
        name: toolCall.name,
        toolCallId: toolCall.id,
        error: `Tool execution error: ${error.message}`,
      };
    }
  }

  /**
   * Check if a tool requires confirmation (safe=false)
   */
  toolRequiresConfirmation(toolName: string): boolean {
    const tool = this.allTools.get(toolName);
    return tool ? !tool.definition.safe : false;
  }

  /**
   * Get list of available toolset names
   */
  getAvailableToolsetNames(): string[] {
    return Array.from(this.toolsets.keys());
  }
}

