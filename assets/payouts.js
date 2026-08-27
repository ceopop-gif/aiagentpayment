(() => {
  const $=s=>document.querySelector(s);
  const money=new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'});
  const state={client:null,user:null,merchantId:null,stores:[],storeId:null,accounts:[],providers:[],balance:null,policy:null};
  const cfg=()=>({url:window.ANNYPAY_CONFIG?.SUPABASE_URL||localStorage.getItem('annypay_supabase_url')||'',key:window.ANNYPAY_CONFIG?.SUPABASE_ANON_KEY||localStorage.getItem('annypay_supabase_anon_key')||'',backend:window.ANNYPAY_CONFIG?.BACKEND_URL||location.origin});
  function msg(text,kind=''){const el=$('#message');el.textContent=text||'';el.className=text?`alert ${kind}`.trim():'hidden'}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

  async function init(){
    const c=cfg();if(!c.url||!c.key)return msg('ยังไม่ได้ตั้งค่า Supabase','error');
    state.client=window.supabase.createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data,error}=await state.client.auth.getSession();if(error)return msg(error.message,'error');
    state.user=data.session?.user;if(!state.user){location.href='index.html';return}
    const remembered=localStorage.getItem('annypay_merchant_id');
    const {data:mm,error:me}=await state.client.from('merchant_members').select('merchant_id').eq('user_id',state.user.id);if(me)return msg(me.message,'error');
    if(!mm?.length)return msg('ยังไม่มี Merchant','error');
    state.merchantId=mm.find(x=>x.merchant_id===remembered)?.merchant_id||mm[0].merchant_id;
    const {data:stores,error:se}=await state.client.from('stores').select('id,store_name').eq('merchant_id',state.merchantId).order('created_at');if(se)return msg(se.message,'error');
    state.stores=stores||[];if(!state.stores.length)return msg('กรุณาสร้างร้านก่อน','error');
    $('#storeSelect').innerHTML=state.stores.map(s=>`<option value="${s.id}">${esc(s.store_name)}</option>`).join('');
    state.storeId=localStorage.getItem('annypay_store_id')||state.stores[0].id;if(!state.stores.some(s=>s.id===state.storeId))state.storeId=state.stores[0].id;$('#storeSelect').value=state.storeId;
    bind();await loadAll();
  }

  async function api(path,options={}){
    const {data}=await state.client.auth.getSession(),token=data.session?.access_token;if(!token)throw new Error('Unauthorized');
    const response=await fetch(cfg().backend+path,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...options.headers}});
    const text=await response.text();let out={};try{out=text?JSON.parse(text):{}}catch{out={message:text}}
    if(!response.ok)throw Object.assign(new Error(out.message||out.error||`HTTP ${response.status}`),{code:out.error});
    return out;
  }

  async function loadAll(){await Promise.all([loadBalance(),loadAccounts(),loadWithdrawals()])}

  async function loadBalance(){
    try{
      const out=await api(`/api/payout/balance?merchantId=${encodeURIComponent(state.merchantId)}&storeId=${encodeURIComponent(state.storeId)}&limit=30`);
      state.balance=out.balance||{};state.policy=out.policy||{};
      $('#pendingBalance').textContent=money.format(Number(state.balance.pending_balance||0));
      $('#availableBalance').textContent=money.format(Number(state.balance.available_balance||0));
      $('#reservedBalance').textContent=money.format(Number(state.balance.reserved_balance||0));
      $('#paidOutTotal').textContent=money.format(Number(state.balance.total_paid_out||0));
      $('#holdPolicy').textContent=`${Number(state.policy.hold_minutes||0)} นาที`;
      $('#minWithdrawal').textContent=money.format(Number(state.policy.min_withdrawal||0));
      const rows=out.ledger||[];
      $('#ledgerBody').innerHTML=rows.length?rows.map(l=>`<tr><td>${new Date(l.created_at).toLocaleString('th-TH')}</td><td>${esc(l.entry_type)}</td><td>${money.format(Number(l.amount||0))}</td><td>${money.format(Number(l.pending_after||0))}</td><td>${money.format(Number(l.available_after||0))}</td><td>${money.format(Number(l.reserved_after||0))}</td><td>${esc(l.source_ref||'-')}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">ยังไม่มี Ledger</td></tr>';
      $('#amount').max=String(Number(state.balance.available_balance||0));
    }catch(err){msg(err.message,'error')}
  }

  async function loadAccounts(){
    const out=await api(`/api/payout/accounts?merchantId=${encodeURIComponent(state.merchantId)}&storeId=${encodeURIComponent(state.storeId)}`);
    state.accounts=out.accounts||[];state.providers=out.payout_providers||[];
    $('#providerSelect').innerHTML=state.providers.length?state.providers.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join(''):'<option value="">ยังไม่ได้เชื่อม Provider</option>';
    $('#accountCount').textContent=`${state.accounts.length} / 5`;$('#limitFill').style.width=`${Math.min(100,state.accounts.length/5*100)}%`;
    const provider=$('#providerSelect').value;
    $('#accounts').innerHTML=state.accounts.length?state.accounts.map(a=>{
      const verify=a.status==='PENDING_VERIFICATION'&&provider?`<button class="btn" onclick="verifyAccount('${a.id}')">ยืนยันบัญชี</button>`:'';
      const def=a.status==='ACTIVE'&&!a.is_default?`<button class="btn" onclick="setDefault('${a.id}')">ตั้ง Default</button>`:'';
      return `<div class="account-card"><div><b>${esc(a.bank_name)}</b><div>${esc(a.account_name)}</div><div class="account-number">•••• ${esc(a.account_number_last4)}</div><small>${a.verified_at?'Verified '+new Date(a.verified_at).toLocaleDateString('th-TH'):'รอยืนยันบัญชี'}</small></div><div class="actions"><span class="badge gray">${esc(a.status)}</span>${a.is_default?'<span class="badge">DEFAULT</span>':''}${verify}${def}</div></div>`;
    }).join(''):'<p class="muted">ยังไม่มีบัญชีรับเงิน</p>';
    const active=state.accounts.filter(a=>a.status==='ACTIVE'&&a.verified_at);
    $('#withdrawAccount').innerHTML=active.length?active.map(a=>`<option value="${a.id}">${esc(a.bank_name)} · •••• ${esc(a.account_number_last4)} · ${esc(a.account_name)}</option>`).join(''):'<option value="">ยังไม่มีบัญชี ACTIVE ที่ยืนยันแล้ว</option>';
    $('#accountForm button[type=submit]').disabled=state.accounts.length>=5;
  }

  async function loadWithdrawals(){
    const out=await api(`/api/withdrawals?merchantId=${encodeURIComponent(state.merchantId)}&storeId=${encodeURIComponent(state.storeId)}`),provider=$('#providerSelect').value;
    const rows=out.withdrawals||[];
    $('#withdrawalsBody').innerHTML=rows.length?rows.map(w=>{
      const canSubmit=['HELD','APPROVED'].includes(w.status)&&w.risk_status==='PASS'&&provider;
      return `<tr><td>${esc(w.withdrawal_ref)}</td><td>${esc(w.bank_name_snapshot)} •••• ${esc(w.account_last4_snapshot)}</td><td>${money.format(Number(w.amount||0))}</td><td>${money.format(Number(w.net_amount||0))}</td><td>${esc(w.risk_status||'-')}</td><td>${esc(w.status)}</td><td>${esc(w.provider||'-')}</td><td>${canSubmit?`<button class="btn primary" onclick="submitWithdrawal('${w.id}')">ส่ง Provider</button>`:'-'}</td></tr>`;
    }).join(''):'<tr><td colspan="8" class="empty">ยังไม่มีรายการถอนเงิน</td></tr>';
  }

  async function addAccount(e){e.preventDefault();msg('');try{await api('/api/payout/accounts',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,bankCode:$('#bankCode').value.trim(),bankName:$('#bankName').value.trim(),accountName:$('#accountName').value.trim(),accountNumber:$('#accountNumber').value.trim()})});e.target.reset();msg('ลงทะเบียนบัญชีแล้ว ต้องยืนยันก่อนถอนเงิน','success');await loadAccounts()}catch(err){msg(err.code==='STORE_PAYOUT_ACCOUNT_LIMIT_REACHED'?'ร้านนี้มีบัญชีครบ 5 บัญชีแล้ว':err.message,'error')}}

  async function verifyAccount(id){const provider=$('#providerSelect').value;if(!provider)return msg('กรุณาเชื่อม Payout Provider ก่อน','error');try{await api('/api/payout/accounts/verify',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,payoutAccountId:id,provider})});msg('ตรวจสอบบัญชีแล้ว','success');await loadAccounts()}catch(err){msg(err.message,'error')}}
  async function setDefault(id){try{await api('/api/payout/accounts/default',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,payoutAccountId:id,confirm:true})});msg('ตั้งบัญชี Default แล้ว','success');await loadAccounts()}catch(err){msg(err.message,'error')}}

  async function withdraw(e){e.preventDefault();msg('');const accountId=$('#withdrawAccount').value;if(!accountId)return msg('ยังไม่มีบัญชีที่ยืนยันแล้ว','error');if(!$('#confirmWithdraw').checked)return msg('กรุณายืนยันยอดและบัญชีปลายทาง','error');const amount=Number($('#amount').value);if(state.balance&&amount>Number(state.balance.available_balance||0))return msg('ยอดถอนมากกว่ายอดที่ถอนได้','error');try{await api('/api/withdrawals',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,storeId:state.storeId,payoutAccountId:accountId,amount,fee:Number($('#fee').value||0),currency:'THB',confirm:true})});e.target.reset();$('#fee').value='0';msg('จองยอดถอนแล้ว เงินย้ายจาก Available ไป Reserved','success');await Promise.all([loadBalance(),loadWithdrawals()])}catch(err){msg(err.code==='INSUFFICIENT_AVAILABLE_BALANCE'?'ยอดเงินที่ถอนได้ไม่เพียงพอ':err.message,'error')}}

  async function submitWithdrawal(id){const provider=$('#providerSelect').value;if(!provider)return msg('ยังไม่ได้เชื่อม Payout Provider','error');if(!confirm('ยืนยันส่งคำขอถอนนี้ไปยัง Payout Provider?'))return;try{await api('/api/withdrawals/submit',{method:'POST',body:JSON.stringify({merchantId:state.merchantId,withdrawalId:id,provider,confirm:true})});msg('ส่งรายการไป Provider แล้ว รอผลยืนยัน','success');await loadWithdrawals()}catch(err){msg(err.message,'error')}}

  function bind(){
    $('#storeSelect').addEventListener('change',async e=>{state.storeId=e.target.value;localStorage.setItem('annypay_store_id',state.storeId);await loadAll()});
    $('#providerSelect').addEventListener('change',()=>{loadAccounts();loadWithdrawals()});
    $('#accountForm').addEventListener('submit',addAccount);$('#withdrawForm').addEventListener('submit',withdraw);
  }
  window.verifyAccount=verifyAccount;window.setDefault=setDefault;window.submitWithdrawal=submitWithdrawal;
  document.addEventListener('DOMContentLoaded',init);
})();