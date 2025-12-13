/**
 * MCP Client - Connects to MCP servers and executes tools
 */

import { ToolDefinition, ToolParameter, RegisteredTool, Toolset } from './types';
import { requestUrl, RequestUrlResponse } from 'obsidian';

export interface MCPServerConfig {
  name: string;           // Display name for this server
  url: string;            // Base URL (e.g., "http://127.0.0.1:8765")
  apiKey: string;         // API key for authentication
  enabled: boolean;       // Whether this server is enabled
}

interface MCPToolDefinition {
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

interface MCPToolsResponse {
  tools: MCPToolDefinition[];
}

interface MCPExecuteResponse {
  result?: string;
  error?: string;
}

/**
 * MCP Client - handles communication with a single MCP server
 */
export class MCPClient {
  private config: MCPServerConfig;
  private cachedTools: MCPToolDefinition[] | null = null;

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
  async fetchTools(): Promise<MCPToolDefinition[]> {
    try {
      const response = await this.request('GET', '/tools');
      
      if (response.status !== 200) {
        console.error(`MCP server ${this.config.name} returned status ${response.status}`);
        return [];
      }

      const data = response.json as MCPToolsResponse;
      this.cachedTools = data.tools || [];
      return this.cachedTools;
    } catch (error) {
      console.error(`Failed to fetch tools from MCP server ${this.config.name}:`, error);
      return [];
    }
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

      const data = response.json as MCPExecuteResponse;

      if (data.error) {
        return `Error: ${data.error}`;
      }

      return data.result || 'Tool executed successfully (no output)';
    } catch (error) {
      return `MCP Error: ${error.message}`;
    }
  }

  /**
   * Get cached tools (call fetchTools first)
   */
  getCachedTools(): MCPToolDefinition[] {
    return this.cachedTools || [];
  }

  /**
   * Get the server config
   */
  getConfig(): MCPServerConfig {
    return this.config;
  }
}

/**
 * Convert MCP tool definitions to our internal format
 */
function convertMCPToolDefinition(mcpTool: MCPToolDefinition): ToolDefinition {
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
 * Create a toolset from an MCP server
 */
export async function createMCPToolset(client: MCPClient): Promise<Toolset | null> {
  const config = client.getConfig();
  
  if (!config.enabled) {
    return null;
  }

  // Fetch tools from server
  const mcpTools = await client.fetchTools();
  
  if (mcpTools.length === 0) {
    console.warn(`MCP server ${config.name} has no tools`);
    return null;
  }

  // Convert to registered tools
  const tools: RegisteredTool[] = mcpTools.map(mcpTool => ({
    definition: convertMCPToolDefinition(mcpTool),
    execute: async (args: Record<string, unknown>) => {
      return client.executeTool(mcpTool.name, args);
    },
  }));

  return {
    name: `mcp:${config.name}`,
    description: `Tools from MCP server: ${config.name}`,
    tools,
  };
}

/**
 * MCP Manager - manages multiple MCP server connections
 */
export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();
  private toolsets: Map<string, Toolset> = new Map();

  /**
   * Add or update a server configuration
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    const client = new MCPClient(config);
    this.clients.set(config.name, client);

    if (config.enabled) {
      const toolset = await createMCPToolset(client);
      if (toolset) {
        this.toolsets.set(config.name, toolset);
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
        const toolset = await createMCPToolset(client);
        if (toolset) {
          this.toolsets.set(name, toolset);
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
  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }
}

