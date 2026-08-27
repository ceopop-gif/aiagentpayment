(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',maximumFractionDigits:0});
  const state={client:null,user:null,merchants:[],merchant:null,stores:[]};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const msg=(el,text='',kind='')=>{if(!el)return;el.textContent=text;el.className=text?`alert ${kind}`.trim():'hidden'};
  const show=id=>{['#configScreen','#authScreen','#appScreen'].forEach(x=>$(x)?.classList.add('hidden'));$(id)?.classList.remove('hidden')};
  const cfg=()=>({url:window.ANNYPAY_CONFIG?.SUPABASE_URL||localStorage.getItem('annypay_supabase_url')||'',key:window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY||localStorage.getItem('annypay_supabase_anon_key')||''});
  const slug=v=>v.toLowerCase().trim().normalize('NFKD').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||`store-${Date.now().toString(36)}`;

  async function init(){
    const c=cfg(); if(!c.url||!c.key){show('#configScreen');return}
    try{
      state.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const {data,error}=await state.client.auth.getSession(); if(error)throw error;
      state.user=data.session?.user||null;
      state.client.auth.onAuthStateChange((_e,s)=>{state.user=s?.user||null;state.user?enter():show('#authScreen')});
      state.user?await enter():show('#authScreen');
    }catch(e){show('#configScreen');msg($('#configMessage'),`เชื่อม Supabase ไม่สำเร็จ: ${e.message}`,'error')}
  }

  async function sendMagicLink(e){
    e.preventDefault(); const email=$('#authEmail').value.trim(); const b=$('#authSubmit'); b.disabled=true; msg($('#authMessage'));
    try{
      const redirect=`${location.origin}${location.pathname}`;
      const {error}=await state.client.auth.signInWithOtp({email,options:{emailRedirectTo:redirect,shouldCreateUser:true}}); if(error)throw error;
      msg($('#authMessage'),'ส่งลิงก์เข้าใช้งานแล้ว กรุณาเปิดอีเมลและกด Magic Link','success');
    }catch(e){msg($('#authMessage'),e.message,'error')}finally{b.disabled=false}
  }

  async function enter(){
    show('#appScreen'); $('#userEmail').textContent=state.user.email||'AnnyPay user'; await loadMerchants();
  }

  async function loadMerchants(preferred=null){
    const {data:mm,error}=await state.client.from('merchant_members').select('merchant_id,role').eq('user_id',state.user.id); if(error)return dbError(error);
    if(!mm?.length){state.merchants=[];state.merchant=null;$('#merchantWorkspace').classList.add('hidden');$('#onboarding').classList.remove('hidden');return}
    const ids=mm.map(x=>x.merchant_id);
    const {data,error:e2}=await state.client.from('merchants').select('id,business_name,business_type,merchant_status,kyc_status,payment_status,created_at').in('id',ids).order('created_at'); if(e2)return dbError(e2);
    state.merchants=(data||[]).map(m=>({...m,role:mm.find(x=>x.merchant_id===m.id)?.role}));
    const remembered=preferred||localStorage.getItem('annypay_merchant_id'); state.merchant=state.merchants.find(m=>m.id===remembered)||state.merchants[0];
    localStorage.setItem('annypay_merchant_id',state.merchant.id); $('#onboarding').classList.add('hidden');$('#merchantWorkspace').classList.remove('hidden');renderMerchant();await loadAll();
  }

  function renderMerchant(){
    $('#merchantSelect').innerHTML=state.merchants.map(m=>`<option value="${m.id}" ${m.id===state.merchant.id?'selected':''}>${esc(m.business_name)}</option>`).join('');
    $('#merchantName').textContent=state.merchant.business_name; $('#merchantStatus').textContent=state.merchant.merchant_status; $('#kycStatus').textContent=state.merchant.kyc_status; $('#paymentStatus').textContent=state.merchant.payment_status;
  }

  async function onboard(e){
    e.preventDefault(); const b=$('#onboardSubmit');b.disabled=true;msg($('#onboardMessage'));
    try{
      const {data,error}=await state.client.rpc('bootstrap_merchant',{p_business_name:$('#businessName').value.trim(),p_display_name:$('#ownerName').value.trim(),p_phone:$('#ownerPhone').value.trim(),p_business_type:$('#businessType').value}); if(error)throw error;
      msg($('#onboardMessage'),'สร้าง Merchant สำเร็จ','success'); await loadMerchants(data);
    }catch(e){msg($('#onboardMessage'),`สร้าง Merchant ไม่สำเร็จ: ${e.message}`,'error')}finally{b.disabled=false}
  }

  async function loadAll(){await Promise.all([dashboard(),stores(),products(),orders()]);settings()}

  async function dashboard(){
    const id=state.merchant.id,n=new Date(),start=new Date(n.getFullYear(),n.getMonth(),n.getDate()).toISOString();
    try{
      const [sr,pr,or,rr]=await Promise.all([
        state.client.from('stores').select('id',{count:'exact',head:true}).eq('merchant_id',id),
        state.client.from('products').select('id',{count:'exact',head:true}).eq('merchant_id',id),
        state.client.from('orders').select('id,total,payment_status,order_status').eq('merchant_id',id).gte('created_at',start),
        state.client.from('orders').select('order_no,total,payment_status,order_status,created_at').eq('merchant_id',id).order('created_at',{ascending:false}).limit(6)
      ]); [sr,pr,or,rr].forEach(r=>{if(r.error)throw r.error});
      const today=or.data||[],paid=today.filter(o=>o.payment_status==='PAID'),sales=paid.reduce((s,o)=>s+Number(o.total||0),0);
      $('#metricSales').textContent=money.format(sales);$('#metricOrders').textContent=today.length;$('#metricPaid').textContent=paid.length;$('#metricStores').textContent=sr.count||0;$('#productCountText').textContent=`${pr.count||0} สินค้า`;
      $('#recentOrdersBody').innerHTML=rr.data?.length?rr.data.map(o=>`<tr><td>${esc(o.order_no)}</td><td>${money.format(Number(o.total||0))}</td><td><span class="badge ${o.payment_status==='PAID'?'':'gray'}">${esc(o.payment_status)}</span></td><td>${esc(o.order_status)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">ยังไม่มี Order</td></tr>';
    }catch(e){dbError(e)}
  }

  async function stores(){
    const {data,error}=await state.client.from('stores').select('id,store_name,store_slug,status,domain,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false});if(error)return dbError(error);
    state.stores=data||[];$('#storesBody').innerHTML=state.stores.length?state.stores.map(s=>`<tr><td>${esc(s.store_name)}</td><td>${esc(s.store_slug)}</td><td><span class="badge gray">${esc(s.status)}</span></td><td>${esc(s.domain||'-')}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">ยังไม่มีร้าน</td></tr>';
    $('#productStore').innerHTML=state.stores.length?state.stores.map(s=>`<option value="${s.id}">${esc(s.store_name)}</option>`).join(''):'<option value="">กรุณาสร้างร้านก่อน</option>';$('#createProductBtn').disabled=!state.stores.length;
  }

  async function createStore(e){
    e.preventDefault();const b=$('#createStoreBtn');b.disabled=true;msg($('#storeMessage'));
    try{const name=$('#storeName').value.trim();const {error}=await state.client.from('stores').insert({merchant_id:state.merchant.id,store_name:name,store_slug:slug(name),description:$('#storeDescription').value.trim()||null,status:'DRAFT'});if(error)throw error;e.currentTarget.reset();msg($('#storeMessage'),'สร้างร้านแล้ว','success');await Promise.all([stores(),dashboard()])}catch(e){msg($('#storeMessage'),e.message,'error')}finally{b.disabled=false}
  }

  async function products(){
    const {data,error}=await state.client.from('products').select('id,product_name,sku,price,stock,status,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(100);if(error)return dbError(error);
    $('#productsBody').innerHTML=data?.length?data.map(p=>`<tr><td>${esc(p.product_name)}</td><td>${esc(p.sku||'-')}</td><td>${money.format(Number(p.price||0))}</td><td>${p.stock}</td><td><span class="badge gray">${esc(p.status)}</span></td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มีสินค้า</td></tr>';
  }

  async function createProduct(e){
    e.preventDefault();const b=$('#createProductBtn');b.disabled=true;msg($('#productMessage'));
    try{const sid=$('#productStore').value;if(!sid)throw new Error('กรุณาสร้างร้านก่อน');const {error}=await state.client.from('products').insert({merchant_id:state.merchant.id,store_id:sid,product_name:$('#productName').value.trim(),sku:$('#productSku').value.trim()||null,price:Number($('#productPrice').value),stock:Number($('#productStock').value||0),status:'ACTIVE'});if(error)throw error;e.currentTarget.reset();msg($('#productMessage'),'เพิ่มสินค้าแล้ว','success');await Promise.all([products(),dashboard()])}catch(e){msg($('#productMessage'),e.message,'error')}finally{b.disabled=!state.stores.length}
  }

  async function orders(){
    const {data,error}=await state.client.from('orders').select('order_no,total,payment_status,order_status,created_at').eq('merchant_id',state.merchant.id).order('created_at',{ascending:false}).limit(100);if(error)return dbError(error);
    $('#ordersBody').innerHTML=data?.length?data.map(o=>`<tr><td>${esc(o.order_no)}</td><td>${money.format(Number(o.total||0))}</td><td><span class="badge ${o.payment_status==='PAID'?'':'gray'}">${esc(o.payment_status)}</span></td><td>${esc(o.order_status)}</td><td>${new Date(o.created_at).toLocaleString('th-TH')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">ยังไม่มี Order</td></tr>';
  }

  function settings(){const m=state.merchant;$('#settingsEmail').textContent=state.user.email||'-';$('#settingsMerchant').textContent=m.business_name;$('#settingsRole').textContent=m.role||'-';$('#settingsMerchantStatus').textContent=m.merchant_status;$('#settingsKyc').textContent=m.kyc_status;$('#settingsPayment').textContent=m.payment_status}
  function go(v){$$('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));$$('.nav button[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#pageTitle').textContent=({dashboard:'Dashboard',stores:'ร้านค้า',products:'สินค้า',orders:'Orders',settings:'ตั้งค่า'}[v]||'AnnyPay');$('#sidebar').classList.remove('open')}
  function dbError(e){console.error(e);msg($('#globalMessage'),`Database: ${e.message||e}`,'error')}

  function bind(){
    $('#configForm').addEventListener('submit',e=>{e.preventDefault();const u=$('#configUrl').value.trim(),k=$('#configKey').value.trim();if(!u||!k)return msg($('#configMessage'),'กรอก Project URL และ Anon Key','error');localStorage.setItem('annypay_supabase_url',u);localStorage.setItem('annypay_supabase_anon_key',k);location.reload()});
    $('#clearConfig').addEventListener('click',()=>{localStorage.removeItem('annypay_supabase_url');localStorage.removeItem('annypay_supabase_anon_key');location.reload()});
    $('#authForm').addEventListener('submit',sendMagicLink);$('#onboardingForm').addEventListener('submit',onboard);$('#storeForm').addEventListener('submit',createStore);$('#productForm').addEventListener('submit',createProduct);
    $('#logoutBtn').addEventListener('click',()=>state.client?.auth.signOut());$('#merchantSelect').addEventListener('change',async e=>{state.merchant=state.merchants.find(m=>m.id===e.target.value);localStorage.setItem('annypay_merchant_id',state.merchant.id);renderMerchant();await loadAll()});
    $$('.nav button[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  }
  document.addEventListener('DOMContentLoaded',()=>{bind();init()});
})();
