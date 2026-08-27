const providers = new Map();

export function registerPayoutProvider(name, adapter) {
  if (!name || !adapter) throw new Error('Payout provider name and adapter are required');
  providers.set(String(name).toLowerCase(), adapter);
}

export function getPayoutProvider(name) {
  return providers.get(String(name || '').toLowerCase()) || null;
}

export function getPayoutProviders() {
  return Object.fromEntries(providers.entries());
}

export function listPayoutProviderNames() {
  return [...providers.keys()];
}
