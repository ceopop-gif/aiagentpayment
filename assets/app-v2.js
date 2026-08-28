(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0
  });

  const STORAGE = {
    profile: 'annypay_demo_profile_v3',
    session: 'annypay_demo_session_v3',
    stores: 'annypay_demo_stores_v3',
    products: 'annypay_demo_products_v3',
    orders: 'annypay_demo_orders_v3'
  };

  const state = {
    client: null,
    user: null,
    merchants: [],
    merchant: null,
    stores: [],
    products: [],
    orders: [],
    demo: false,
    signupStep: 1,
    pendingRegistration: null,
    suppressAuthEnter: false
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));

  const msg = (element, text = '', kind = '') => {
    if (!element) return;
    element.textContent = text;
    element.className = text ? `alert ${kind}`.trim() : 'hidden';
  };

  const show = id => {
    ['#configScreen', '#authScreen', '#appScreen'].forEach(selector => $(selector)?.classList.add('hidden'));
    $(id)?.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const cfg = () => ({
    url: window.ANNYPAY_CONFIG?.SUPABASE_URL || localStorage.getItem('annypay_supabase_url') || '',
    key: window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY || localStorage.getItem('annypay_supabase_anon_key') || ''
  });

  const readJson = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  const slug = value => value
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || `store-${Date.now().toString(36)}`;

  const todayStart = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };

  function showAuth(mode = 'signup') {
    show('#authScreen');
    setAuthMode(mode);
  }

  function setAuthMode(mode) {
    const signup = mode === 'signup';
    $('#signupTab').classList.toggle('active', signup);
    $('#loginTab').classList.toggle('active', !signup);
    $('#signupTab').setAttribute('aria-selected', String(signup));
    $('#loginTab').setAttribute('aria-selected', String(!signup));
    $('#signupForm').classList.toggle('hidden', !signup);
    $('#loginForm').classList.toggle('hidden', signup);
    $('#authSuccess').classList.add('hidden');
    if (signup) setSignupStep(1);
  }

  function setSignupStep(step) {
    state.signupStep = Math.max(1, Math.min(3, step));
    const titles = {
      1: 'ข้อมูลบัญชีผู้ใช้',
      2: 'ข้อมูลร้านและธุรกิจ',
      3: 'เลือกการเริ่มต้น'
    };
    const percent = Math.round((state.signupStep / 3) * 100);

    $$('.signup-step').forEach(element => {
      element.classList.toggle('hidden', Number(element.dataset.step) !== state.signupStep);
    });

    $('#stepLabel').textContent = `ขั้นตอน ${state.signupStep} จาก 3`;
    $('#stepTitle').textContent = titles[state.signupStep];
    $('#stepPercent').textContent = `${percent}%`;
    $('#stepProgress').style.width = `${percent}%`;
    $('#signupBack').classList.toggle('hidden', state.signupStep === 1);
    $('#signupNext').classList.toggle('hidden', state.signupStep === 3);
    $('#signupSubmit').classList.toggle('hidden', state.signupStep !== 3);

    $$('[data-dot]').forEach(dot => {
      const n = Number(dot.dataset.dot);
      dot.classList.toggle('active', n === state.signupStep);
      dot.classList.toggle('done', n < state.signupStep);
    });
    $$('.step-dots i').forEach((line, index) => line.classList.toggle('done', index + 1 < state.signupStep));
    msg($('#signupMessage'));
  }

  function validateCurrentSignupStep() {
    const step = $(`.signup-step[data-step="${state.signupStep}"]`);
    const required = [...step.querySelectorAll('input[required],select[required]')];

    if (state.signupStep === 2) {
      const checkedBusinessForm = step.querySelector('input[name="businessForm"]:checked');
      if (!checkedBusinessForm) {
        msg($('#signupMessage'), 'กรุณาเลือกรูปแบบผู้สมัคร', 'error');
        return false;
      }
    }

    for (const input of required) {
      if (!input.checkValidity()) {
        input.reportValidity();
        return false;
      }
    }

    if (state.signupStep === 1 && $('#signupPassword').value.length < 8) {
      msg($('#signupMessage'), 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 'error');
      $('#signupPassword').focus();
      return false;
    }

    if (state.signupStep === 3 && !$('#termsConsent').checked) {
      msg($('#signupMessage'), 'กรุณายอมรับข้อกำหนดการใช้งานและนโยบายความเป็นส่วนตัว', 'error');
      $('#termsConsent').focus();
      return false;
    }

    return true;
  }

  function collectRegistration() {
    return {
      display_name: $('#signupName').value.trim(),
      phone: $('#signupPhone').value.trim(),
      email: $('#signupEmail').value.trim().toLowerCase(),
      password: $('#signupPassword').value,
      business_name: $('#signupBusinessName').value.trim(),
      business_type: $('#signupBusinessType').value,
      business_form: $('input[name="businessForm"]:checked')?.value || 'individual',
      referral_code: $('#referralCode').value.trim() || null,
      start_plan: $('input[name="startPlan"]:checked')?.value || 'starter',
      marketing_consent: $('#marketingConsent').checked,
      registered_at: new Date().toISOString()
    };
  }

  function renderSuccess(profile, options = {}) {
    $('#signupForm').classList.add('hidden');
    $('#loginForm').classList.add('hidden');
    $('#authSuccess').classList.remove('hidden');
    $('#successTitle').textContent = options.title || 'สมัครสำเร็จ';
    $('#successText').textContent = options.text || 'บัญชีธุรกิจของคุณพร้อมเริ่มต้นใช้งานแล้ว';
    $('#successSummary').innerHTML = `
      <div><span>ชื่อผู้ใช้งาน</span><b>${esc(profile.display_name)}</b></div>
      <div><span>ร้าน / ธุรกิจ</span><b>${esc(profile.business_name)}</b></div>
      <div><span>อีเมล</span><b>${esc(profile.email)}</b></div>
    `;
    $('#enterDashboard').classList.toggle('hidden', options.requiresEmail === true);
    $('#successLogin').classList.toggle('hidden', options.requiresEmail !== true);
  }

  async function init() {
    const parameters = new URLSearchParams(location.search);
    const configRequested = parameters.get('setup') === '1';
    const config = cfg();

    if (configRequested) {
      $('#configUrl').value = config.url;
      $('#configKey').value = config.key;
      show('#configScreen');
      return;
    }

    if (!config.url || !config.key) {
      state.demo = true;
      $('#demoNotice').classList.remove('hidden');
      $('#magicLinkBtn').classList.add('hidden');

      const hasDemoSession = localStorage.getItem(STORAGE.session) === '1';
      const profile = readJson(STORAGE.profile, null);
      if (hasDemoSession && profile) {
        state.user = {
          id: profile.user_id || `demo-${Date.now()}`,
          email: profile.email,
          user_metadata: profile
        };
        await enter();
      } else {
        showAuth('signup');
      }
      return;
    }

    try {
      state.client = window.supabase.createClient(config.url, config.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;

      state.client.auth.onAuthStateChange((_event, session) => {
        state.user = session?.user || null;
        if (state.suppressAuthEnter) {
          state.suppressAuthEnter = false;
          return;
        }
        state.user ? enter() : showAuth('login');
      });

      state.user = data.session?.user || null;
      state.user ? await enter() : showAuth('signup');
    } catch (error) {
      state.demo = true;
      $('#demoNotice').classList.remove('hidden');
      showAuth('signup');
      msg($('#signupMessage'), `ไม่สามารถเชื่อมระบบบัญชีจริงได้ จึงเปิดโหมดตัวอย่าง: ${error.message}`, 'error');
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    if (!validateCurrentSignupStep()) return;

    const profile = collectRegistration();
    const submit = $('#signupSubmit');
    submit.disabled = true;
    msg($('#signupMessage'));

    try {
      if (state.demo || !state.client) {
        const safeProfile = {
          ...profile,
          password: undefined,
          user_id: `demo-user-${Date.now().toString(36)}`
        };
        delete safeProfile.password;
        saveJson(STORAGE.profile, safeProfile);
        localStorage.setItem(STORAGE.session, '1');
        state.pendingRegistration = safeProfile;
        state.user = {
          id: safeProfile.user_id,
          email: safeProfile.email,
          user_metadata: safeProfile
        };
        renderSuccess(safeProfile, {
          title: 'สร้างบัญชีตัวอย่างสำเร็จ',
          text: 'คุณสามารถเข้าสู่หลังบ้าน ทดลองสร้างร้านและเพิ่มสินค้าได้ทันที'
        });
        return;
      }

      const redirect = `${location.origin}${location.pathname}`;
      state.suppressAuthEnter = true;
      const { data, error } = await state.client.auth.signUp({
        email: profile.email,
        password: profile.password,
        options: {
          emailRedirectTo: redirect,
          data: {
            display_name: profile.display_name,
            phone: profile.phone,
            business_name: profile.business_name,
            business_type: profile.business_type,
            business_form: profile.business_form,
            referral_code: profile.referral_code,
            start_plan: profile.start_plan,
            marketing_consent: profile.marketing_consent
          }
        }
      });
      if (error) throw error;

      state.pendingRegistration = profile;
      state.user = data.user || null;

      if (data.session && state.user) {
        await tryBootstrapMerchant(profile);
        renderSuccess(profile, {
          title: 'สมัครสำเร็จ',
          text: 'บัญชีของคุณพร้อมเข้าสู่หลังบ้าน AnnyPay แล้ว'
        });
      } else {
        renderSuccess(profile, {
          title: 'ตรวจสอบอีเมลของคุณ',
          text: 'เราได้ส่งลิงก์ยืนยันบัญชีไปทางอีเมลแล้ว หลังยืนยันให้กลับมาเข้าสู่ระบบ',
          requiresEmail: true
        });
      }
    } catch (error) {
      state.suppressAuthEnter = false;
      msg($('#signupMessage'), error.message || 'สมัครไม่สำเร็จ กรุณาลองใหม่', 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function tryBootstrapMerchant(profile) {
    if (!state.client || !state.user) return null;
    try {
      const { data, error } = await state.client.rpc('bootstrap_merchant', {
        p_business_name: profile.business_name,
        p_display_name: profile.display_name,
        p_phone: profile.phone,
        p_business_type: profile.business_type
      });
      if (error) throw error;
      return data;
    } catch (error) {
      console.warn('Merchant bootstrap will continue in onboarding:', error.message);
      return null;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const submit = $('#loginSubmit');
    submit.disabled = true;
    msg($('#loginMessage'));

    try {
      if (state.demo || !state.client) {
        const profile = readJson(STORAGE.profile, null);
        if (!profile || profile.email !== email) {
          throw new Error('ยังไม่พบบัญชีตัวอย่างของอีเมลนี้ กรุณาสมัครใช้งานก่อน');
        }
        localStorage.setItem(STORAGE.session, '1');
        state.user = {
          id: profile.user_id,
          email: profile.email,
          user_metadata: profile
        };
        await enter();
        return;
      }

      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.user = data.user;
      await enter();
    } catch (error) {
      msg($('#loginMessage'), error.message || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function sendMagicLink() {
    const email = $('#loginEmail').value.trim().toLowerCase();
    if (!email) {
      msg($('#loginMessage'), 'กรุณากรอกอีเมลก่อน', 'error');
      $('#loginEmail').focus();
      return;
    }
    if (!state.client) {
      msg($('#loginMessage'), 'Magic Link ใช้งานได้เมื่อเชื่อมระบบบัญชีจริงแล้ว', 'error');
      return;
    }

    const button = $('#magicLinkBtn');
    button.disabled = true;
    try {
      const redirect = `${location.origin}${location.pathname}`;
      const { error } = await state.client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirect,
          shouldCreateUser: false
        }
      });
      if (error) throw error;
      msg($('#loginMessage'), 'ส่ง Magic Link แล้ว กรุณาตรวจสอบอีเมล', 'success');
    } catch (error) {
      msg($('#loginMessage'), error.message || 'ส่ง Magic Link ไม่สำเร็จ', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function enter() {
    show('#appScreen');
    $('#userEmail').textContent = state.user?.email || 'AnnyPay user';
    $('#environmentBadge').classList.toggle('hidden', !state.demo);

    if (state.demo) {
      loadDemoMerchant();
      return;
    }
    await loadMerchants();
  }

  function loadDemoMerchant() {
    const profile = state.user?.user_metadata || readJson(STORAGE.profile, null) || {
      display_name: 'ลูกค้า AnnyPay',
      business_name: 'ร้านของฉัน',
      business_type: 'ecommerce',
      email: state.user?.email || 'demo@annypay.local'
    };

    state.merchant = {
      id: 'demo-merchant',
      business_name: profile.business_name || 'ร้านของฉัน',
      business_type: profile.business_type || 'ecommerce',
      merchant_status: 'PROFILE_CREATED',
      kyc_status: 'KYC_PENDING',
      payment_status: 'NOT_CONNECTED',
      role: 'OWNER'
    };
    state.merchants = [state.merchant];
    state.stores = readJson(STORAGE.stores, []);
    state.products = readJson(STORAGE.products, []);
    state.orders = readJson(STORAGE.orders, []);

    $('#onboarding').classList.add('hidden');
    $('#merchantWorkspace').classList.remove('hidden');
    renderMerchant();
    loadAll();
  }

  async function loadMerchants(preferred = null) {
    const { data: memberships, error } = await state.client
      .from('merchant_members')
      .select('merchant_id,role')
      .eq('user_id', state.user.id);

    if (error) return dbError(error);

    if (!memberships?.length) {
      state.merchants = [];
      state.merchant = null;
      $('#merchantWorkspace').classList.add('hidden');
      $('#onboarding').classList.remove('hidden');
      prefillOnboarding();
      return;
    }

    const ids = memberships.map(item => item.merchant_id);
    const { data, error: merchantError } = await state.client
      .from('merchants')
      .select('id,business_name,business_type,merchant_status,kyc_status,payment_status,created_at')
      .in('id', ids)
      .order('created_at');

    if (merchantError) return dbError(merchantError);

    state.merchants = (data || []).map(merchant => ({
      ...merchant,
      role: memberships.find(item => item.merchant_id === merchant.id)?.role
    }));

    const remembered = preferred || localStorage.getItem('annypay_merchant_id');
    state.merchant = state.merchants.find(merchant => merchant.id === remembered) || state.merchants[0];
    localStorage.setItem('annypay_merchant_id', state.merchant.id);
    $('#onboarding').classList.add('hidden');
    $('#merchantWorkspace').classList.remove('hidden');
    renderMerchant();
    await loadAll();
  }

  function prefillOnboarding() {
    const metadata = state.user?.user_metadata || {};
    $('#businessName').value = metadata.business_name || state.pendingRegistration?.business_name || '';
    $('#businessType').value = metadata.business_type || state.pendingRegistration?.business_type || 'ecommerce';
    $('#ownerName').value = metadata.display_name || state.pendingRegistration?.display_name || '';
    $('#ownerPhone').value = metadata.phone || state.pendingRegistration?.phone || '';
  }

  function renderMerchant() {
    $('#merchantSelect').innerHTML = state.merchants.map(merchant => `
      <option value="${esc(merchant.id)}" ${merchant.id === state.merchant.id ? 'selected' : ''}>${esc(merchant.business_name)}</option>
    `).join('');
    $('#merchantName').textContent = state.merchant.business_name;
    $('#merchantStatus').textContent = state.merchant.merchant_status;
    $('#kycStatus').textContent = state.merchant.kyc_status;
    $('#paymentStatus').textContent = state.merchant.payment_status;
  }

  async function onboard(event) {
    event.preventDefault();
    const button = $('#onboardSubmit');
    button.disabled = true;
    msg($('#onboardMessage'));

    try {
      if (state.demo) {
        loadDemoMerchant();
        return;
      }
      const { data, error } = await state.client.rpc('bootstrap_merchant', {
        p_business_name: $('#businessName').value.trim(),
        p_display_name: $('#ownerName').value.trim(),
        p_phone: $('#ownerPhone').value.trim(),
        p_business_type: $('#businessType').value
      });
      if (error) throw error;
      msg($('#onboardMessage'), 'สร้าง Merchant สำเร็จ', 'success');
      await loadMerchants(data);
    } catch (error) {
      msg($('#onboardMessage'), `สร้าง Merchant ไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function loadAll() {
    await Promise.all([dashboard(), stores(), products(), orders()]);
    settings();
  }

  function renderSetupProgress() {
    const steps = [
      { title: 'สมัครบัญชี', detail: 'ข้อมูลผู้ใช้และธุรกิจ', done: true },
      { title: 'สร้างร้าน', detail: 'ชื่อร้านและหน้าร้าน', done: state.stores.length > 0 },
      { title: 'เพิ่มสินค้า', detail: 'สินค้า ราคา และ Stock', done: state.products.length > 0 },
      { title: 'เปิด Payment', detail: 'ทำ KYC และเชื่อมบัญชี', done: state.merchant?.payment_status === 'ACTIVE' }
    ];
    const complete = steps.filter(step => step.done).length;
    const percent = Math.round((complete / steps.length) * 100);
    $('#setupProgressText').textContent = `ดำเนินการ ${complete} จาก ${steps.length} ขั้นตอน`;
    $('#setupPercent').textContent = `${percent}%`;
    $('#setupProgressBar').style.width = `${percent}%`;
    $('#setupChecklist').innerHTML = steps.map(step => `
      <div class="setup-item ${step.done ? 'done' : ''}">
        <span>${step.done ? '✓' : '•'}</span>
        <div><b>${esc(step.title)}</b><small>${esc(step.detail)}</small></div>
      </div>
    `).join('');
  }

  async function dashboard() {
    if (state.demo) {
      const start = todayStart();
      const todayOrders = state.orders.filter(order => new Date(order.created_at) >= start);
      const paid = todayOrders.filter(order => order.payment_status === 'PAID');
      const sales = paid.reduce((sum, order) => sum + Number(order.total || 0), 0);

      $('#metricSales').textContent = money.format(sales);
      $('#metricOrders').textContent = todayOrders.length;
      $('#metricPaid').textContent = paid.length;
      $('#metricStores').textContent = state.stores.length;
      $('#productCountText').textContent = `${state.products.length} สินค้า`;
      $('#recentOrdersBody').innerHTML = state.orders.length
        ? state.orders.slice(0, 6).map(order => orderRow(order, 4)).join('')
        : '<tr><td colspan="4" class="empty">ยังไม่มี Order — หลังเปิดขาย รายการจะปรากฏที่นี่</td></tr>';
      renderSetupProgress();
      return;
    }

    const id = state.merchant.id;
    const start = todayStart().toISOString();
    try {
      const [storeResult, productResult, orderResult, recentResult] = await Promise.all([
        state.client.from('stores').select('id', { count: 'exact', head: true }).eq('merchant_id', id),
        state.client.from('products').select('id', { count: 'exact', head: true }).eq('merchant_id', id),
        state.client.from('orders').select('id,total,payment_status,order_status').eq('merchant_id', id).gte('created_at', start),
        state.client.from('orders').select('order_no,total,payment_status,order_status,created_at').eq('merchant_id', id).order('created_at', { ascending: false }).limit(6)
      ]);
      [storeResult, productResult, orderResult, recentResult].forEach(result => {
        if (result.error) throw result.error;
      });

      const todayOrders = orderResult.data || [];
      const paid = todayOrders.filter(order => order.payment_status === 'PAID');
      const sales = paid.reduce((sum, order) => sum + Number(order.total || 0), 0);
      $('#metricSales').textContent = money.format(sales);
      $('#metricOrders').textContent = todayOrders.length;
      $('#metricPaid').textContent = paid.length;
      $('#metricStores').textContent = storeResult.count || 0;
      $('#productCountText').textContent = `${productResult.count || 0} สินค้า`;
      $('#recentOrdersBody').innerHTML = recentResult.data?.length
        ? recentResult.data.map(order => orderRow(order, 4)).join('')
        : '<tr><td colspan="4" class="empty">ยังไม่มี Order</td></tr>';
      renderSetupProgress();
    } catch (error) {
      dbError(error);
    }
  }

  function orderRow(order, columns = 5) {
    const core = `
      <td>${esc(order.order_no || order.id || '-')}</td>
      <td>${money.format(Number(order.total || 0))}</td>
      <td><span class="badge ${order.payment_status === 'PAID' ? '' : 'gray'}">${esc(order.payment_status || 'PENDING')}</span></td>
      <td>${esc(order.order_status || 'NEW')}</td>
    `;
    return columns === 4
      ? `<tr>${core}</tr>`
      : `<tr>${core}<td>${new Date(order.created_at).toLocaleString('th-TH')}</td></tr>`;
  }

  async function stores() {
    if (state.demo) {
      state.stores = readJson(STORAGE.stores, []);
      renderStores();
      return;
    }

    const { data, error } = await state.client
      .from('stores')
      .select('id,store_name,store_slug,status,domain,created_at')
      .eq('merchant_id', state.merchant.id)
      .order('created_at', { ascending: false });

    if (error) return dbError(error);
    state.stores = data || [];
    renderStores();
  }

  function renderStores() {
    $('#storesBody').innerHTML = state.stores.length
      ? state.stores.map(store => `
          <tr>
            <td>${esc(store.store_name)}</td>
            <td>${esc(store.store_slug)}</td>
            <td><span class="badge gray">${esc(store.status)}</span></td>
            <td>${esc(store.domain || '-')}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="empty">ยังไม่มีร้าน กด “สร้างร้าน” เพื่อเริ่มต้น</td></tr>';

    $('#productStore').innerHTML = state.stores.length
      ? state.stores.map(store => `<option value="${esc(store.id)}">${esc(store.store_name)}</option>`).join('')
      : '<option value="">กรุณาสร้างร้านก่อน</option>';
    $('#createProductBtn').disabled = !state.stores.length;
  }

  async function createStore(event) {
    event.preventDefault();
    const button = $('#createStoreBtn');
    button.disabled = true;
    msg($('#storeMessage'));

    try {
      const name = $('#storeName').value.trim();
      if (state.demo) {
        const store = {
          id: `store-${Date.now().toString(36)}`,
          store_name: name,
          store_slug: slug(name),
          description: $('#storeDescription').value.trim() || null,
          status: 'DRAFT',
          domain: null,
          created_at: new Date().toISOString()
        };
        state.stores.unshift(store);
        saveJson(STORAGE.stores, state.stores);
      } else {
        const { error } = await state.client.from('stores').insert({
          merchant_id: state.merchant.id,
          store_name: name,
          store_slug: slug(name),
          description: $('#storeDescription').value.trim() || null,
          status: 'DRAFT'
        });
        if (error) throw error;
      }

      event.currentTarget.reset();
      msg($('#storeMessage'), 'สร้างร้านแล้ว', 'success');
      await Promise.all([stores(), dashboard()]);
    } catch (error) {
      msg($('#storeMessage'), error.message || 'สร้างร้านไม่สำเร็จ', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function products() {
    if (state.demo) {
      state.products = readJson(STORAGE.products, []);
      renderProducts();
      return;
    }

    const { data, error } = await state.client
      .from('products')
      .select('id,product_name,sku,price,stock,status,created_at')
      .eq('merchant_id', state.merchant.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return dbError(error);
    state.products = data || [];
    renderProducts();
  }

  function renderProducts() {
    $('#productsBody').innerHTML = state.products.length
      ? state.products.map(product => `
          <tr>
            <td>${esc(product.product_name)}</td>
            <td>${esc(product.sku || '-')}</td>
            <td>${money.format(Number(product.price || 0))}</td>
            <td>${Number(product.stock || 0)}</td>
            <td><span class="badge gray">${esc(product.status || 'ACTIVE')}</span></td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" class="empty">ยังไม่มีสินค้า</td></tr>';
  }

  async function createProduct(event) {
    event.preventDefault();
    const button = $('#createProductBtn');
    button.disabled = true;
    msg($('#productMessage'));

    try {
      const storeId = $('#productStore').value;
      if (!storeId) throw new Error('กรุณาสร้างร้านก่อน');

      if (state.demo) {
        const product = {
          id: `product-${Date.now().toString(36)}`,
          store_id: storeId,
          product_name: $('#productName').value.trim(),
          sku: $('#productSku').value.trim() || null,
          price: Number($('#productPrice').value),
          stock: Number($('#productStock').value || 0),
          status: 'ACTIVE',
          created_at: new Date().toISOString()
        };
        state.products.unshift(product);
        saveJson(STORAGE.products, state.products);
      } else {
        const { error } = await state.client.from('products').insert({
          merchant_id: state.merchant.id,
          store_id: storeId,
          product_name: $('#productName').value.trim(),
          sku: $('#productSku').value.trim() || null,
          price: Number($('#productPrice').value),
          stock: Number($('#productStock').value || 0),
          status: 'ACTIVE'
        });
        if (error) throw error;
      }

      event.currentTarget.reset();
      msg($('#productMessage'), 'เพิ่มสินค้าแล้ว', 'success');
      await Promise.all([products(), dashboard()]);
    } catch (error) {
      msg($('#productMessage'), error.message || 'เพิ่มสินค้าไม่สำเร็จ', 'error');
    } finally {
      button.disabled = !state.stores.length;
    }
  }

  async function orders() {
    if (state.demo) {
      state.orders = readJson(STORAGE.orders, []);
      $('#ordersBody').innerHTML = state.orders.length
        ? state.orders.map(order => orderRow(order)).join('')
        : '<tr><td colspan="5" class="empty">ยังไม่มี Order — โหมดตัวอย่างจะไม่สร้างสถานะชำระเงินจริง</td></tr>';
      return;
    }

    const { data, error } = await state.client
      .from('orders')
      .select('order_no,total,payment_status,order_status,created_at')
      .eq('merchant_id', state.merchant.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return dbError(error);
    state.orders = data || [];
    $('#ordersBody').innerHTML = state.orders.length
      ? state.orders.map(order => orderRow(order)).join('')
      : '<tr><td colspan="5" class="empty">ยังไม่มี Order</td></tr>';
  }

  function settings() {
    const merchant = state.merchant;
    if (!merchant) return;
    $('#settingsEmail').textContent = state.user?.email || '-';
    $('#settingsMerchant').textContent = merchant.business_name;
    $('#settingsRole').textContent = merchant.role || '-';
    $('#settingsMerchantStatus').textContent = merchant.merchant_status;
    $('#settingsKyc').textContent = merchant.kyc_status;
    $('#settingsPayment').textContent = merchant.payment_status;
  }

  function go(view) {
    $$('.view').forEach(element => element.classList.toggle('active', element.id === `view-${view}`));
    $$('.nav button[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('#pageTitle').textContent = ({
      dashboard: 'Dashboard',
      stores: 'ร้านค้า',
      products: 'สินค้า',
      orders: 'Orders',
      settings: 'ตั้งค่า'
    }[view] || 'AnnyPay');
    $('#sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function dbError(error) {
    console.error(error);
    msg($('#globalMessage'), `Database: ${error.message || error}`, 'error');
  }

  async function logout() {
    if (state.demo || !state.client) {
      localStorage.removeItem(STORAGE.session);
      state.user = null;
      state.merchant = null;
      showAuth('login');
      return;
    }
    await state.client.auth.signOut();
  }

  function openModal(type) {
    const content = {
      terms: {
        title: 'ข้อกำหนดการใช้งาน',
        body: `
          <p>หน้านี้เป็นข้อความตัวอย่างสำหรับต้นแบบการสมัครใช้งาน AnnyPay ก่อนเปิดให้บริการจริง ควรให้ฝ่ายกฎหมายตรวจสอบและใส่ฉบับสมบูรณ์ก่อนใช้งานเชิงพาณิชย์</p>
          <h4>การเปิด Payment</h4><p>การสมัครบัญชีไม่ได้หมายความว่าร้านได้รับอนุมัติให้รับเงินจริงโดยอัตโนมัติ ผู้สมัครต้องผ่าน KYC การตรวจสอบธุรกิจ และเงื่อนไขของ Payment Provider</p>
          <h4>ข้อมูลที่ถูกต้อง</h4><p>ผู้สมัครต้องให้ข้อมูลจริงและไม่ใช้ระบบกับกิจกรรมผิดกฎหมาย หลอกลวง หรือสินค้าที่ผู้ให้บริการห้าม</p>
        `
      },
      privacy: {
        title: 'นโยบายความเป็นส่วนตัว',
        body: `
          <p>หน้านี้เป็นข้อความตัวอย่างสำหรับต้นแบบ ควรจัดทำนโยบายฉบับสมบูรณ์ให้สอดคล้องกับ PDPA และการประมวลผลข้อมูลจริงก่อนเปิดใช้งาน</p>
          <h4>ข้อมูลที่เก็บ</h4><p>ข้อมูลบัญชี ข้อมูลติดต่อ ข้อมูลธุรกิจ และบันทึกกิจกรรมที่จำเป็นต่อการให้บริการและความปลอดภัย</p>
          <h4>ข้อมูลสำคัญ</h4><p>AnnyPay จะไม่ขอ API Secret, Private Key, รหัส OTP หรือข้อมูลบัตรเต็มผ่านแบบฟอร์มสมัครนี้</p>
        `
      }
    }[type];
    if (!content) return;
    $('#modalTitle').textContent = content.title;
    $('#modalBody').innerHTML = content.body;
    $('#infoModal').classList.remove('hidden');
  }

  function closeModal() {
    $('#infoModal').classList.add('hidden');
  }

  function bind() {
    $('#configForm').addEventListener('submit', event => {
      event.preventDefault();
      const url = $('#configUrl').value.trim();
      const key = $('#configKey').value.trim();
      if (!url || !key) return msg($('#configMessage'), 'กรอก Project URL และ Anon Key', 'error');
      localStorage.setItem('annypay_supabase_url', url);
      localStorage.setItem('annypay_supabase_anon_key', key);
      location.href = location.pathname;
    });

    $('#clearConfig').addEventListener('click', () => {
      localStorage.removeItem('annypay_supabase_url');
      localStorage.removeItem('annypay_supabase_anon_key');
      location.href = location.pathname;
    });

    $('#signupTab').addEventListener('click', () => setAuthMode('signup'));
    $('#loginTab').addEventListener('click', () => setAuthMode('login'));
    $('#goSignup').addEventListener('click', () => setAuthMode('signup'));
    $('#signupNext').addEventListener('click', () => {
      if (validateCurrentSignupStep()) setSignupStep(state.signupStep + 1);
    });
    $('#signupBack').addEventListener('click', () => setSignupStep(state.signupStep - 1));
    $('#signupForm').addEventListener('submit', handleSignup);
    $('#loginForm').addEventListener('submit', handleLogin);
    $('#magicLinkBtn').addEventListener('click', sendMagicLink);
    $('#enterDashboard').addEventListener('click', enter);
    $('#successLogin').addEventListener('click', () => setAuthMode('login'));

    $$('.password-toggle').forEach(button => button.addEventListener('click', () => {
      const input = $(`#${button.dataset.target}`);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'แสดง' : 'ซ่อน';
    }));

    $$('input[name="startPlan"]').forEach(input => input.addEventListener('change', () => {
      $$('.plan-card').forEach(card => card.classList.toggle('selected', card.contains(input) && input.checked));
    }));

    $$('[data-modal]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      openModal(link.dataset.modal);
    }));
    $('#closeModal').addEventListener('click', closeModal);
    $('#infoModal').addEventListener('click', event => {
      if (event.target === $('#infoModal')) closeModal();
    });

    $('#onboardingForm').addEventListener('submit', onboard);
    $('#storeForm').addEventListener('submit', createStore);
    $('#productForm').addEventListener('submit', createProduct);
    $('#logoutBtn').addEventListener('click', logout);
    $('#merchantSelect').addEventListener('change', async event => {
      state.merchant = state.merchants.find(merchant => merchant.id === event.target.value);
      if (!state.merchant) return;
      localStorage.setItem('annypay_merchant_id', state.merchant.id);
      renderMerchant();
      await loadAll();
    });
    $$('.nav button[data-view]').forEach(button => button.addEventListener('click', () => go(button.dataset.view)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
    $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeModal();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    init();
  });
})();
