/**
 * Tool system types
 */

// Tool parameter definition
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
}

// Tool definition
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  safe: boolean;  // true = read mode (no confirmation), false = write mode (needs confirmation)
}

// Tool call from AI
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Tool execution result
export interface ToolResult {
  name: string;
  toolCallId: string;
  result?: string;
  error?: string;
}

// Tool executor function type
export type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

// Registered tool (definition + executor)
export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

// Toolset - a collection of related tools
export interface Toolset {
  name: string;
  description: string;
  tools: RegisteredTool[];
}

// Convert tool definitions to format expected by AI APIs
export function toolsToAnthropicFormat(tools: ToolDefinition[]): unknown[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([name, param]) => [
          name,
          {
            type: param.type,
            description: param.description,
            ...(param.enum ? { enum: param.enum } : {}),
          }
        ])
      ),
      required: Object.entries(tool.parameters)
        .filter(([_, param]) => param.required)
        .map(([name, _]) => name),
    },
  }));
}

export function toolsToOpenAIFormat(tools: ToolDefinition[]): unknown[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([name, param]) => [
            name,
            {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            }
          ])
        ),
        required: Object.entries(tool.parameters)
          .filter(([_, param]) => param.required)
          .map(([name, _]) => name),
      },
    },
  }));
}

export function toolsToGoogleFormat(tools: ToolDefinition[]): unknown[] {
  return [{
    functionDeclarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([name, param]) => [
            name,
            {
              type: param.type.toUpperCase(),
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            }
          ])
        ),
        required: Object.entries(tool.parameters)
          .filter(([_, param]) => param.required)
          .map(([name, _]) => name),
      },
    })),
  }];
}

