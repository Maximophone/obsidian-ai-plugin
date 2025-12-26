/**
 * MCP Client - Connects to MCP servers and executes tools
 * 
 * Supports two transport types:
 * - 'standard': JSON-RPC 2.0 over HTTP (MCP specification compliant)
 * - 'legacy': Custom REST API (for backward compatibility with custom servers)
 */

import { ToolDefinition, ToolParameter, RegisteredTool, Toolset } from './types';
import { MCPServerConfig } from '../types';
import { requestUrl, RequestUrlResponse } from 'obsidian';
import { StandardMCPClient, MCPStandardTool } from './standardMcpClient';

// Re-export for convenience
export type { MCPServerConfig };

// Legacy MCP tool definition (from custom REST API)
interface LegacyMCPToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
    default?: unknown;
  }>;
  safe: boolean;
}

interface LegacyMCPToolsResponse {
  tools: LegacyMCPToolDefinition[];
}

interface LegacyMCPExecuteResponse {
  result?: string;
  error?: string;
}

/**
 * Common interface for MCP clients
 */
export interface IMCPClient {
  fetchTools(): Promise<ToolDefinition[]>;
  executeTool(name: string, args: Record<string, unknown>): Promise<string>;
  getConfig(): MCPServerConfig;
  isHealthy(): Promise<boolean>;
}

/**
 * Legacy MCP Client - handles communication using custom REST API
 * Used for backward compatibility with existing custom MCP servers
 */
export class LegacyMCPClient implements IMCPClient {
  private config: MCPServerConfig;
  private cachedTools: LegacyMCPToolDefinition[] | null = null;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /**
   * Get the base URL without trailing slash
   */
  private get baseUrl(): string {
    return this.config.url.replace(/\/$/, '');
  }

  /**
   * Make an authenticated request to the MCP server
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<RequestUrlResponse> {
    const url = `${this.baseUrl}${path}`;

    const options: Parameters<typeof requestUrl>[0] = {
      url,
      method,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    return requestUrl(options);
  }

  /**
   * Check if the server is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Fetch available tools from the server
   */
  async fetchTools(): Promise<ToolDefinition[]> {
    try {
      const response = await this.request('GET', '/tools');

      if (response.status !== 200) {
        console.error(`Legacy MCP server ${this.config.name} returned status ${response.status}`);
        return [];
      }

      const data = response.json as LegacyMCPToolsResponse;
      this.cachedTools = data.tools || [];

      // Convert to ToolDefinition format
      return this.cachedTools.map(tool => this.convertToolDefinition(tool));
    } catch (error) {
      console.error(`Failed to fetch tools from legacy MCP server ${this.config.name}:`, error);
      return [];
    }
  }

  /**
   * Convert legacy tool definition to internal format
   */
  private convertToolDefinition(mcpTool: LegacyMCPToolDefinition): ToolDefinition {
    const parameters: Record<string, ToolParameter> = {};

    for (const [paramName, paramDef] of Object.entries(mcpTool.parameters)) {
      parameters[paramName] = {
        type: paramDef.type as ToolParameter['type'],
        description: paramDef.description,
        required: paramDef.required,
        enum: paramDef.enum,
        default: paramDef.default,
      };
    }

    return {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters,
      safe: mcpTool.safe,
    };
  }

  /**
   * Execute a tool on the server
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      const response = await this.request('POST', '/execute', {
        name,
        arguments: args,
      });

      const data = response.json as LegacyMCPExecuteResponse;

      if (data.error) {
        return `Error: ${data.error}`;
      }

      return data.result || 'Tool executed successfully (no output)';
    } catch (error) {
      return `Legacy MCP Error: ${error.message}`;
    }
  }

  /**
   * Get the server config
   */
  getConfig(): MCPServerConfig {
    return this.config;
  }
}

/**
 * Adapter to wrap StandardMCPClient with IMCPClient interface
 */
