(() => {
  const $ = s => document.querySelector(s);
  const money = new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'});
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const params = new URLSearchParams(location.search);
  const storeSlug = params.get('store');

  function showMessage(text, error=false){
    const el=$('#message');el.textContent=text;el.className=`alert${error?' error':''}`;
  }

  async function init(){
    const c=window.ANNYPAY_CONFIG||{};
    if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY) return showMessage('เว็บยังไม่ได้ตั้งค่า Supabase ใน config.js',true);
    if(!storeSlug) return showMessage('ลิงก์หน้าร้านไม่ครบ ต้องมี ?store=<store_slug>',true);

    const client=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY);
    const {data,error}=await client.rpc('get_public_store_catalog',{p_store_slug:storeSlug});
    if(error) return showMessage(error.message,true);
    render(data);
  }

  function render(data){
    const store=data?.store||{};const products=data?.products||[];
    document.title=`${store.name||'AnnyPay Store'} — AnnyPay`;
    $('#storeName').textContent=store.name||'ร้านค้า';
    $('#storeDescription').textContent=store.description||'เลือกสินค้าและสั่งซื้อผ่าน AnnyPay';
    $('#productCount').textContent=`${products.length} สินค้า`;
    $('#storefront').classList.remove('hidden');$('#message').classList.add('hidden');

    if(!products.length){$('#emptyCatalog').classList.remove('hidden');return;}
    $('#catalog').innerHTML=products.map(p=>{
      const current=Number(p.sale_price??p.price??0);
      const old=p.sale_price!=null&&Number(p.sale_price)<Number(p.price)?`<span class="old">${money.format(Number(p.price))}</span>`:'';
      const url=`sale.html?store=${encodeURIComponent(store.slug)}&page=${encodeURIComponent(p.salepage_slug)}`;
      return `<article class="product-card">
        <span class="pill">${esc(p.headline||'พร้อมสั่งซื้อ')}</span>
        <h3>${esc(p.product_name)}</h3>
        <p class="muted">${esc(p.short_description||'')}</p>
        <div class="price">${money.format(current)} ${old}</div>
        <div class="muted">${p.track_stock?`คงเหลือ ${Number(p.stock||0)}`:'พร้อมจำหน่าย'}</div>
        <a class="btn primary" href="${url}">ดูสินค้า / สั่งซื้อ</a>
      </article>`;
    }).join('');
  }

  document.addEventListener('DOMContentLoaded',init);
})();