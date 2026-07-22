/**
 * AI model pricing, USD per 1,000,000 tokens. Approximate list prices — edit
 * here when they change. Models not listed cost 0 (e.g. OpenRouter :free) and
 * are flagged `known: false` so the admin view can mark them as estimates.
 */
type Price = { input: number; output: number }

const PRICES: Record<string, Price> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
}

export function isFreeModel(model: string): boolean {
  return model.endsWith(':free') || model === 'openrouter/free'
}

export function getPrice(model: string): { price: Price; known: boolean } {
  if (PRICES[model]) return { price: PRICES[model], known: true }
  if (isFreeModel(model)) return { price: { input: 0, output: 0 }, known: true }
  return { price: { input: 0, output: 0 }, known: false }
}

/** Cost in USD for a single call. */
export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const { price } = getPrice(model)
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
}
