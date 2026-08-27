(() => {
  if (window.ANNYPAY_CONFIG?.ACTIVITY_LOGGING === false) return;

  const config = window.ANNYPAY_CONFIG || {};
  const backend = (config.BACKEND_URL || location.origin).replace(/\/$/, '');
  const originalFetch = window.fetch.bind(window);
  const sessionKey = sessionStorage.getItem('annypay_activity_session')
    || (crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  sessionStorage.setItem('annypay_activity_session', sessionKey);

  let authClient = null;
  let authWatchStarted = false;
  let lastAuthEvent = '';

  const area = inferArea(location.pathname);
  const route = safeRoute();
  const storeSlug = new URLSearchParams(location.search).get('store') || null;

  window.fetch = async function annypayLoggedFetch(input, init = {}) {
    let requestUrl;
    try {
      requestUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    } catch {
      return originalFetch(input, init);
    }

    const backendUrl = new URL(backend, location.href);
    const shouldTag = requestUrl.origin === backendUrl.origin && requestUrl.pathname.startsWith('/api/');
    if (!shouldTag) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    headers.set('x-annypay-session', sessionKey);
    headers.set('x-annypay-page', route.slice(0, 500));
    headers.set('x-annypay-area', area);

    const response = await originalFetch(input, { ...init, headers });
    if (!response.ok && !requestUrl.pathname.startsWith('/api/logs/')) {
      void log('API_CLIENT_ERROR', {
        severity: response.status >= 500 ? 'ERROR' : 'WARN',
        success: false,
        message: `API ${response.status}`,
        metadata: {
          api_route: requestUrl.pathname,
          method: String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
          status: response.status
        }
      });
    }
    return response;
  };

  async function getAuthClient() {
    if (authClient) return authClient;
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !window.supabase?.createClient) return null;
    authClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return authClient;
  }

  async function getAuth() {
    try {
      const client = await getAuthClient();
      if (!client) return { user: null, token: null };
      const { data } = await client.auth.getSession();
      return {
        user: data.session?.user || null,
        token: data.session?.access_token || null
      };
    } catch {
      return { user: null, token: null };
    }
  }

  async function log(eventName, detail = {}) {
    try {
      const auth = await getAuth();
      const body = {
        eventName,
        eventCategory: detail.eventCategory || null,
        severity: detail.severity || 'INFO',
        sourceArea: detail.sourceArea || area,
        actorType: detail.actorType || (area === 'FRONTEND' ? 'CUSTOMER' : undefined),
        sessionKey,
        merchantId: detail.merchantId || localStorage.getItem('annypay_merchant_id') || null,
        storeId: detail.storeId || localStorage.getItem('annypay_store_id') || null,
        storeSlug: detail.storeSlug || storeSlug,
        route,
        resourceType: detail.resourceType || null,
        resourceId: detail.resourceId || null,
        success: detail.success !== false,
        message: String(detail.message || eventName).slice(0, 1000),
        clientTimestamp: new Date().toISOString(),
        referer: document.referrer || null,
        metadata: sanitize(detail.metadata || {})
      };
      if (detail.email) body.email = String(detail.email).slice(0, 320);

      await originalFetch(`${backend}/api/logs/client`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-annypay-session': sessionKey,
          ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
        },
        body: JSON.stringify(body),
        keepalive: true
      });
    } catch {
      // Logging must never block the customer or merchant workflow.
    }
  }

  async function authEvent(eventName, detail = {}) {
    try {
      const auth = await getAuth();
      if (!auth.token && eventName !== 'AUTH_LOGIN_FAILED') return;
      await originalFetch(`${backend}/api/logs/auth`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-annypay-session': sessionKey,
          ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {})
        },
        body: JSON.stringify({
          eventName,
          sessionKey,
          merchantId: detail.merchantId || localStorage.getItem('annypay_merchant_id') || null,
          storeId: detail.storeId || localStorage.getItem('annypay_store_id') || null,
          sourceArea: area,
          route,
          email: detail.email || null,
          clientTimestamp: new Date().toISOString(),
          metadata: sanitize(detail.metadata || {})
        }),
        keepalive: true
      });
    } catch {
      // Never block auth.
    }
  }

  async function watchAuth() {
    if (authWatchStarted) return;
    const client = await waitForSupabaseClient();
    if (!client) return;
    authWatchStarted = true;

    const { data } = await client.auth.getSession();
    if (data.session?.user) {
      await dedupAuth('AUTH_SESSION_RESUMED', data.session.user.id);
    }

    client.auth.onAuthStateChange((event, session) => {
      const mapped = {
        SIGNED_IN: 'AUTH_LOGIN_SUCCESS',
        SIGNED_OUT: 'AUTH_LOGOUT',
        TOKEN_REFRESHED: 'AUTH_TOKEN_REFRESHED',
        USER_UPDATED: 'AUTH_SESSION_RESUMED'
      }[event];
      if (mapped) void dedupAuth(mapped, session?.user?.id || 'unknown');
    });
  }

  async function dedupAuth(eventName, userId) {
    const key = `${eventName}:${userId}`;
    const now = Date.now();
    const previous = Number(sessionStorage.getItem(`annypay_auth_event_${key}`) || 0);
    if (now - previous < 15000) return;
    sessionStorage.setItem(`annypay_auth_event_${key}`, String(now));
    lastAuthEvent = eventName;
    await authEvent(eventName);
  }

  async function waitForSupabaseClient() {
    for (let i = 0; i < 50; i += 1) {
      const client = await getAuthClient();
      if (client) return client;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  function bindActivity() {
    void log(area === 'FRONTEND' ? 'STOREFRONT_VIEW' : area === 'BACKOFFICE' ? 'BACKOFFICE_VIEW' : 'PAGE_VIEW', {
      metadata: {
        title: document.title,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        language: navigator.language || null
      }
    });

    document.addEventListener('submit', event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const formId = form.id || form.getAttribute('name') || 'anonymous-form';
      const metadata = { form_id: formId, method: form.method || 'GET', action: safeAction(form.action) };
      if (formId === 'authForm') {
        const email = form.querySelector('input[type="email"]')?.value || '';
        void log('AUTH_MAGIC_LINK_REQUESTED', { sourceArea: 'AUTH', email, metadata });
      } else {
        const mapped = /checkout/i.test(formId) ? 'CHECKOUT_STARTED' : 'FORM_SUBMIT';
        void log(mapped, { metadata });
      }
    }, true);

    document.addEventListener('click', event => {
      const target = event.target?.closest?.('button,a,[data-log-event]');
      if (!target) return;
      const custom = target.getAttribute('data-log-event');
      const id = target.id || null;
      const href = target.tagName === 'A' ? safeAction(target.getAttribute('href')) : null;
      const label = String(target.getAttribute('aria-label') || target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);

      if (id === 'logoutBtn' || /ออกจากระบบ|logout/i.test(label)) {
        void authEvent('AUTH_LOGOUT_REQUESTED', { metadata: { element_id: id, label } });
      }

      if (custom || id || href || target.hasAttribute('data-view') || target.hasAttribute('data-bo-view')) {
        void log(custom || 'UI_CLICK', {
          metadata: {
            element_id: id,
            label,
            href,
            view: target.getAttribute('data-view') || target.getAttribute('data-bo-view') || null
          }
        });
      }
    }, true);

    window.addEventListener('error', event => {
      void log('CLIENT_ERROR', {
        severity: 'ERROR',
        success: false,
        message: event.message || 'Client error',
        metadata: {
          filename: safeAction(event.filename),
          line: event.lineno || null,
          column: event.colno || null
        }
      });
    });

    window.addEventListener('unhandledrejection', event => {
      void log('CLIENT_UNHANDLED_REJECTION', {
        severity: 'ERROR',
        success: false,
        message: String(event.reason?.message || event.reason || 'Unhandled rejection').slice(0, 1000)
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void log('PAGE_HIDDEN', { metadata: { last_auth_event: lastAuthEvent || null } });
      }
    });
  }

  function inferArea(path) {
    if (/backoffice|billing|payouts|commerce-admin|activity-logs/i.test(path)) return 'BACKOFFICE';
    if (/store\.html|sale\.html|pay\.html/i.test(path)) return 'FRONTEND';
    if (/index\.html|\/$/i.test(path)) return 'AUTH';
    return 'FRONTEND';
  }

  function safeRoute() {
    const url = new URL(location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|email|account|code/i.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return `${url.pathname}${url.search}`.slice(0, 1000);
  }

  function safeAction(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|key|secret|password|email|account|code/i.test(key)) url.searchParams.set(key, '[REDACTED]');
      }
      return `${url.pathname}${url.search}`.slice(0, 500);
    } catch {
      return String(value).slice(0, 500);
    }
  }

  function sanitize(value, depth = 0) {
    if (depth > 5) return '[MAX_DEPTH]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, 2000);
    if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitize(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      Object.entries(value).slice(0, 100).forEach(([key, val]) => {
        out[key] = /password|secret|api.?key|authorization|cookie|access.?token|refresh.?token|account.?number|card.?number|cvv/i.test(key)
          ? '[REDACTED]'
          : sanitize(val, depth + 1);
      });
      return out;
    }
    return String(value).slice(0, 1000);
  }

  window.ANNYPAY_ACTIVITY = {
    log,
    auth: authEvent,
    sessionKey,
    sourceArea: area
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindActivity();
      void watchAuth();
    });
  } else {
    bindActivity();
    void watchAuth();
  }
})();
