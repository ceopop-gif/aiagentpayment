const registry = new Map();

export function registerPaymentProvider(name, adapter) {
  if (!name || !adapter) throw new Error('Provider name and adapter are required');
  registry.set(name, adapter);
}

export function getPaymentProviders() {
  return Object.fromEntries(registry.entries());
}

export function getPaymentProvider(name) {
  return registry.get(name) || null;
}

// Concrete provider adapters should be registered by the runtime/bootstrap layer.
// No provider is enabled by default. This prevents AnnyPay from claiming support
// for a channel/provider that has not actually been connected and approved.
