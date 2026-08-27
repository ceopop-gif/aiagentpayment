// AnnyPay public runtime configuration.
// These are public browser values only.
// Never place service-role, AI, payment, payout, webhook or logging secrets here.
window.ANNYPAY_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  // Leave blank when the Node backend serves the same origin.
  // Otherwise set the public HTTPS backend origin, e.g. https://api.example.com
  BACKEND_URL: "",
  ACTIVITY_LOGGING: true
};

// Load the common activity logger on every public/backoffice page that includes config.js.
// It records only sanitized event context; form values, passwords, tokens, secrets,
// card data and full bank account numbers are never collected.
(() => {
  const load = src => {
    if (document.querySelector(`script[data-annypay-src="${src}"]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.annypaySrc = src;
    document.head.appendChild(script);
  };

  load('assets/activity-logger.js');

  if (/\/backoffice\.html$/i.test(location.pathname)) {
    load('assets/backoffice-extensions.js');
  }
})();
