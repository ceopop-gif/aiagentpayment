(() => {
  const $ = s => document.querySelector(s);
  const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0});
  const num = new Intl.NumberFormat('th-TH');
  const state={client:null,user:null,merchantId:null,stores:[],storeId:null,billing:null};
  const cfg=()=>({url:window.ANNYPAY_CONFIG?.SUPABASE_URL||localStorage.getItem('annypay_supabase_url')||'',key:window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY||localStorage.getItem('annypay_supabase_anon_key')||'',backend:window.ANNYPAY_CONFIG?.BACKEND_URL||location.origin});
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const alertMsg=(t,k='')=>{const e=$('#billingMessage');e.textContent=t||'';e.className=t?`alert ${k}`:'hidden'};

  async function init(){
    const c=cfg(); if(!c.url||!c.key)return alertMsg('กรุณาเชื่อม Supabase ที่หน้า Merchant Home ก่อน','error');
    state.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data,error}=await state.client.auth.getSession();if(error)throw error;state.user=data.session?.user;if(!state.user){location.href='index.html';return}
    state.merchantId=localStorage.getItem('annypay_merchant_id');if(!state.merchantId){location.href='index.html';return}
    const {data:stores,error:se}=await state.client.from('stores').select('id,store_name').eq('merchant_id',state.merchantId).order('created_at');if(se)throw se;
    state.stores=stores||[];if(!state.stores.length)return alertMsg('กรุณาสร้างร้านก่อนเลือกแพ็กเกจสมาชิก','error');
    state.storeId=localStorage.getItem('annypay_billing_store_id')||state.stores[0].id;
    if(!state.stores.some(x=>x.id===state.storeId))state.storeId=state.stores[0].id;
    $('#billingStore').innerHTML=state.stores.map(x=>`<option value="${x.id}" ${x.id===state.storeId?'selected':''}>${esc(x.store_name)}</option>`).join('');
    $('#billingStore').addEventListener('change',async e=>{state.storeId=e.target.value;localStorage.setItem('annypay_billing_store_id',state.storeId);await load()});
    await load();
  }

  async function api(path,options={}){
    const c=cfg();const {data}=await state.client.auth.getSession();const token=data.session?.access_token;
    const r=await fetch(c.backend+path,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(options.headers||{})}});
    const body=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(body.message||body.error||`HTTP ${r.status}`),{status:r.status,body});return body;
  }

  async function load(){
    alertMsg('');
    try{state.billing=await api(`/api/billing/store/${encodeURIComponent(state.storeId)}?merchantId=${encodeURIComponent(state.merchantId)}`);render()}
    catch(e){alertMsg(`โหลด Billing ไม่สำเร็จ: ${e.message}`,'error')}
  }

  function render(){
    const b=state.billing,w=b.wallet||{},s=b.subscription,p=s?.subscription_plans;
    $('#subscriptionStatus').textContent=s?.status||'NO PLAN';$('#currentStatus').textContent=s?.status||'NO PLAN';
    $('#currentPlan').textContent=p?.name||'ยังไม่ได้เลือก';$('#currentFee').textContent=p?money.format(Number(p.monthly_fee||0))+'/เดือน':'-';
    $('#nextBilling').textContent=s?.current_period_end?new Date(s.current_period_end).toLocaleDateString('th-TH'):'-';
    $('#periodText').textContent=w.period_end?`รอบ Token ถึง ${new Date(w.period_end).toLocaleDateString('th-TH')}`:'ยังไม่มีรอบ Token';
    $('#tokenTotal').textContent=num.format(w.total_remaining||0);$('#tokenGranted').textContent=num.format(w.monthly_granted||0);$('#tokenUsed').textContent=num.format(w.monthly_used||0);$('#tokenMonthly').textContent=num.format(w.monthly_remaining||0);$('#tokenTopup').textContent=num.format(w.topup_remaining||0);
    const base=Math.max(1,Number(w.monthly_granted||0)+Number(w.topup_remaining||0));const pct=Math.max(0,Math.min(100,Number(w.total_remaining||0)/base*100));$('#tokenProgress').style.width=pct+'%';
    $('#plans').innerHTML=(b.plans||[]).length?(b.plans||[]).map(x=>`<div class="panel plan-card"><h3>${esc(x.name)}</h3><div class="price">${money.format(Number(x.monthly_fee||0))}<span class="subtle"> /เดือน</span></div><p class="muted">${num.format(Number(x.monthly_ai_tokens||0))} AI Token / เดือน</p><p class="subtle">${esc(x.description||'')}</p><button class="btn primary choosePlan" data-id="${x.id}">${s?.plan_id===x.id?'ต่ออายุ / ชำระ':'เลือกแพ็กเกจ'}</button></div>`).join(''):'<div class="panel card">ยังไม่มีแพ็กเกจ กรุณาให้ Admin สร้าง Plan</div>';
    $('#packs').innerHTML=(b.tokenPacks||[]).length?(b.tokenPacks||[]).map(x=>`<div class="panel pack-card"><h3>${esc(x.name)}</h3><div class="price">${num.format(Number(x.token_amount))} Token</div><p class="muted">${money.format(Number(x.price))}</p><button class="btn primary buyPack" data-id="${x.id}">ซื้อ Token เพิ่ม</button></div>`).join(''):'<div class="panel card">ยังไม่มี Token Pack</div>';
    $('#invoiceBody').innerHTML=(b.invoices||[]).length?b.invoices.map(x=>`<tr><td class="code">${esc(x.id.slice(0,8))}</td><td>${new Date(x.period_start).toLocaleDateString('th-TH')} - ${new Date(x.period_end).toLocaleDateString('th-TH')}</td><td>${money.format(Number(x.amount||0))}</td><td><span class="badge gray">${esc(x.status)}</span></td></tr>`).join(''):'<tr><td colspan="4" class="empty">ยังไม่มี Invoice</td></tr>';
    $('#purchaseBody').innerHTML=(b.tokenPurchases||[]).length?b.tokenPurchases.map(x=>`<tr><td>${num.format(Number(x.token_amount||0))}</td><td>${money.format(Number(x.total_amount||0))}</td><td><span class="badge gray">${esc(x.status)}</span></td><td>${new Date(x.created_at).toLocaleDateString('th-TH')}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">ยังไม่เคยซื้อ Token เพิ่ม</td></tr>';
    document.querySelectorAll('.choosePlan').forEach(el=>el.onclick=()=>choosePlan(el.dataset.id));document.querySelectorAll('.buyPack').forEach(el=>el.onclick=()=>buyPack(el.dataset.id));
  }

  async function choosePlan(planId){
    try{const r=await api('/api/billing/subscription',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,planId})});alertMsg(`สร้าง Invoice สมาชิกแล้ว สถานะ ${r.invoice.status} — รอเชื่อม Payment Provider เพื่อชำระและ Activate Token`,'success');await load()}
    catch(e){alertMsg(e.message,'error')}
  }
  async function buyPack(packId){
    try{const r=await api('/api/billing/token-purchase',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,packId,quantity:1})});alertMsg(`สร้างรายการซื้อ Token แล้ว สถานะ ${r.purchase.status} — Token จะเข้าเมื่อ Payment ถูก Verify`,'success');await load()}
    catch(e){alertMsg(e.message,'error')}
  }

  document.addEventListener('DOMContentLoaded',()=>init().catch(e=>alertMsg(e.message,'error')));
})();
