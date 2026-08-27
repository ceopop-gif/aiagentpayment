(() => {
  const $ = s => document.querySelector(s);
  const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'});
  const state = { client:null,user:null,merchantId:null,stores:[],storeId:null,accounts:[] };

  const cfg=()=>({
    url:window.ANNYPAY_CONFIG?.SUPABASE_URL||localStorage.getItem('annypay_supabase_url')||'',
    key:window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY||localStorage.getItem('annypay_supabase_anon_key')||'',
    backend:window.ANNYPAY_CONFIG?.BACKEND_URL||location.origin
  });

  function msg(text,kind=''){
    const el=$('#message');el.textContent=text||'';el.className=text?`alert ${kind}`.trim():'hidden';
  }

  async function init(){
    const c=cfg();
    if(!c.url||!c.key)return msg('ยังไม่ได้ตั้งค่า Supabase','error');
    state.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data,error}=await state.client.auth.getSession();if(error)return msg(error.message,'error');
    state.user=data.session?.user;if(!state.user){location.href='index.html';return}
    const remembered=localStorage.getItem('annypay_merchant_id');
    const {data:mm,error:me}=await state.client.from('merchant_members').select('merchant_id').eq('user_id',state.user.id);if(me)return msg(me.message,'error');
    if(!mm?.length)return msg('ยังไม่มี Merchant','error');
    state.merchantId=mm.find(x=>x.merchant_id===remembered)?.merchant_id||mm[0].merchant_id;
    const {data:stores,error:se}=await state.client.from('stores').select('id,store_name').eq('merchant_id',state.merchantId).order('created_at');if(se)return msg(se.message,'error');
    state.stores=stores||[];if(!state.stores.length)return msg('กรุณาสร้างร้านก่อน','error');
    $('#storeSelect').innerHTML=state.stores.map(s=>`<option value="${s.id}">${escapeHtml(s.store_name)}</option>`).join('');
    state.storeId=localStorage.getItem('annypay_store_id')||state.stores[0].id;
    if(!state.stores.some(s=>s.id===state.storeId))state.storeId=state.stores[0].id;
    $('#storeSelect').value=state.storeId;
    bind();await loadAll();
  }

  async function api(path,options={}){
    const {data}=await state.client.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error('Unauthorized');
    const response=await fetch(cfg().backend+path,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...options.headers}});
    const text=await response.text();let out={};try{out=text?JSON.parse(text):{}}catch{out={message:text}}
    if(!response.ok)throw Object.assign(new Error(out.message||out.error||`HTTP ${response.status}`),{code:out.error});
    return out;
  }

  async function loadAll(){await Promise.all([loadAccounts(),loadWithdrawals()])}

  async function loadAccounts(){
    const out=await api(`/api/payout/accounts?merchantId=${encodeURIComponent(state.merchantId)}&storeId=${encodeURIComponent(state.storeId)}`);
    state.accounts=out.accounts||[];$('#accountCount').textContent=`${state.accounts.length} / 5`;$('#limitFill').style.width=`${Math.min(100,state.accounts.length/5*100)}%`;
    $('#accounts').innerHTML=state.accounts.length?state.accounts.map(a=>`<div class="account-card"><div><b>${escapeHtml(a.bank_name)}</b><div>${escapeHtml(a.account_name)}</div><div class="account-number">•••• ${escapeHtml(a.account_number_last4)}</div></div><div class="actions"><span class="badge gray">${escapeHtml(a.status)}</span>${a.is_default?'<span class="badge">DEFAULT</span>':''}</div></div>`).join(''):'<p class="muted">ยังไม่มีบัญชีรับเงิน</p>';
    const active=state.accounts.filter(a=>a.status==='ACTIVE'&&a.verified_at);
    $('#withdrawAccount').innerHTML=active.length?active.map(a=>`<option value="${a.id}">${escapeHtml(a.bank_name)} · •••• ${escapeHtml(a.account_number_last4)} · ${escapeHtml(a.account_name)}</option>`).join(''):'<option value="">ยังไม่มีบัญชี ACTIVE ที่ยืนยันแล้ว</option>';
    $('#accountForm button[type=submit]').disabled=state.accounts.length>=5;
  }

  async function loadWithdrawals(){
    const out=await api(`/api/withdrawals?merchantId=${encodeURIComponent(state.merchantId)}&storeId=${encodeURIComponent(state.storeId)}`);
    const rows=out.withdrawals||[];$('#withdrawalsBody').innerHTML=rows.length?rows.map(w=>`<tr><td>${escapeHtml(w.withdrawal_ref)}</td><td>${escapeHtml(w.bank_name_snapshot)} •••• ${escapeHtml(w.account_last4_snapshot)}</td><td>${money.format(Number(w.amount||0))}</td><td>${money.format(Number(w.fee||0))}</td><td>${money.format(Number(w.net_amount||0))}</td><td>${escapeHtml(w.status)}</td><td>${new Date(w.requested_at).toLocaleString('th-TH')}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">ยังไม่มีรายการถอนเงิน</td></tr>';
  }

  async function addAccount(e){
    e.preventDefault();msg('');
    try{
      await api('/api/payout/accounts',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,bankCode:$('#bankCode').value.trim(),bankName:$('#bankName').value.trim(),accountName:$('#accountName').value.trim(),accountNumber:$('#accountNumber').value.trim()})});
      $('#accountNumber').value='';e.target.reset();msg('ลงทะเบียนบัญชีแล้ว กำลังรอการยืนยันก่อนใช้งานถอนเงิน','success');await loadAccounts();
    }catch(err){msg(err.code==='STORE_PAYOUT_ACCOUNT_LIMIT_REACHED'?'ร้านนี้มีบัญชีครบ 5 บัญชีแล้ว':err.message,'error')}
  }

  async function withdraw(e){
    e.preventDefault();msg('');const accountId=$('#withdrawAccount').value;if(!accountId)return msg('ยังไม่มีบัญชีที่ยืนยันแล้วสำหรับถอนเงิน','error');if(!$('#confirmWithdraw').checked)return msg('กรุณายืนยันจำนวนเงินและบัญชีปลายทาง','error');
    try{
      await api('/api/withdrawals',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,payoutAccountId:accountId,amount:Number($('#amount').value),fee:Number($('#fee').value||0),currency:'THB',confirm:true})});
      e.target.reset();$('#fee').value='0';msg('สร้างคำขอถอนเงินแล้ว สถานะเริ่มต้น REQUESTED','success');await loadWithdrawals();
    }catch(err){msg(err.message,'error')}
  }

  function bind(){
    $('#storeSelect').addEventListener('change',async e=>{state.storeId=e.target.value;localStorage.setItem('annypay_store_id',state.storeId);await loadAll()});
    $('#accountForm').addEventListener('submit',addAccount);$('#withdrawForm').addEventListener('submit',withdraw);
  }
  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  document.addEventListener('DOMContentLoaded',init);
})();