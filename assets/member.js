(() => {
  const $ = s => document.querySelector(s);
  const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0});
  const num = new Intl.NumberFormat('th-TH');
  const state={client:null,user:null,merchant:null,merchantId:null,storeId:null};
  const cfg=()=>({
    url:window.ANNYPAY_CONFIG?.SUPABASE_URL||localStorage.getItem('annypay_supabase_url')||'',
    key:window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY||localStorage.getItem('annypay_supabase_anon_key')||'',
    backend:window.ANNYPAY_CONFIG?.BACKEND_URL||location.origin
  });
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const msg=(text='',kind='')=>{const el=$('#memberMessage');el.textContent=text;el.className=text?`alert ${kind} member-message`.trim():'hidden member-message'};
  const statusClass=v=>{
    const s=String(v||'').toUpperCase();
    if(['ACTIVE','APPROVED','PAYMENT_READY','READY','PAID'].some(x=>s.includes(x)))return 'status-chip ok';
    if(['PENDING','NEW','REVIEW','NOT_CONNECTED'].some(x=>s.includes(x)))return 'status-chip warn';
    return 'status-chip';
  };
  const setChip=(id,value)=>{const el=$(id);if(!el)return;el.textContent=value||'-';el.className=statusClass(value)};

  async function init(){
    const c=cfg();
    if(!c.url||!c.key){
      msg('ยังไม่ได้เชื่อม Supabase กรุณาเข้า Merchant Home เพื่อเชื่อมระบบก่อน','error');
      $('#heroMemberStatus').textContent='ยังไม่ได้เชื่อมระบบ';
      $('#memberRecentOrders').innerHTML='<tr><td colspan="4" class="empty-member">เชื่อม Database ที่หน้า Merchant Home ก่อนใช้งานข้อมูลจริง</td></tr>';
      return;
    }
    state.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data,error}=await state.client.auth.getSession(); if(error)throw error;
    state.user=data.session?.user||null;
    if(!state.user){location.href='index.html';return}
    renderUser();
    await loadMerchant();
    if(!state.merchant){return}
    await Promise.all([loadOverview(),loadBilling()]);
  }

  function renderUser(){
    const email=state.user?.email||'สมาชิก AnnyPay';
    $('#memberEmail').textContent=email;
    $('#memberAvatar').textContent=(email[0]||'A').toUpperCase();
  }

  async function loadMerchant(){
    let id=localStorage.getItem('annypay_merchant_id');
    if(!id){
      const {data:mm,error}=await state.client.from('merchant_members').select('merchant_id,role').eq('user_id',state.user.id).limit(1);if(error)throw error;
      id=mm?.[0]?.merchant_id||null;
    }
    if(!id){
      msg('ยังไม่มี Merchant ในบัญชีนี้ กรุณาสร้าง Merchant ที่หน้า Merchant Home','error');
      $('#heroMemberStatus').textContent='ยังไม่มี Merchant';
      $('#memberRecentOrders').innerHTML='<tr><td colspan="4" class="empty-member">ยังไม่มี Merchant</td></tr>';
      return;
    }
    state.merchantId=id;localStorage.setItem('annypay_merchant_id',id);
    const {data,error}=await state.client.from('merchants').select('id,business_name,merchant_status,kyc_status,payment_status').eq('id',id).single();if(error)throw error;
    state.merchant=data;
    $('#welcomeName').textContent=data.business_name||'สมาชิก AnnyPay';
    $('#heroMemberStatus').textContent=data.merchant_status||'MEMBER';
    setChip('#merchantChip',data.merchant_status);
    setChip('#kycChip',data.kyc_status);
    setChip('#paymentChip',data.payment_status);
  }

  async function loadOverview(){
    const id=state.merchantId,n=new Date(),start=new Date(n.getFullYear(),n.getMonth(),n.getDate()).toISOString();
    const [storesRes,todayRes,recentRes]=await Promise.all([
      state.client.from('stores').select('id,store_name',{count:'exact'}).eq('merchant_id',id).order('created_at'),
      state.client.from('orders').select('id,total,payment_status,order_status').eq('merchant_id',id).gte('created_at',start),
      state.client.from('orders').select('order_no,total,payment_status,order_status,created_at').eq('merchant_id',id).order('created_at',{ascending:false}).limit(6)
    ]);
    [storesRes,todayRes,recentRes].forEach(r=>{if(r.error)throw r.error});
    const stores=storesRes.data||[];state.storeId=localStorage.getItem('annypay_billing_store_id')||stores[0]?.id||null;
    if(state.storeId&&!stores.some(s=>s.id===state.storeId))state.storeId=stores[0]?.id||null;
    const today=todayRes.data||[],paid=today.filter(o=>o.payment_status==='PAID'),sales=paid.reduce((s,o)=>s+Number(o.total||0),0);
    $('#memberSales').textContent=money.format(sales);$('#memberOrders').textContent=num.format(today.length);$('#memberStores').textContent=num.format(stores.length);
    const rows=recentRes.data||[];
    $('#memberRecentOrders').innerHTML=rows.length?rows.map(o=>`<tr><td>${esc(o.order_no||'-')}</td><td>${money.format(Number(o.total||0))}</td><td><span class="badge ${o.payment_status==='PAID'?'':'gray'}">${esc(o.payment_status||'-')}</span></td><td class="desktop-only">${esc(o.order_status||'-')}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-member">ยังไม่มี Order</td></tr>';
  }

  async function api(path){
    const c=cfg(),{data}=await state.client.auth.getSession(),token=data.session?.access_token;
    const r=await fetch(c.backend+path,{headers:{authorization:`Bearer ${token}`}});
    const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message||body.error||`HTTP ${r.status}`);return body;
  }

  async function loadBilling(){
    if(!state.storeId){
      $('#memberPlan').textContent='กรุณาสร้างร้านก่อน';$('#memberPlanStatus').textContent='NO STORE';$('#heroMemberStatus').textContent=state.merchant?.merchant_status||'MEMBER';return;
    }
    try{
      const b=await api(`/api/billing/store/${encodeURIComponent(state.storeId)}?merchantId=${encodeURIComponent(state.merchantId)}`),w=b.wallet||{},s=b.subscription,p=s?.subscription_plans;
      $('#memberPlan').textContent=p?.name||'ยังไม่มีแพ็กเกจ';$('#memberPlanStatus').textContent=s?.status||'NO PLAN';$('#memberNextBilling').textContent=s?.current_period_end?new Date(s.current_period_end).toLocaleDateString('th-TH'):'-';
      const total=Number(w.total_remaining||0),base=Math.max(1,Number(w.monthly_granted||0)+Number(w.topup_remaining||0));
      $('#memberTokens').textContent=num.format(total);$('#memberTokenBig').textContent=num.format(total);$('#memberTokenProgress').style.width=Math.max(0,Math.min(100,total/base*100))+'%';
      if(s?.status)$('#heroMemberStatus').textContent=s.status;
    }catch(e){
      $('#memberPlan').textContent='ยังโหลดแพ็กเกจไม่ได้';$('#memberPlanStatus').textContent='-';$('#memberTokens').textContent='-';$('#memberTokenBig').textContent='-';
      console.warn('Billing unavailable',e);
    }
  }

  async function logout(){
    try{await state.client?.auth.signOut()}finally{location.href='index.html'}
  }

  document.addEventListener('DOMContentLoaded',()=>{
    $('#memberLogout')?.addEventListener('click',logout);
    init().catch(e=>{console.error(e);msg(`โหลดหน้าสมาชิกไม่สำเร็จ: ${e.message}`,'error')});
  });
})();
