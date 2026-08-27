(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0});
  const state = { client:null, user:null, merchants:[], merchant:null, stores:[], products:[] };
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  const cfg = () => ({
    url: window.ANNYPAY_CONFIG?.SUPABASE_URL || localStorage.getItem('annypay_supabase_url') || '',
    key: window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY || localStorage.getItem('annypay_supabase_anon_key') || '',
    backend: window.ANNYPAY_CONFIG?.BACKEND_URL || location.origin
  });

  function notify(text, kind='') {
    const el = $('#boMessage');
    el.textContent = text || '';
    el.className = text ? `alert ${kind}`.trim() : 'hidden';
    if (text) setTimeout(()=>{ if(el.textContent===text) el.className='hidden'; }, 6000);
  }

  async function init() {
    const c = cfg();
    if (!c.url || !c.key) return failToHome('ยังไม่ได้ตั้งค่า Supabase กรุณาเชื่อม Database ที่หน้า Merchant Home ก่อน');
    try {
      state.client = window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      state.user = data.session?.user || null;
      if (!state.user) return failToHome('ยังไม่ได้ Login กำลังพากลับหน้า Merchant Home...');
      $('#dbDot').classList.add('ok'); $('#readyDb').textContent='READY';
      $('#boUserEmail').textContent = state.user.email || '';
      await loadMerchants();
      bind();
      $('#loadingScreen').classList.add('hidden'); $('#backoffice').classList.remove('hidden');
      await loadAll();
      probeBackend();
    } catch(e) { failToHome(e.message); }
  }

  function failToHome(text) {
    $('#loadingText').textContent = text;
    setTimeout(()=>location.href='index.html', 1800);
  }

  async function loadMerchants() {
    const {data:mm,error}=await state.client.from('merchant_members').select('merchant_id,role').eq('user_id',state.user.id);
    if(error) throw error;
    if(!mm?.length) return failToHome('ยังไม่มี Merchant กรุณาสร้าง Merchant ก่อน');
    const ids=mm.map(x=>x.merchant_id);
    const {data,error:e2}=await state.client.from('merchants').select('*').in('id',ids).order('created_at');
    if(e2) throw e2;
    state.merchants=(data||[]).map(m=>({...m,role:mm.find(x=>x.merchant_id===m.id)?.role}));
    const remembered=localStorage.getItem('annypay_merchant_id');
    state.merchant=state.merchants.find(m=>m.id===remembered)||state.merchants[0];
    localStorage.setItem('annypay_merchant_id',state.merchant.id);
    renderMerchantSwitch();
  }

  function renderMerchantSwitch(){
    $('#boMerchantSelect').innerHTML=state.merchants.map(m=>`<option value="${m.id}" ${m.id===state.merchant.id?'selected':''}>${esc(m.business_name)}</option>`).join('');
    $('#boMerchantName').textContent=state.merchant.business_name;
    if(state.merchant.payment_status==='ACTIVE'){$('#paymentDot').classList.add('ok');$('#readyPayment').textContent='ACTIVE'} else {$('#readyPayment').textContent=state.merchant.payment_status||'NOT_CONNECTED'}
  }

  async function loadAll(){
    await Promise.allSettled([loadDashboard(),loadStores(),loadProducts(),loadContent(),loadSalePages(),loadPayment(),loadWebhooks(),loadOrders(),loadAutomations(),loadAudit()]);
  }

  async function loadDashboard(){
    const id=state.merchant.id, now=new Date(), start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toISOString();
    const [stores,products,orders]=await Promise.all([
      state.client.from('stores').select('id',{count:'exact',head:true}).eq('merchant_id',id),
      state.client.from('products').select('id',{count:'exact',head:true}).eq('merchant_id',id),
      state.client.from('orders').select('id,total,payment_status').eq('merchant_id',id).gte('created_at',start)
    ]);
    [stores,products,orders].forEach(x=>{if(x.error)throw x.error});
    const rows=orders.data||[],paid=rows.filter(x=>x.payment_status==='PAID');
    $('#boSales').textContent=money.format(paid.reduce((s,x)=>s+Number(x.total||0),0));
    $('#boOrders').textContent=rows.length;$('#boStores').textContent=stores.count||0;$('#boProducts').textContent=products.count||0;
  }

  async function loadStores(){
    const {data,error}=await state.client.from('stores').select('*').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false});
    if(error)throw error;state.stores=data||[];
    $('#boStoresBody').innerHTML=state.stores.length?state.stores.map(s=>`<tr><td>${esc(s.store_name)}</td><td>${esc(s.store_slug)}</td><td>${esc(s.status)}</td><td>${esc(s.domain||'-')}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">ยังไม่มีร้าน</td></tr>';
    $('#boProductStore').innerHTML=state.stores.map(s=>`<option value="${s.id}">${esc(s.store_name)}</option>`).join('');
  }

  async function loadProducts(){
    const {data,error}=await state.client.from('products').select('id,store_id,product_name,price,stock,status,stores(store_name)').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false});
    if(error)throw error;state.products=data||[];
    $('#boProductsBody').innerHTML=state.products.length?state.products.map(p=>`<tr><td>${esc(p.product_name)}</td><td>${esc(p.stores?.store_name||'-')}</td><td>${money.format(Number(p.price||0))}</td><td>${p.stock}</td><td>${esc(p.status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มีสินค้า</td></tr>';
  }

  async function loadContent(){
    const {data,error}=await state.client.from('content_assets').select('id,content_type,content,status,ai_model,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(50);
    if(error){$('#boContentBody').innerHTML='<tr><td colspan="5" class="empty">รัน database/backoffice.sql เพื่อเปิด Content Studio</td></tr>';return}
    $('#boContentBody').innerHTML=data?.length?data.map(x=>`<tr><td>${esc(x.content_type)}</td><td style="max-width:380px;white-space:normal">${esc(x.content).slice(0,240)}</td><td>${esc(x.status)}</td><td>${esc(x.ai_model||'-')}</td><td>${new Date(x.created_at).toLocaleString('th-TH')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี Content Asset</td></tr>';
  }

  async function loadSalePages(){
    const {data,error}=await state.client.from('salepages').select('id,store_id,slug,headline,status,stores(store_slug)').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false});
    if(error)throw error;
    $('#boSalePagesBody').innerHTML=data?.length?data.map(x=>{const path=`sale.html?store=${encodeURIComponent(x.stores?.store_slug||'')}&page=${encodeURIComponent(x.slug)}`;return `<tr><td>${esc(x.headline||'-')}</td><td>${esc(x.slug)}</td><td>${esc(x.status)}</td><td>${x.status==='PUBLISHED'?`<a href="${path}" target="_blank">เปิดหน้า</a>`:'-'}</td></tr>`}).join(''):'<tr><td colspan="4" class="empty">ยังไม่มี SalePage</td></tr>';
  }

  async function loadPayment(){
    const [accounts,tx]=await Promise.all([
      state.client.from('payment_accounts').select('provider,status,payment_methods').eq('merchant_id',state.merchant.id),
      state.client.from('payment_transactions').select('id,provider,provider_transaction_id,order_id,amount,status,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(50)
    ]);
    if(accounts.error)throw accounts.error;if(tx.error)throw tx.error;
    $('#boPaymentAccounts').innerHTML=accounts.data?.length?accounts.data.map(a=>`<div class="item"><span>${esc(a.provider)}</span><b>${esc(a.status)}</b></div>`).join(''):'ยังไม่มี Payment Provider ที่ ACTIVE';
    $('#boPaymentsBody').innerHTML=tx.data?.length?tx.data.map(x=>`<tr><td>${esc(x.provider)}</td><td class="code">${esc(x.provider_transaction_id||x.id)}</td><td class="code">${esc(x.order_id||'-')}</td><td>${money.format(Number(x.amount||0))}</td><td>${esc(x.status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี Transaction</td></tr>';
  }

  async function loadWebhooks(){
    const [ep,del,inb]=await Promise.all([
      state.client.from('webhook_endpoints').select('id,name,url,subscribed_events,status,failure_count').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}),
      state.client.from('webhook_deliveries').select('id,event_type,endpoint_id,attempt,status,response_status,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(30),
      state.client.from('inbound_events').select('id',{count:'exact',head:true}).eq('merchant_id',state.merchant.id)
    ]);
    if(ep.error){$('#boWebhookBody').innerHTML='<tr><td colspan="5" class="empty">รัน database/backoffice.sql เพื่อเปิด Webhook Manager</td></tr>';return}
    $('#boInboundCount').textContent=inb.count||0;
    $('#boWebhookBody').innerHTML=ep.data?.length?ep.data.map(x=>`<tr><td>${esc(x.name)}</td><td class="code">${esc(x.url)}</td><td>${esc((x.subscribed_events||[]).join(', '))}</td><td>${esc(x.status)}</td><td>${x.failure_count||0}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี Webhook OUT Endpoint</td></tr>';
    const names=Object.fromEntries((ep.data||[]).map(x=>[x.id,x.name]));
    $('#boDeliveryBody').innerHTML=del.data?.length?del.data.map(x=>`<tr><td>${esc(x.event_type)}</td><td>${esc(names[x.endpoint_id]||x.endpoint_id)}</td><td>${x.attempt}</td><td>${esc(x.status)}</td><td>${x.response_status||'-'}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี Delivery</td></tr>';
    if(ep.data?.some(x=>x.status==='ACTIVE')){$('#readyWebhook').textContent='ACTIVE'}else{$('#readyWebhook').textContent='NOT_CONFIGURED'}
  }

  async function loadOrders(){
    const {data,error}=await state.client.from('orders').select('order_no,total,payment_status,order_status,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;
    $('#boOrdersBody').innerHTML=data?.length?data.map(x=>`<tr><td>${esc(x.order_no)}</td><td>${money.format(Number(x.total||0))}</td><td>${esc(x.payment_status)}</td><td>${esc(x.order_status)}</td><td>${new Date(x.created_at).toLocaleString('th-TH')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี Order</td></tr>';
  }

  async function loadAutomations(){
    const {data,error}=await state.client.from('automation_rules').select('*').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false});
    if(error){$('#boAutomationBody').innerHTML='<tr><td colspan="4" class="empty">รัน database/backoffice.sql เพื่อเปิด Automation</td></tr>';return}
    $('#boAutomationBody').innerHTML=data?.length?data.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.trigger_event)}</td><td>${esc(x.status)}</td><td class="code">${esc(JSON.stringify(x.actions))}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">ยังไม่มี Automation</td></tr>';
  }

  async function loadAudit(){
    const {data,error}=await state.client.from('ai_actions').select('created_at,intent,prompt,target,status').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;
    $('#boAuditBody').innerHTML=data?.length?data.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('th-TH')}</td><td>${esc(x.intent||'-')}</td><td style="max-width:420px;white-space:normal">${esc(x.prompt||'-')}</td><td class="code">${esc(x.target||'-')}</td><td>${esc(x.status)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี AI Action</td></tr>';
  }

  async function createStore(e){e.preventDefault();const {error}=await state.client.from('stores').insert({merchant_id:state.merchant.id,store_name:$('#boStoreName').value.trim(),store_slug:slug($('#boStoreName').value),description:$('#boStoreDescription').value.trim()||null,status:'DRAFT'});if(error)return notify(error.message,'error');e.target.reset();notify('สร้างร้านแล้ว','success');await Promise.all([loadStores(),loadDashboard()])}
  async function createProduct(e){e.preventDefault();if(!$('#boProductStore').value)return notify('กรุณาสร้างร้านก่อน','error');const {error}=await state.client.from('products').insert({merchant_id:state.merchant.id,store_id:$('#boProductStore').value,product_name:$('#boProductName').value.trim(),price:Number($('#boProductPrice').value),stock:Number($('#boProductStock').value||0),status:'DRAFT'});if(error)return notify(error.message,'error');e.target.reset();notify('เพิ่มสินค้าแล้ว','success');await Promise.all([loadProducts(),loadDashboard()])}
  async function createAutomation(e){e.preventDefault();const record={merchant_id:state.merchant.id,name:$('#autoName').value.trim(),trigger_event:$('#autoEvent').value,conditions:{},actions:[{type:'WEBHOOK_OUT'}],status:'ACTIVE',created_by:state.user.id};const {error}=await state.client.from('automation_rules').insert(record);if(error)return notify(error.message,'error');e.target.reset();notify('สร้าง Automation แล้ว','success');loadAutomations()}

  async function sendAi(){const prompt=$('#aiPrompt').value.trim();if(!prompt)return;appendAi(prompt,'user');$('#aiPrompt').value='';try{const result=await postApi('/api/ai/command',{merchantId:state.merchant.id,prompt});appendAi(JSON.stringify(result,null,2),'ai');$('#aiDot').classList.add('ok');$('#readyAi').textContent='READY';await Promise.allSettled([loadStores(),loadProducts(),loadContent(),loadSalePages(),loadAudit(),loadDashboard()])}catch(e){appendAi(`AI Backend ยังไม่พร้อม: ${e.message}\n\nโครง Router/Skill/Service อยู่ใน server/ แล้ว ต้อง Deploy Backend runtime และตั้ง AI Provider ก่อน`,'ai')}}
  function appendAi(text,kind){const d=document.createElement('div');d.className=`ai-msg ${kind}`;d.textContent=text;$('#aiLog').appendChild(d);$('#aiLog').scrollTop=$('#aiLog').scrollHeight}

  async function postApi(path,body){const {data}=await state.client.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error('Session expired');const base=cfg().backend.replace(/\/$/,'');const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify(body)});const text=await r.text();let parsed;try{parsed=JSON.parse(text)}catch{parsed={message:text}}if(!r.ok)throw new Error(parsed.error||parsed.message||`HTTP ${r.status}`);return parsed}

  async function probeBackend(){try{const base=cfg().backend.replace(/\/$/,'');const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(2500)});if(r.ok){$('#aiDot').classList.add('ok');$('#readyAi').textContent='BACKEND READY'}else throw new Error()}catch{$('#readyAi').textContent='DEPLOY REQUIRED'}}

  function bind(){
    $$('.nav button[data-bo-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.boView)));
    $('#boMobileMenu').addEventListener('click',()=>$('#boSidebar').classList.toggle('open'));
    $('#boMerchantSelect').addEventListener('change',async e=>{state.merchant=state.merchants.find(x=>x.id===e.target.value);localStorage.setItem('annypay_merchant_id',state.merchant.id);renderMerchantSwitch();await loadAll()});
    $('#boStoreForm').addEventListener('submit',createStore);$('#boProductForm').addEventListener('submit',createProduct);$('#automationForm').addEventListener('submit',createAutomation);
    $('#aiSend').addEventListener('click',sendAi);$('#aiPrompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAi()}});
    $$('.quickPrompt').forEach(b=>b.addEventListener('click',()=>{$('#aiPrompt').value=b.dataset.prompt;sendAi()}));
    $('#contentGenerateBtn').addEventListener('click',()=>{go('ai');$('#aiPrompt').value='สร้างคอนเทนต์สำหรับสินค้าที่ฉันเลือก โดยยึดข้อมูลสินค้าจริง ห้ามสร้างรีวิวหรือ claim ที่ไม่มีข้อมูล';$('#aiPrompt').focus()});
    $('#newWebhookBtn').addEventListener('click',()=>{const name=prompt('ชื่อ Endpoint เช่น CRM');if(!name)return;const url=prompt('HTTPS Webhook URL');if(!url)return;postApi('/api/webhooks/out',{merchantId:state.merchant.id,name,url,events:['order.created','payment.paid']}).then(()=>{notify('สร้าง Webhook Endpoint แล้ว Secret จะแสดงเพียงครั้งเดียว','success');loadWebhooks()}).catch(e=>notify(`ต้อง Deploy Backend API ก่อน: ${e.message}`,'error'))});
  }

  function go(v){$$('.view').forEach(x=>x.classList.toggle('active',x.id===`bo-${v}`));$$('.nav button[data-bo-view]').forEach(x=>x.classList.toggle('active',x.dataset.boView===v));$('#boTitle').textContent=({ai:'AI Home',dashboard:'Dashboard',stores:'ร้านค้า',products:'สินค้า',content:'Content Studio',salepages:'SalePage',sales:'Online Sales',payment:'Payment',webhooks:'Webhook & Integrations',orders:'Orders',automations:'Automations',audit:'AI Action Log'}[v]||'AnnyPay');$('#boSidebar').classList.remove('open')}
  function slug(v){return String(v||'').toLowerCase().trim().normalize('NFKD').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||`store-${Date.now().toString(36)}`}

  document.addEventListener('DOMContentLoaded',init);
})();
