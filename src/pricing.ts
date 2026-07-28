/**
 * Pricing utilities for AI model requests
 * 
 * Duplicated from ai_core/pricing.py
 * Prices are per 1M tokens (input/output)
 */

// Price per 1M tokens: [input_price, output_price]
// Keep in sync with ai_core/pricing.py
const MODEL_PRICES: Record<string, [number, number]> = {
  // Anthropic
  'opus4': [15, 75],
  'opus4.1': [15, 75],
  'opus4.5': [5, 25],
  'opus4.6': [5, 25],
  'opus4.7': [5, 25],
  'opus4.8': [5, 25],
  'opus5': [5, 25],
  'fable5': [10, 50],
  'sonnet4': [3, 15],
  'sonnet4.5': [3, 15],
  'sonnet4.6': [3, 15],
  'sonnet5': [3, 15],  // intro pricing $2/$10 through 2026-08-31
  'sonnet3.7': [3, 15],
  'haiku3.5': [0.8, 4],
  'haiku3': [0.25, 1.25],
  'haiku4.5': [1, 5],
  'opus3': [15, 75],

  // Google (TODO: Gemini pricing depends on token count)
  'gemini2.5pro': [1.25, 10.00],
  'gemini2.5flash': [0.3, 2.5],
  'gemini3.0pro': [2.00, 12.00],
  'gemini3.0flash': [0.5, 3.0],
  'gemini3.1pro': [2.00, 12.00],  // ≤200K-token prompts; $4/$18 above
  'gemini3.1flashlite': [0.25, 1.50],
  'gemini3.5flash': [1.50, 9.00],

  // OpenAI
  'gpt5': [1.25, 10.00],
  'gpt5-mini': [0.25, 2],
  'gpt5-nano': [0.05, 0.4],
  'gpt5.6': [5, 30],  // ≤272K-token prompts; 2x input / 1.5x output above
  'sol': [5, 30],
  'terra': [2.5, 15],
  'luna': [1, 6],

  // DeepSeek (cache-miss input pricing)
  'deepseek': [0.14, 0.28],
  'deepseek-v4': [0.14, 0.28],
  'deepseek-v4-pro': [0.435, 0.87],
};

/**
 * Compute the cost of an API request based on token usage
 * 
 * Duplicated from ai_core.compute_request_price()
 * 
 * @param tokensIn - Number of input tokens
 * @param tokensOut - Number of output tokens  
 * @param modelAlias - Model alias (e.g., 'sonnet4', 'opus4')
 * @returns Cost in dollars, or null if pricing unavailable
 */
export function computeRequestPrice(
  tokensIn: number,
  tokensOut: number,
  modelAlias: string
): number | null {
  const prices = MODEL_PRICES[modelAlias];
  
  if (!prices) {
    // Model not in pricing data - return null instead of throwing
    return null;
  }
  
  const [inputPrice, outputPrice] = prices;
  
  // Prices are per 1M tokens
  const inputPricePerToken = inputPrice / 1_000_000;
  const outputPricePerToken = outputPrice / 1_000_000;
  
  return (tokensIn * inputPricePerToken) + (tokensOut * outputPricePerToken);
}

/**
 * Format cost for display
 * 
 * @param cost - Cost in dollars
 * @returns Formatted string like "$0.02" or "$1.23"
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}
