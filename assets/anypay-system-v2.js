(() => {
  const KEY='anypay_system_v2';
  const uid=(p='id')=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  const now=()=>new Date().toISOString();
  const seed=()=>({
    version:2,
    merchants:[
      {id:'m_healthy',businessName:'Healthy Coffee',businessType:'E-commerce',ownerName:'Somchai Demo',email:'owner@healthy.demo',phone:'0812345678',plan:'PRO',merchantStatus:'ACTIVE',kycStatus:'APPROVED',paymentStatus:'ACTIVE',createdAt:'2026-08-20T08:00:00.000Z',lastActiveAt:now(),gmv:128450,orders:192,stores:2,products:8,channels:['LINE','FACEBOOK','INSTAGRAM']},
      {id:'m_wellness',businessName:'Wellness Shop',businessType:'Retail',ownerName:'Nok Demo',email:'hello@wellness.demo',phone:'0895551234',plan:'STARTER',merchantStatus:'PROFILE_CREATED',kycStatus:'PENDING',paymentStatus:'NOT_CONNECTED',createdAt:'2026-08-25T08:00:00.000Z',lastActiveAt:'2026-08-28T08:15:00.000Z',gmv:25400,orders:41,stores:1,products:4,channels:['LINE']}
    ],
    conversations:[
      {id:'oc_1',merchantId:'m_healthy',customer:'คุณนิด',channel:'LINE',preview:'มีแบบไม่หวานไหมคะ?',stage:'QUALIFYING',unread:2,updatedAt:now()},
      {id:'oc_2',merchantId:'m_healthy',customer:'May P.',channel:'INSTAGRAM',preview:'ส่งลิงก์สั่งซื้อให้หน่อยค่ะ',stage:'CHECKOUT_SENT',unread:1,updatedAt:now()},
      {id:'oc_3',merchantId:'m_healthy',customer:'Krit',channel:'FACEBOOK',preview:'รับของพรุ่งนี้ได้ไหมครับ',stage:'PAYMENT_PENDING',unread:0,updatedAt:now()}
    ],
    channels:[
      {id:'ch_1',merchantId:'m_healthy',provider:'LINE',name:'Healthy Coffee OA',status:'ACTIVE',aiMode:'AUTO'},
      {id:'ch_2',merchantId:'m_healthy',provider:'FACEBOOK',name:'Healthy Coffee Page',status:'ACTIVE',aiMode:'DRAFT'},
      {id:'ch_3',merchantId:'m_healthy',provider:'INSTAGRAM',name:'@healthycoffee',status:'ACTIVE',aiMode:'AUTO'},
      {id:'ch_4',merchantId:'m_wellness',provider:'LINE',name:'Wellness Shop OA',status:'PENDING',aiMode:'DRAFT'}
    ],
    transactions:[
      {id:'tx_1',merchantId:'m_healthy',amount:1180,status:'PAID',provider:'QR',createdAt:now()},
      {id:'tx_2',merchantId:'m_healthy',amount:1290,status:'PENDING',provider:'CARD',createdAt:now()}
    ],
    audit:[]
  });
  function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&x.version===2)return x}catch{}const x=seed();save(x);return x}
  function save(state){localStorage.setItem(KEY,JSON.stringify(state));return state}
  function audit(state,event,detail={}){state.audit.unshift({id:uid('audit'),event,detail,createdAt:now()});state.audit=state.audit.slice(0,100);save(state)}
  function createMerchant(input){const state=load();const m={id:uid('m'),businessName:String(input.businessName||'').trim(),businessType:input.businessType||'E-commerce',ownerName:String(input.ownerName||'').trim(),email:String(input.email||'').trim(),phone:String(input.phone||'').trim(),plan:input.plan||'STARTER',merchantStatus:'PROFILE_CREATED',kycStatus:'PENDING',paymentStatus:'NOT_CONNECTED',createdAt:now(),lastActiveAt:now(),gmv:0,orders:0,stores:input.createStore?1:0,products:0,channels:[]};state.merchants.unshift(m);audit(state,'merchant.created',{merchantId:m.id,businessName:m.businessName});save(state);return m}
  function updateMerchant(id,patch){const state=load();const m=state.merchants.find(x=>x.id===id);if(!m)return null;Object.assign(m,patch,{lastActiveAt:now()});audit(state,'merchant.updated',{merchantId:id,patch});save(state);return m}
  function merchant(id){return load().merchants.find(x=>x.id===id)||null}
  function reset(){const x=seed();save(x);return x}
  window.AnyPaySystem={KEY,load,save,seed,reset,createMerchant,updateMerchant,merchant,audit,uid,now};
})();