(() => {
  const $=s=>document.querySelector(s); const money=new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'});
  const params=new URLSearchParams(location.search); const store=params.get('store'); const page=params.get('page'); let client,offer;
  const showMsg=(t,err=false)=>{const el=$('#message');el.textContent=t;el.className=`alert${err?' error':''}`};
  async function init(){
    const c=window.ANNYPAY_CONFIG||{}; if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY)return showMsg('เว็บยังไม่ได้ตั้งค่า Supabase ใน config.js',true);
    if(!store||!page)return showMsg('ลิงก์ SalePage ไม่ครบ ต้องมี ?store=...&page=...',true);
    client=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY);
    const {data,error}=await client.rpc('get_published_offer',{p_store_slug:store,p_page_slug:page}); if(error)return showMsg(error.message,true);
    offer=data; render();
  }
  function render(){
    $('#offer').classList.remove('hidden'); $('#message').classList.add('hidden');
    $('#storeName').textContent=offer.store.name; $('#headline').textContent=offer.page.headline||offer.product.name;
    $('#description').textContent=offer.product.short_description||offer.store.description||'พร้อมสั่งซื้อผ่าน AnnyPay';
    const current=Number(offer.product.sale_price??offer.product.price); $('#price').textContent=money.format(current);
    if(offer.product.sale_price!=null&&Number(offer.product.sale_price)<Number(offer.product.price)){ $('#oldPrice').textContent=money.format(Number(offer.product.price));$('#oldPrice').classList.remove('hidden'); }
    $('#productName').textContent=offer.product.name; $('#productDescription').textContent=offer.product.description||offer.product.short_description||'-';
    $('#stock').textContent=offer.product.track_stock?offer.product.stock:'ไม่จำกัด';
  }
  async function checkout(e){
    e.preventDefault(); const btn=$('#checkoutBtn');btn.disabled=true;
    try{
      const address=$('#address').value.trim();
      const {data,error}=await client.rpc('create_public_order',{
        p_store_slug:store,p_page_slug:page,p_customer_name:$('#customerName').value.trim(),p_customer_phone:$('#customerPhone').value.trim(),p_customer_email:$('#customerEmail').value.trim()||null,p_quantity:Number($('#quantity').value||1),p_shipping_address:address?{address}:{}
      }); if(error)throw error;
      $('#checkoutForm').classList.add('hidden'); const s=$('#orderSuccess');s.classList.remove('hidden');
      s.innerHTML=`<h3>สร้าง Order สำเร็จ</h3><p>เลขที่ <b>${data.order_no}</b></p><p>ยอดชำระ <b>${money.format(Number(data.amount||0))}</b></p><p>สถานะ Payment: <b>${data.payment_status}</b></p><p>ขั้นต่อไปคือเชื่อม Payment Provider เพื่อสร้าง QR/Card และอัปเดต PAID ผ่าน Webhook</p>`;
    }catch(err){showMsg(err.message,true)}finally{btn.disabled=false}
  }
  document.addEventListener('DOMContentLoaded',()=>{$('#checkoutForm').addEventListener('submit',checkout);init()});
})();