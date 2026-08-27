export class PayoutProvider {
  constructor(name) { this.name = name; }
  async verifyAccount() { throw new Error('verifyAccount not implemented'); }
  async createPayout() { throw new Error('createPayout not implemented'); }
  async getPayoutStatus() { throw new Error('getPayoutStatus not implemented'); }
  async verifyWebhook() { throw new Error('verifyWebhook not implemented'); }
  async normalizeWebhookEvent() { throw new Error('normalizeWebhookEvent not implemented'); }
}
