/**
 * Tool Manager - Handles tool registration and execution
 * Supports both built-in toolsets and MCP (remote) toolsets
 */

import { App } from 'obsidian';
import { Toolset, RegisteredTool, ToolDefinition, ToolCall, ToolResult } from './types';
import { createObsidianToolset } from './obsidianTools';
import { MCPManager, MCPServerConfig } from './mcpClient';

export class ToolManager {
  private app: App;
  private toolsets: Map<string, Toolset> = new Map();
  private allTools: Map<string, RegisteredTool> = new Map();
  private mcpManager: MCPManager;

  constructor(app: App) {
    this.app = app;
    this.mcpManager = new MCPManager();
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
   * Unregister a toolset and its tools
   */
  unregisterToolset(name: string): void {
    const toolset = this.toolsets.get(name);
    if (toolset) {
      // Remove tools from flat map
      for (const tool of toolset.tools) {
        this.allTools.delete(tool.definition.name);
      }
      this.toolsets.delete(name);
    }
  }

  /**
   * Initialize MCP servers from config
   */
  async initializeMCPServers(configs: MCPServerConfig[]): Promise<void> {
    // Clear existing MCP toolsets
    for (const name of this.getAvailableToolsetNames()) {
      if (name.startsWith('mcp:')) {
        this.unregisterToolset(name);
      }
    }

    // Add each server
    for (const config of configs) {
      if (config.enabled) {
        try {
          await this.mcpManager.addServer(config);
          const toolset = this.mcpManager.getToolset(config.name);
          if (toolset) {
            this.registerToolset(toolset);
            console.log(`MCP server ${config.name} registered with ${toolset.tools.length} tools`);
          }
        } catch (error) {
          console.error(`Failed to initialize MCP server ${config.name}:`, error);
        }
      }
    }
  }

  /**
   * Refresh MCP connections (call after settings change)
   */
  async refreshMCPServers(): Promise<void> {
    await this.mcpManager.refreshAll();
    
    // Re-register MCP toolsets
    for (const toolset of this.mcpManager.getAllToolsets()) {
      this.registerToolset(toolset);
    }
  }

  /**
   * Get MCP Manager for direct access
   */
  getMCPManager(): MCPManager {
    return this.mcpManager;
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

  /**
   * Get list of MCP toolset names only
   */
  getMCPToolsetNames(): string[] {
    return this.getAvailableToolsetNames().filter(name => name.startsWith('mcp:'));
  }

  /**
   * Get list of built-in (non-MCP) toolset names
   */
  getBuiltInToolsetNames(): string[] {
    return this.getAvailableToolsetNames().filter(name => !name.startsWith('mcp:'));
  }
}








