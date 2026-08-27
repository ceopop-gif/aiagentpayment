export class AiProvider {
  constructor(name = 'ai-provider') {
    this.name = name;
  }

  async classifyIntent(_input) {
    throw new Error(`${this.name}: classifyIntent() not implemented`);
  }

  async generateText(_input) {
    throw new Error(`${this.name}: generateText() not implemented`);
  }
}

// Expected classifyIntent result:
// {
//   intent: 'CREATE_STORE',
//   domain: 'store',
//   parameters: {},
//   missing: [],
//   confidence: 0.98
// }
//
// The concrete provider implementation may use any approved LLM provider.
// API keys must exist only in server secrets/environment variables.
