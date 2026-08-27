import { AiProvider } from './provider.js';

export class HttpAiProvider extends AiProvider {
  constructor({ baseUrl, apiKey, model }) {
    super('http-ai-gateway');
    if (!baseUrl) throw new Error('AI_GATEWAY_URL is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey || null;
    this.model = model || null;
  }

  async classifyIntent(input) {
    return this.#post('/classify', { ...input, model: this.model });
  }

  async generateText(input) {
    return this.#post('/generate', { ...input, model: this.model });
  }

  async #post(path, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { text }; }
    if (!response.ok) throw new Error(data.error || data.message || `AI Gateway HTTP ${response.status}`);
    return data;
  }
}

export function createAiProviderFromEnv() {
  if (!process.env.AI_GATEWAY_URL) return null;
  return new HttpAiProvider({
    baseUrl: process.env.AI_GATEWAY_URL,
    apiKey: process.env.AI_GATEWAY_API_KEY,
    model: process.env.AI_MODEL
  });
}