class StandardMCPClientAdapter implements IMCPClient {
  private client: StandardMCPClient;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.client = new StandardMCPClient({
      name: config.name,
      url: config.url,
      enabled: config.enabled,
    });
  }

  async fetchTools(): Promise<ToolDefinition[]> {
    const tools = await this.client.fetchTools();
    return tools.map(tool => this.convertToolDefinition(tool));
  }

  /**
   * Convert standard MCP tool definition to internal format
   */
  private convertToolDefinition(mcpTool: MCPStandardTool): ToolDefinition {
    const parameters: Record<string, ToolParameter> = {};

    if (mcpTool.inputSchema.properties) {
      for (const [paramName, paramDef] of Object.entries(mcpTool.inputSchema.properties)) {
        parameters[paramName] = {
          type: paramDef.type as ToolParameter['type'],
          description: paramDef.description || '',
          required: mcpTool.inputSchema.required?.includes(paramName),
          enum: paramDef.enum,
        };
      }
    }

    return {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters,
      safe: true, // Standard MCP doesn't have a safe flag, default to safe
    };
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    return this.client.executeTool(name, args);
  }

  getConfig(): MCPServerConfig {
    return this.config;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }
}

/**
 * Factory function to create the appropriate MCP client based on transport type
 */
export function createMCPClient(config: MCPServerConfig): IMCPClient {
  // Default to legacy for backward compatibility if transport is not specified
  const transport = config.transport || 'legacy';

  if (transport === 'standard') {
    console.debug(`Creating standard MCP client for ${config.name}`);
    return new StandardMCPClientAdapter(config);
  } else {
    console.debug(`Creating legacy MCP client for ${config.name}`);
    return new LegacyMCPClient(config);
  }
}

/**
 * Create a toolset from an MCP client
 */
export async function createMCPToolset(client: IMCPClient): Promise<Toolset | null> {
  const config = client.getConfig();

  if (!config.enabled) {
    return null;
  }

  // Fetch tools from server
  const tools = await client.fetchTools();

  if (tools.length === 0) {
    console.warn(`MCP server ${config.name} has no tools`);
    return null;
  }

  // Convert to registered tools
  const registeredTools: RegisteredTool[] = tools.map(toolDef => ({
    definition: toolDef,
    execute: async (args: Record<string, unknown>) => {
      return client.executeTool(toolDef.name, args);
    },
  }));

  return {
    name: `mcp:${config.name}`,
    description: `Tools from MCP server: ${config.name}`,
    tools: registeredTools,
  };
}

/**
 * MCP Manager - manages multiple MCP server connections
 */
export class MCPManager {
  private clients: Map<string, IMCPClient> = new Map();
  private toolsets: Map<string, Toolset> = new Map();

  /**
   * Add or update a server configuration
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    const client = createMCPClient(config);
    this.clients.set(config.name, client);

    if (config.enabled) {
      try {
        const toolset = await createMCPToolset(client);
        if (toolset) {
          this.toolsets.set(config.name, toolset);
          console.debug(`MCP server ${config.name} registered with ${toolset.tools.length} tools`);
        }
      } catch (error) {
        console.error(`Failed to create toolset for MCP server ${config.name}:`, error);
      }
    }
  }

  /**
   * Remove a server
   */
  removeServer(name: string): void {
    this.clients.delete(name);
    this.toolsets.delete(name);
  }

  /**
   * Refresh all server connections and tool definitions
   */
  async refreshAll(): Promise<void> {
    this.toolsets.clear();

    for (const [name, client] of this.clients) {
      const config = client.getConfig();
      if (config.enabled) {
        try {
          const toolset = await createMCPToolset(client);
          if (toolset) {
            this.toolsets.set(name, toolset);
          }
        } catch (error) {
          console.error(`Failed to refresh MCP server ${name}:`, error);
        }
      }
    }
  }

  /**
   * Get a toolset by server name
   */
  getToolset(serverName: string): Toolset | undefined {
    return this.toolsets.get(serverName);
  }

  /**
   * Get all MCP toolsets
   */
  getAllToolsets(): Toolset[] {
    return Array.from(this.toolsets.values());
  }

  /**
   * Get all MCP toolset names (prefixed with "mcp:")
   */
  getToolsetNames(): string[] {
    return Array.from(this.toolsets.values()).map(t => t.name);
  }

  /**
   * Check health of all servers
   */
  async checkHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [name, client] of this.clients) {
      results.set(name, await client.isHealthy());
    }

    return results;
  }

  /**
   * Get a client by name
   */
  getClient(name: string): IMCPClient | undefined {
    return this.clients.get(name);
  }
}
