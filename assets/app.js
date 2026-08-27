(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const fmtMoney = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
  const state = { client: null, user: null, merchants: [], merchant: null, stores: [] };

  function getConfig() {
    const fileCfg = window.ANNYPAY_CONFIG || {};
    return {
      url: fileCfg.SUPABASE_URL || localStorage.getItem('annypay_supabase_url') || '',
      key: fileCfg.SUPABASE_ANON_KEY || localStorage.getItem('annypay_supabase_anon_key') || ''
    };
  }

  function setMessage(el, message = '', type = '') {
    if (!el) return;
    el.textContent = message;
    el.className = message ? `alert ${type}`.trim() : 'hidden';
  }

  function show(root) {
    ['#configScreen', '#authScreen', '#appScreen'].forEach(id => $(id)?.classList.add('hidden'));
    $(root)?.classList.remove('hidden');
  }

  function safeText(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  function slugify(value) {
    const ascii = value.toLowerCase().trim().normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return ascii || `store-${Date.now().toString(36)}`;
  }

  async function initClient() {
    const cfg = getConfig();
    if (!cfg.url || !cfg.key) {
      show('#configScreen');
      return;
    }
    try {
      state.client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      state.user = data.session?.user || null;
      state.client.auth.onAuthStateChange((_event, session) => {
        state.user = session?.user || null;
        if (state.user) enterApp(); else show('#authScreen');
      });
      if (state.user) await enterApp(); else show('#authScreen');
    } catch (err) {
      show('#configScreen');
      setMessage($('#configMessage'), `เชื่อม Supabase ไม่สำเร็จ: ${err.message}`, 'error');
    }
  }

  function bindAuthTabs() {
    $$('.auth-tab').forEach(btn => btn.addEventListener('click', () => {
      $$('.auth-tab').forEach(x => x.classList.toggle('active', x === btn));
      const signup = btn.dataset.mode === 'signup';
      $('#signupFields').classList.toggle('hidden', !signup);
      $('#authSubmit').textContent = signup ? 'สร้างบัญชี AnnyPay' : 'เข้าสู่ระบบ';
      $('#authForm').dataset.mode = signup ? 'signup' : 'login';
      setMessage($('#authMessage'));
    }));
  }

  async function submitAuth(e) {
    e.preventDefault();
    if (!state.client) return;
    const form = e.currentTarget;
    const mode = form.dataset.mode || 'login';
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const button = $('#authSubmit');
    button.disabled = true;
    setMessage($('#authMessage'));
    try {
      if (mode === 'signup') {
        const displayName = $('#signupName').value.trim();
        const phone = $('#signupPhone').value.trim();
        const { data, error } = await state.client.auth.signUp({
          email, password,
          options: { data: { display_name: displayName, phone } }
        });
        if (error) throw error;
        if (!data.session) {
          setMessage($('#authMessage'), 'สร้างบัญชีแล้ว กรุณายืนยันอีเมล แล้วกลับมาเข้าสู่ระบบ', 'success');
        } else {
          state.user = data.user;
          await enterApp();
        }
      } else {
        const { data, error } = await state.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        state.user = data.user;
        await enterApp();
      }
    } catch (err) {
      setMessage($('#authMessage'), err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function enterApp() {
    if (!state.user) return show('#authScreen');
    show('#appScreen');
    $('#userEmail').textContent = state.user.email || 'AnnyPay user';
    await loadMerchants();
  }

  async function loadMerchants(preferredId = null) {
    const { data: memberships, error: memberError } = await state.client
      .from('merchant_members').select('merchant_id, role').eq('user_id', state.user.id);
    if (memberError) return showDbError(memberError);

    if (!memberships?.length) {
      state.merchants = [];
      state.merchant = null;
      $('#merchantWorkspace').classList.add('hidden');
      $('#onboarding').classList.remove('hidden');
      return;
    }

    const ids = memberships.map(x => x.merchant_id);
    const { data: merchants, error } = await state.client.from('merchants')
      .select('id,business_name,business_type,merchant_status,kyc_status,payment_status,created_at')
      .in('id', ids).order('created_at');
    if (error) return showDbError(error);

    state.merchants = (merchants || []).map(m => ({ ...m, role: memberships.find(x => x.merchant_id === m.id)?.role }));
    const remembered = preferredId || localStorage.getItem('annypay_merchant_id');
    state.merchant = state.merchants.find(m => m.id === remembered) || state.merchants[0];
    localStorage.setItem('annypay_merchant_id', state.merchant.id);
    $('#onboarding').classList.add('hidden');
    $('#merchantWorkspace').classList.remove('hidden');
    renderMerchantSelector();
    await loadAll();
  }

  function renderMerchantSelector() {
    const select = $('#merchantSelect');
    select.innerHTML = state.merchants.map(m => `<option value="${m.id}" ${m.id === state.merchant.id ? 'selected' : ''}>${safeText(m.business_name)}</option>`).join('');
    $('#merchantName').textContent = state.merchant.business_name;
    $('#merchantStatus').textContent = state.merchant.merchant_status;
    $('#kycStatus').textContent = state.merchant.kyc_status;
    $('#paymentStatus').textContent = state.merchant.payment_status;
  }

  async function bootstrapMerchant(e) {
    e.preventDefault();
    const btn = $('#onboardSubmit');
    btn.disabled = true;
    setMessage($('#onboardMessage'));
    try {
      const { data, error } = await state.client.rpc('bootstrap_merchant', {
        p_business_name: $('#businessName').value.trim(),
        p_display_name: $('#ownerName').value.trim(),
        p_phone: $('#ownerPhone').value.trim(),
        p_business_type: $('#businessType').value
      });
      if (error) throw error;
      setMessage($('#onboardMessage'), 'สร้าง Merchant สำเร็จ กำลังเปิด Dashboard…', 'success');
      await loadMerchants(data);
    } catch (err) {
      setMessage($('#onboardMessage'), `สร้าง Merchant ไม่สำเร็จ: ${err.message}`, 'error');
    } finally { btn.disabled = false; }
  }

  async function loadAll() {
    await Promise.all([loadDashboard(), loadStores(), loadProducts(), loadOrders()]);
    renderSettings();
  }

  async function loadDashboard() {
    const merchantId = state.merchant.id;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    try {
      const [storesRes, productsRes, ordersRes, recentRes] = await Promise.all([
        state.client.from('stores').select('id', { count: 'exact', head: true }).eq('merchant_id', merchantId),
        state.client.from('products').select('id', { count: 'exact', head: true }).eq('merchant_id', merchantId),
        state.client.from('orders').select('id,total,payment_status,order_status').eq('merchant_id', merchantId).gte('created_at', start),
        state.client.from('orders').select('order_no,total,payment_status,order_status,created_at').eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(6)
      ]);
      [storesRes, productsRes, ordersRes, recentRes].forEach(r => { if (r.error) throw r.error; });
      const today = ordersRes.data || [];
      const paid = today.filter(o => o.payment_status === 'PAID');
      const sales = paid.reduce((sum, o) => sum + Number(o.total || 0), 0);
      $('#metricSales').textContent = fmtMoney.format(sales);
      $('#metricOrders').textContent = String(today.length);
      $('#metricPaid').textContent = String(paid.length);
      $('#metricStores').textContent = String(storesRes.count || 0);
      $('#productCountText').textContent = `${productsRes.count || 0} สินค้า`;
      renderRecentOrders(recentRes.data || []);
    } catch (err) { showDbError(err); }
  }

  function renderRecentOrders(rows) {
    const body = $('#recentOrdersBody');
    body.innerHTML = rows.length ? rows.map(o => `<tr><td>${safeText(o.order_no)}</td><td>${fmtMoney.format(Number(o.total || 0))}</td><td><span class="badge ${o.payment_status === 'PAID' ? '' : 'gray'}">${safeText(o.payment_status)}</span></td><td>${safeText(o.order_status)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">ยังไม่มี Order</td></tr>';
  }

  async function loadStores() {
    const { data, error } = await state.client.from('stores')
      .select('id,store_name,store_slug,status,domain,created_at').eq('merchant_id', state.merchant.id)
      .order('created_at', { ascending: false });
    if (error) return showDbError(error);
    state.stores = data || [];
    $('#storesBody').innerHTML = state.stores.length ? state.stores.map(s => `<tr><td>${safeText(s.store_name)}</td><td>${safeText(s.store_slug)}</td><td><span class="badge gray">${safeText(s.status)}</span></td><td>${safeText(s.domain || '-')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">ยังไม่มีร้าน — สร้างร้านแรกได้ด้านบน</td></tr>';
    const select = $('#productStore');
    select.innerHTML = state.stores.length ? state.stores.map(s => `<option value="${s.id}">${safeText(s.store_name)}</option>`).join('') : '<option value="">กรุณาสร้างร้านก่อน</option>';
    $('#createProductBtn').disabled = !state.stores.length;
  }

  async function createStore(e) {
    e.preventDefault();
    const name = $('#storeName').value.trim();
    if (!name) return;
    const btn = $('#createStoreBtn'); btn.disabled = true;
    setMessage($('#storeMessage'));
    try {
      const { error } = await state.client.from('stores').insert({
        merchant_id: state.merchant.id, store_name: name, store_slug: slugify(name),
        description: $('#storeDescription').value.trim() || null, status: 'DRAFT'
      });
      if (error) throw error;
      e.currentTarget.reset();
      setMessage($('#storeMessage'), 'สร้างร้านแล้ว', 'success');
      await Promise.all([loadStores(), loadDashboard()]);
    } catch (err) { setMessage($('#storeMessage'), err.message, 'error'); }
    finally { btn.disabled = false; }
  }

  async function loadProducts() {
    const { data, error } = await state.client.from('products')
      .select('id,product_name,sku,price,stock,status,store_id,created_at').eq('merchant_id', state.merchant.id)
      .order('created_at', { ascending: false }).limit(100);
    if (error) return showDbError(error);
    $('#productsBody').innerHTML = data?.length ? data.map(p => `<tr><td>${safeText(p.product_name)}</td><td>${safeText(p.sku || '-')}</td><td>${fmtMoney.format(Number(p.price || 0))}</td><td>${p.stock}</td><td><span class="badge gray">${safeText(p.status)}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty">ยังไม่มีสินค้า</td></tr>';
  }

  async function createProduct(e) {
    e.preventDefault();
    const btn = $('#createProductBtn'); btn.disabled = true;
    setMessage($('#productMessage'));
    try {
      const storeId = $('#productStore').value;
      if (!storeId) throw new Error('กรุณาสร้างร้านก่อนเพิ่มสินค้า');
      const { error } = await state.client.from('products').insert({
        merchant_id: state.merchant.id, store_id: storeId,
        product_name: $('#productName').value.trim(), sku: $('#productSku').value.trim() || null,
        price: Number($('#productPrice').value), stock: Number($('#productStock').value || 0), status: 'ACTIVE'
      });
      if (error) throw error;
      e.currentTarget.reset();
      setMessage($('#productMessage'), 'เพิ่มสินค้าแล้ว', 'success');
      await Promise.all([loadProducts(), loadDashboard()]);
    } catch (err) { setMessage($('#productMessage'), err.message, 'error'); }
    finally { btn.disabled = !state.stores.length; }
  }

  async function loadOrders() {
    const { data, error } = await state.client.from('orders')
      .select('order_no,total,payment_status,order_status,created_at').eq('merchant_id', state.merchant.id)
      .order('created_at', { ascending: false }).limit(100);
    if (error) return showDbError(error);
    $('#ordersBody').innerHTML = data?.length ? data.map(o => `<tr><td>${safeText(o.order_no)}</td><td>${fmtMoney.format(Number(o.total || 0))}</td><td><span class="badge ${o.payment_status === 'PAID' ? '' : 'gray'}">${safeText(o.payment_status)}</span></td><td>${safeText(o.order_status)}</td><td>${new Date(o.created_at).toLocaleString('th-TH')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">ยังไม่มี Order</td></tr>';
  }

  function renderSettings() {
    $('#settingsEmail').textContent = state.user.email || '-';
    $('#settingsMerchant').textContent = state.merchant.business_name;
    $('#settingsRole').textContent = state.merchant.role || '-';
    $('#settingsMerchantStatus').textContent = state.merchant.merchant_status;
    $('#settingsKyc').textContent = state.merchant.kyc_status;
    $('#settingsPayment').textContent = state.merchant.payment_status;
  }

  function go(view) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#pageTitle').textContent = ({dashboard:'Dashboard',stores:'ร้านค้า',products:'สินค้า',orders:'Orders',settings:'ตั้งค่า'}[view] || 'AnnyPay');
    $('#sidebar').classList.remove('open');
  }

  function showDbError(err) {
    console.error(err);
    setMessage($('#globalMessage'), `Database: ${err.message || err}`, 'error');
  }

  async function signOut() {
    await state.client?.auth.signOut();
    state.user = null; state.merchant = null; state.merchants = [];
    show('#authScreen');
  }

  function bind() {
    $('#configForm').addEventListener('submit', e => {
      e.preventDefault();
      const url = $('#configUrl').value.trim();
      const key = $('#configKey').value.trim();
      if (!url || !key) return setMessage($('#configMessage'), 'กรอก Project URL และ Anon Key', 'error');
      localStorage.setItem('annypay_supabase_url', url);
      localStorage.setItem('annypay_supabase_anon_key', key);
      location.reload();
    });
    $('#clearConfig').addEventListener('click', () => { localStorage.removeItem('annypay_supabase_url'); localStorage.removeItem('annypay_supabase_anon_key'); location.reload(); });
    bindAuthTabs();
    $('#authForm').addEventListener('submit', submitAuth);
    $('#onboardingForm').addEventListener('submit', bootstrapMerchant);
    $('#storeForm').addEventListener('submit', createStore);
    $('#productForm').addEventListener('submit', createProduct);
    $('#logoutBtn').addEventListener('click', signOut);
    $('#merchantSelect').addEventListener('change', async e => {
      state.merchant = state.merchants.find(m => m.id === e.target.value);
      localStorage.setItem('annypay_merchant_id', state.merchant.id);
      renderMerchantSelector(); await loadAll();
    });
    $$('.nav button[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
    $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); initClient(); });
})();
