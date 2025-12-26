/**
 * Standard MCP Client - Implements standard MCP protocol with JSON-RPC 2.0 over Streamable HTTP
 * 
 * This client follows the official MCP specification:
 * - JSON-RPC 2.0 message format
 * - HTTP POST for sending requests
 * - SSE (Server-Sent Events) or JSON responses
 * - Session management via Mcp-Session-Id header
 * 
 * For API keys, include them in the URL query parameter (e.g., ?exaApiKey=YOUR_KEY)
 */

import { requestUrl, RequestUrlResponse } from 'obsidian';

// Import the shared config type
export interface StandardMCPServerConfig {
    name: string;
    url: string;
    enabled: boolean;
}

// JSON-RPC 2.0 types
interface JSONRPCRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface JSONRPCResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface JSONRPCNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

// MCP-specific types
interface MCPInitializeParams {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    clientInfo: {
        name: string;
        version: string;
    };
}

interface MCPInitializeResult {
    protocolVersion: string;
    capabilities: {
        tools?: { listChanged?: boolean };
        prompts?: { listChanged?: boolean };
        resources?: { subscribe?: boolean; listChanged?: boolean };
        logging?: Record<string, never>;
    };
    serverInfo: {
        name: string;
        version: string;
    };
    instructions?: string;
}

// Standard MCP tool definition (from tools/list)
export interface MCPStandardTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties?: Record<string, {
            type: string;
            description?: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}

interface MCPToolsListResult {
    tools: MCPStandardTool[];
    nextCursor?: string;
}

interface MCPToolCallResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

/**
 * Standard MCP Client - Implements JSON-RPC 2.0 over HTTP
 */
export class StandardMCPClient {
    private config: StandardMCPServerConfig;
    private sessionId: string | null = null;
    private nextId: number = 1;
    private protocolVersion: string = '2024-11-05';
    private initialized: boolean = false;
    private cachedTools: MCPStandardTool[] = [];

    constructor(config: StandardMCPServerConfig) {
        this.config = config;
    }

    /**
     * Get the base URL without trailing slash
     */
    private get baseUrl(): string {
        return this.config.url.replace(/\/$/, '');
    }

    /**
     * Generate unique request ID
     */
    private getNextId(): number {
        return this.nextId++;
    }

    /**
     * Build a JSON-RPC request object
     */
    private buildRequest(method: string, params?: Record<string, unknown>): JSONRPCRequest {
        return {
            jsonrpc: '2.0',
            id: this.getNextId(),
            method,
            ...(params ? { params } : {}),
        };
    }

