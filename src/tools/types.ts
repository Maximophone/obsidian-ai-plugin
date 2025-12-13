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
  return tools.map(tool => {
    const requiredParams = Object.entries(tool.parameters)
      .filter(([_, param]) => param.required)
      .map(([name, _]) => name);
    
    const inputSchema: Record<string, unknown> = {
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
    };
    
    // Only include required if there are required params
    if (requiredParams.length > 0) {
      inputSchema.required = requiredParams;
    }
    
    return {
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema,
    };
  });
}

export function toolsToOpenAIFormat(tools: ToolDefinition[]): unknown[] {
  return tools.map(tool => {
    const requiredParams = Object.entries(tool.parameters)
      .filter(([_, param]) => param.required)
      .map(([name, _]) => name);
    
    const parameters: Record<string, unknown> = {
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
    };
    
    // Only include required if there are required params
    if (requiredParams.length > 0) {
      parameters.required = requiredParams;
    }
    
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

export function toolsToGoogleFormat(tools: ToolDefinition[]): unknown[] {
  return [{
    functionDeclarations: tools.map(tool => {
      const requiredParams = Object.entries(tool.parameters)
        .filter(([_, param]) => param.required)
        .map(([name, _]) => name);
      
      const params: Record<string, unknown> = {
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
      };
      
      // Only include required if there are required params (Gemini doesn't like empty arrays)
      if (requiredParams.length > 0) {
        params.required = requiredParams;
      }
      
      return {
        name: tool.name,
        description: tool.description,
        parameters: params,
      };
    }),
  }];
}

