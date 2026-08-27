(() => {
  const $ = selector => document.querySelector(selector);
  const state = { client:null, user:null, merchantId:null, merchants:[], stores:[], logs:[], sessions:[] };
  const cfg = () => ({
    url: window.ANNYPAY_CONFIG?.SUPABASE_URL || localStorage.getItem('annypay_supabase_url') || '',
    key: window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY || localStorage.getItem('annypay_supabase_anon_key') || '',
    backend: (window.ANNYPAY_CONFIG?.BACKEND_URL || location.origin).replace(/\/$/, '')
  });

  async function init() {
    const c = cfg();
    if (!c.url || !c.key) return show('ยังไม่ได้ตั้งค่า Supabase', 'error');
    state.client = window.supabase.createClient(c.url, c.key, { auth:{ persistSession:true, autoRefreshToken:true } });
    const { data, error } = await state.client.auth.getSession();
    if (error) return show(error.message, 'error');
    state.user = data.session?.user;
    if (!state.user) { location.href = 'index.html'; return; }

    const { data: memberships, error: memberError } = await state.client
      .from('merchant_members').select('merchant_id,role').eq('user_id', state.user.id);
    if (memberError) return show(memberError.message, 'error');
    if (!memberships?.length) return show('บัญชีนี้ยังไม่มี Merchant', 'error');

    const ids = memberships.map(row => row.merchant_id);
    const { data: merchants, error: merchantError } = await state.client
      .from('merchants').select('id,business_name').in('id', ids).order('business_name');
    if (merchantError) return show(merchantError.message, 'error');

    state.merchants = merchants || [];
    const remembered = localStorage.getItem('annypay_merchant_id');
    state.merchantId = state.merchants.find(m => m.id === remembered)?.id || state.merchants[0].id;
    $('#merchantSelect').innerHTML = state.merchants.map(m => `<option value="${m.id}">${esc(m.business_name)}</option>`).join('');
    $('#merchantSelect').value = state.merchantId;

    bind();
    await loadStores();
    await loadAll();
  }

  function bind() {
    $('#merchantSelect').addEventListener('change', async event => {
      state.merchantId = event.target.value;
      localStorage.setItem('annypay_merchant_id', state.merchantId);
      await loadStores();
      await loadAll();
    });
    $('#refreshBtn').addEventListener('click', loadAll);
    $('#filterForm').addEventListener('submit', event => { event.preventDefault(); loadLogs(); });
    $('#exportBtn').addEventListener('click', exportCsv);
    document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
    $('#closeDetail').addEventListener('click', () => $('#detailModal').classList.add('hidden'));
    $('#detailModal').addEventListener('click', event => { if (event.target === $('#detailModal')) $('#detailModal').classList.add('hidden'); });
  }

  async function api(path) {
    const { data } = await state.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Unauthorized');
    const response = await fetch(cfg().backend + path, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-annypay-session': window.ANNYPAY_ACTIVITY?.sessionKey || sessionStorage.getItem('annypay_activity_session') || ''
      }
    });
    const text = await response.text();
    let output = {};
    try { output = text ? JSON.parse(text) : {}; } catch { output = { message:text }; }
    if (!response.ok) throw new Error(output.message || output.error || `HTTP ${response.status}`);
    return output;
  }

  async function loadStores() {
    const { data, error } = await state.client.from('stores')
      .select('id,store_name').eq('merchant_id', state.merchantId).order('store_name');
    if (error) return show(error.message, 'error');
    state.stores = data || [];
    $('#storeFilter').innerHTML = '<option value="">ทุกร้าน</option>' + state.stores.map(s => `<option value="${s.id}">${esc(s.store_name)}</option>`).join('');
  }

  async function loadAll() {
    show('');
    try {
      await Promise.all([loadLogs(), loadSessions()]);
    } catch (error) {
      show(error.message, 'error');
    }
  }

  async function loadLogs() {
    const query = new URLSearchParams({ merchantId:state.merchantId, limit:'250' });
    const values = {
      storeId: $('#storeFilter').value,
      sourceArea: $('#sourceFilter').value,
      severity: $('#severityFilter').value,
      eventName: $('#eventFilter').value.trim(),
      from: toIso($('#fromFilter').value),
      to: toIso($('#toFilter').value)
    };
    Object.entries(values).forEach(([key, value]) => { if (value) query.set(key, value); });

    const output = await api(`/api/logs?${query}`);
    state.logs = output.logs || [];
    renderLogs();
    updateSummary();
  }

  async function loadSessions() {
    const output = await api(`/api/sessions?merchantId=${encodeURIComponent(state.merchantId)}&limit=250`);
    state.sessions = output.sessions || [];
    renderSessions();
    updateSummary();
  }

  function renderLogs() {
    $('#logsBody').innerHTML = state.logs.length
      ? state.logs.map((log, index) => {
          const actor = log.actor_email_snapshot || log.actor_user_id || log.actor_type;
          const store = state.stores.find(s => s.id === log.store_id)?.store_name || log.store_id || '-';
          const result = log.success == null ? '-' : log.success ? 'SUCCESS' : 'FAILED';
          return `<tr>
            <td>${formatTime(log.occurred_at)}</td>
            <td><div>${esc(log.source_area)}</div><div class="sev-${esc(log.severity)}">${esc(log.severity)}</div></td>
            <td class="event">${esc(log.event_name)}</td>
            <td class="who"><b>${esc(actor)}</b><div class="muted">${esc(log.actor_type)}</div>${log.session_key ? `<small class="muted">Session ${esc(log.session_key.slice(0,8))}…</small>` : ''}</td>
            <td><div>${esc(store)}</div><small class="muted">${esc(log.resource_type || '')} ${esc(log.resource_id || '')}</small></td>
            <td class="route"><div>${esc(log.http_method || '')} ${esc(log.route || '-')}</div><small>${esc(result)} ${log.http_status || ''} ${log.duration_ms != null ? `· ${log.duration_ms} ms` : ''}</small></td>
            <td class="detail"><div>${esc(log.message || log.action || '-')}</div><button class="btn" style="margin-top:6px" data-detail="${index}">ดู JSON</button></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="empty">ไม่พบ Log ตามตัวกรอง</td></tr>';

    document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => openDetail(Number(button.dataset.detail))));
  }

  function renderSessions() {
    $('#sessionsBody').innerHTML = state.sessions.length
      ? state.sessions.map(session => {
          const store = state.stores.find(s => s.id === session.store_id)?.store_name || session.store_id || '-';
          return `<tr>
            <td>${formatTime(session.login_at)}</td>
            <td><b>${esc(session.email_snapshot || session.user_id)}</b><div class="muted">${esc(session.user_id)}</div></td>
            <td>${esc(store)}</td>
            <td>${esc(session.login_source || '-')}</td>
            <td>${formatTime(session.last_seen_at)}</td>
            <td>${session.logout_at ? formatTime(session.logout_at) : '-'}</td>
            <td class="session-${esc(String(session.status || '').toLowerCase())}">${esc(session.status)}</td>
            <td>${esc((session.user_agent || '-').slice(0,100))}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="8" class="empty">ยังไม่มี Session Log</td></tr>';
  }

  function updateSummary() {
    $('#logCount').textContent = state.logs.length;
    $('#errorCount').textContent = state.logs.filter(log => ['WARN','ERROR','CRITICAL'].includes(log.severity)).length;
    const active = state.sessions.filter(session => session.status === 'ACTIVE');
    $('#activeSessions').textContent = active.length;
    const latest = [...state.sessions].sort((a,b) => new Date(b.login_at) - new Date(a.login_at))[0];
    $('#lastLogin').textContent = latest ? `${latest.email_snapshot || latest.user_id} · ${formatTime(latest.login_at)}` : '-';
  }

  function switchTab(tab) {
    document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $('#logsTab').classList.toggle('hidden', tab !== 'logs');
    $('#sessionsTab').classList.toggle('hidden', tab !== 'sessions');
  }

  function openDetail(index) {
    const log = state.logs[index];
    if (!log) return;
    $('#detailTitle').textContent = `${log.event_name} · ${formatTime(log.occurred_at)}`;
    $('#detailJson').textContent = JSON.stringify(log, null, 2);
    $('#detailModal').classList.remove('hidden');
  }

  function exportCsv() {
    if (!state.logs.length) return show('ไม่มี Log สำหรับ Export', 'error');
    const headers = ['occurred_at','event_name','severity','source_area','actor_type','actor_user_id','actor_email','merchant_id','store_id','request_id','route','http_method','http_status','success','resource_type','resource_id','message'];
    const rows = state.logs.map(log => [
      log.occurred_at, log.event_name, log.severity, log.source_area, log.actor_type,
      log.actor_user_id, log.actor_email_snapshot, log.merchant_id, log.store_id,
      log.request_id, log.route, log.http_method, log.http_status, log.success,
      log.resource_type, log.resource_id, log.message
    ]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annypay-activity-logs-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    window.ANNYPAY_ACTIVITY?.log('CUSTOM.EXPORT_ACTIVITY_LOGS', { sourceArea:'BACKOFFICE', metadata:{ rows:state.logs.length } });
  }

  function show(text, kind='') { const el=$('#message');el.textContent=text||'';el.className=text?`alert ${kind}`.trim():'hidden'; }
  function toIso(value) { if (!value) return ''; const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toISOString(); }
  function formatTime(value) { if (!value) return '-'; return new Date(value).toLocaleString('th-TH'); }
  function csvCell(value) { const text=value==null?'':String(value);return `"${text.replace(/"/g,'""')}"`; }
  function esc(value) { return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }

  document.addEventListener('DOMContentLoaded', init);
})();