    /**
     * Send a JSON-RPC request and handle the response
     * Supports both JSON and SSE responses
     */
    private async sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        const request = this.buildRequest(method, params);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        };

        // Include session ID if we have one
        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }

        // Include protocol version header after initialization
        if (this.initialized) {
            headers['MCP-Protocol-Version'] = this.protocolVersion;
        }

        console.debug(`[MCP] Sending ${method} request to ${this.baseUrl}:`, JSON.stringify(request));

        try {
            const response = await requestUrl({
                url: this.baseUrl,
                method: 'POST',
                headers,
                body: JSON.stringify(request),
            });

            // Check for session ID in response
            const responseSessionId = response.headers?.['mcp-session-id'];
            if (responseSessionId) {
                this.sessionId = responseSessionId;
                console.debug(`[MCP] Received session ID: ${this.sessionId}`);
            }

            return this.parseResponse<T>(response);
        } catch (error) {
            console.error(`[MCP] Request failed:`, error);
            throw error;
        }
    }

    /**
     * Parse the HTTP response (JSON or SSE)
     */
    private parseResponse<T>(response: RequestUrlResponse): T {
        const contentType = response.headers?.['content-type'] || '';

        console.debug(`[MCP] Response status: ${response.status}, content-type: ${contentType}`);

        if (contentType.includes('text/event-stream')) {
            // Parse SSE response
            return this.parseSSEResponse<T>(response.text);
        } else {
            // Parse JSON response
            const jsonResponse = response.json as JSONRPCResponse;

            if (jsonResponse.error) {
                throw new Error(`MCP Error ${jsonResponse.error.code}: ${jsonResponse.error.message}`);
            }

            return jsonResponse.result as T;
        }
    }

    /**
     * Parse SSE (Server-Sent Events) response to extract JSON-RPC message
     */
    private parseSSEResponse<T>(text: string): T {
        // SSE format: each message starts with "data: " and ends with newlines
        // We're looking for the JSON-RPC response
        const lines = text.split('\n');
        let result: T | null = null;

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6); // Remove "data: " prefix
                try {
                    const parsed = JSON.parse(data) as JSONRPCResponse;
                    if (parsed.result !== undefined) {
                        result = parsed.result as T;
                    } else if (parsed.error) {
                        throw new Error(`MCP Error ${parsed.error.code}: ${parsed.error.message}`);
                    }
                } catch (e) {
                    // Not valid JSON, might be a notification or other message
                    console.debug(`[MCP] Skipping non-JSON SSE line: ${data}`);
                }
            }
        }

        if (result === null) {
            throw new Error('No valid JSON-RPC response found in SSE stream');
        }

        return result;
    }

    /**
     * Initialize the connection with the MCP server
     * This must be called before any other operations
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            console.debug('[MCP] Already initialized');
            return;
        }

        console.debug(`[MCP] Initializing connection to ${this.config.name} at ${this.baseUrl}`);

        const params: MCPInitializeParams = {
            protocolVersion: this.protocolVersion,
            capabilities: {
                // We support tool use
            },
            clientInfo: {
                name: 'ObsidianAI',
                version: '1.0.0',
            },
        };

        try {
            const result = await this.sendRequest<MCPInitializeResult>('initialize', params as unknown as Record<string, unknown>);

            console.debug(`[MCP] Initialized with server: ${result.serverInfo.name} v${result.serverInfo.version}`);
            console.debug(`[MCP] Server capabilities:`, result.capabilities);

            if (result.instructions) {
                console.debug(`[MCP] Server instructions: ${result.instructions}`);
            }

            // Update protocol version to match server's
            this.protocolVersion = result.protocolVersion;
            this.initialized = true;

            // Send initialized notification
            await this.sendNotification('notifications/initialized');

            console.debug(`[MCP] Connection established successfully`);
        } catch (error) {
            console.error(`[MCP] Initialization failed:`, error);
            throw error;
        }
    }

    /**
     * Send a notification (no response expected)
     */
    private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
        const notification: JSONRPCNotification = {
            jsonrpc: '2.0',
            method,
            ...(params ? { params } : {}),
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }

        try {
            await requestUrl({
                url: this.baseUrl,
                method: 'POST',
                headers,
                body: JSON.stringify(notification),
            });
        } catch (error) {
            // Notifications may return 202 Accepted with no body, which might throw
            // We ignore these errors
            console.debug(`[MCP] Notification ${method} sent`);
        }
    }

    /**
     * Fetch available tools from the server
     */
    async fetchTools(): Promise<MCPStandardTool[]> {
        if (!this.initialized) {
            await this.initialize();
        }

        console.debug(`[MCP] Fetching tools from ${this.config.name}`);

        try {
            const result = await this.sendRequest<MCPToolsListResult>('tools/list', {});
            this.cachedTools = result.tools || [];

            console.debug(`[MCP] Received ${this.cachedTools.length} tools:`,
                this.cachedTools.map(t => t.name).join(', '));

            return this.cachedTools;
        } catch (error) {
            console.error(`[MCP] Failed to fetch tools:`, error);
            return [];
        }
    }

    /**
     * Execute a tool on the server
     */
    async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
        if (!this.initialized) {
            await this.initialize();
        }

        console.debug(`[MCP] Executing tool ${name} with args:`, args);

        try {
            const result = await this.sendRequest<MCPToolCallResult>('tools/call', {
                name,
                arguments: args,
            });

            // Extract text content from the result
            const textContent = result.content
                .filter(c => c.type === 'text' && c.text)
                .map(c => c.text)
                .join('\n');

            if (result.isError) {
                return `Error: ${textContent || 'Tool execution failed'}`;
            }

            return textContent || 'Tool executed successfully (no output)';
        } catch (error) {
            console.error(`[MCP] Tool execution failed:`, error);
            return `MCP Error: ${error.message}`;
        }
    }

    /**
     * Get cached tools (call fetchTools first)
     */
    getCachedTools(): MCPStandardTool[] {
        return this.cachedTools;
    }

    /**
     * Get the server config
     */
    getConfig(): StandardMCPServerConfig {
        return this.config;
    }

    /**
     * Check if initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Check if the server is healthy by attempting to initialize
     */
    async isHealthy(): Promise<boolean> {
        try {
            if (!this.initialized) {
                await this.initialize();
            }
            return this.initialized;
        } catch {
            return false;
        }
    }
}
