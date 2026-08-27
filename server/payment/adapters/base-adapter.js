export class PaymentProviderAdapter {
  constructor(name) {
    this.name = name;
  }

  async createPaymentIntent(_input) {
    throw new Error(`${this.name}: createPaymentIntent() not implemented`);
  }

  async getPaymentStatus(_providerTransactionId) {
    throw new Error(`${this.name}: getPaymentStatus() not implemented`);
  }

  async cancelPayment(_providerTransactionId) {
    throw new Error(`${this.name}: cancelPayment() not implemented`);
  }

  async refundPayment(_input) {
    throw new Error(`${this.name}: refundPayment() not implemented`);
  }

  async verifyWebhook(_rawBody, _headers) {
    throw new Error(`${this.name}: verifyWebhook() not implemented`);
  }

  async normalizeWebhookEvent(_rawBody, _headers) {
    throw new Error(`${this.name}: normalizeWebhookEvent() not implemented`);
  }
}

// normalizeWebhookEvent() should return a provider-neutral object like:
// {
//   externalEventId,
//   type: 'payment.paid',
//   providerTransactionId,
//   providerMerchantId,
//   amount,
//   currency,
//   occurredAt,
//   raw
// }
