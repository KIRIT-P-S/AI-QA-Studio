const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = 4180;
let mode = 'buggy';
const products = [
  { id: 'mouse', name: 'Wireless Mouse', price: 799, category: 'Accessories', description: 'A compact wireless mouse with quiet buttons and adjustable sensitivity.' },
  { id: 'keyboard', name: 'Mechanical Keyboard', price: 1299, category: 'Accessories', description: 'A full size mechanical keyboard with tactile switches and a detachable cable.' },
  { id: 'headphones', name: 'Studio Headphones', price: 2499, category: 'Audio', description: 'Comfortable over ear headphones for music, meetings and focused work.' },
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = `*{box-sizing:border-box}body{margin:0;background:#f5f6fb;color:#17233a;font:16px/1.6 system-ui,sans-serif}header{background:#101d35;color:white;padding:20px max(24px,calc((100% - 1120px)/2));display:flex;gap:28px;align-items:center;justify-content:space-between}header a{color:white;text-decoration:none}.brand{font-size:22px;font-weight:800}.sub{font-size:11px;letter-spacing:2px;color:#b6c2dd}main{max-width:1120px;margin:48px auto;padding:0 24px}h1{font-size:40px;line-height:1.2;margin-bottom:12px}h2{font-size:21px}p{color:#67738a}.search{display:flex;gap:10px;margin:30px 0}input{flex:1;min-width:0;padding:15px;border:1px solid #d8deeb;border-radius:8px;font:inherit}button,.button{background:#6354d7;color:white;border:0;border-radius:8px;padding:14px 22px;font:inherit;text-decoration:none;cursor:pointer;display:inline-block}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}.card{background:white;border:1px solid #e1e5ef;border-radius:14px;padding:26px}.icon{height:90px;display:flex;align-items:center;color:#6354d7;font-size:46px}.tag{font-size:12px;color:#6354d7;font-weight:700;letter-spacing:1px}.price{font-size:26px;font-weight:750;color:#17233a}.cart{border:1px solid #425171;border-radius:8px;padding:7px 15px}.muted{font-size:14px;color:#728098}footer{max-width:1120px;padding:28px 24px;margin:auto;border-top:1px solid #dce2ee;display:flex;justify-content:space-between;gap:16px}footer a{color:#6354d7}.detail{display:grid;grid-template-columns:1fr 1fr;gap:36px}.detail .icon{height:220px;justify-content:center;font-size:100px;background:#eeecff;border-radius:14px}.control{max-width:720px}label{display:block;margin:16px 0}select{font:inherit;padding:12px;border:1px solid #ddd;border-radius:7px;margin-right:12px}#cart-message{color:#17233a}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #a59aff;outline-offset:3px}@media(max-width:720px){.grid,.detail{grid-template-columns:1fr}h1{font-size:30px}header{padding:18px 24px}.search{flex-wrap:wrap}.search button{width:100%}main{margin-top:32px}footer{flex-wrap:wrap}}`;
function layout(title, content, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | Shop QA Demo</title><style>${css}</style></head><body><header><a class="brand" id="brand" href="/">Shop QA Demo<div class="sub">LOCAL TEST CATALOG</div></a><div class="cart">Cart <strong id="cart-count">0</strong></div></header><main>${content}</main><footer><span class="muted">Synthetic products and local test data</span><a href="/control">Demo controls</a></footer>${script ? `<script>${script}</script>` : ''}</body></html>`;
}
const icons = { mouse: '◉', keyboard: '▦', headphones: '◖◗' };
function catalog(query = '') {
  const matches = products.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return layout('Product catalog', `<span class="tag">THE EVERYDAY COLLECTION</span><h1 id="page-title">Find your next essential</h1><p>Browse our small collection of workspace accessories and audio products.</p><form class="search" method="get" action="/search" role="search"><input id="query" name="q" type="search" aria-label="Search products" placeholder="Search products" value="${escape(query)}"><button id="search-button" type="submit">Search</button></form><h2 id="results-heading">${matches.length} products</h2><div class="grid">${matches.map(p => `<article class="card" id="product-${p.id}"><div class="icon" aria-hidden="true">${icons[p.id]}</div><span class="tag">${p.category}</span><h2 class="product-title">${p.name}</h2><p>${p.description}</p><p class="price">₹${p.price}</p><a class="button" id="view-${p.id}" href="/products/${p.id}">View details</a></article>`).join('')}</div>${!matches.length ? '<div class="card"><h2 id="empty-state">No products found</h2><p>Try another product name.</p></div>' : ''}`);
}
function detail(product) {
  return layout(product.name, `<a href="/">Back to catalog</a><div class="detail"><div class="icon" aria-hidden="true">${icons[product.id]}</div><section><span class="tag">${product.category}</span><h1 id="product-title">${product.name}</h1><p id="product-description">${product.description}</p><p class="price" id="product-price">₹${product.price}</p><button type="button" id="add-to-cart">Add to cart</button><p id="cart-message" aria-live="polite">Your cart is empty</p></section></div>`, `document.querySelector('#add-to-cart').onclick=async()=>{const response=await fetch('/api/cart/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:${JSON.stringify(product.id)}})});const data=await response.json();if(data.added){const count=document.querySelector('#cart-count');count.textContent=String(Number(count.textContent)+1);document.querySelector('#cart-message').textContent='Added to cart';}else{document.querySelector('#cart-message').textContent='Could not add item';}};`);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/health' && req.method === 'GET') return json({ status: 'ok', application: 'Shop QA Demo' });
  if (url.pathname === '/api/cart/add' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return json({ error: 'Too much data' }, 400); }
    let data; try { data = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!products.some(p => p.id === data.productId)) return json({ error: 'Unknown product' }, 404);
    return json({ added: mode === 'fixed' });
  }
  if (url.pathname === '/api/control' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return json({ error: 'Too much data' }, 400); }
    const value = new URLSearchParams(raw).get('mode');
    if (!['buggy', 'fixed'].includes(value)) return json({ error: 'Invalid mode' }, 400);
    mode = value; res.writeHead(303, { Location: '/control' }); return res.end();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method not allowed'); }
  if (url.pathname === '/' || url.pathname === '/search') return res.end(catalog(url.pathname === '/search' ? url.searchParams.get('q') || '' : ''));
  if (url.pathname.startsWith('/products/')) { const p = products.find(p => url.pathname === `/products/${p.id}`); if (p) return res.end(detail(p)); }
  if (url.pathname === '/control') return res.end(layout('Demo controls', `<div class="control"><span class="tag">MANUAL TEST CONTROL</span><h1>Demo controls</h1><p>This page changes the intentional cart defect for your local testing.</p><h2 id="current-mode">Current mode ${mode === 'buggy' ? 'Bug enabled' : 'Fixed'}</h2><form action="/api/control" method="post"><label for="mode">Cart behavior</label><select name="mode" id="mode"><option value="buggy" ${mode === 'buggy' ? 'selected' : ''}>Bug enabled</option><option value="fixed" ${mode === 'fixed' ? 'selected' : ''}>Fixed</option></select><button type="submit" id="apply-mode">Apply mode</button></form><p>Refresh the product page after changing the mode. Every new product page starts with cart count 0. Restarting this demo restores Bug enabled.</p><a href="/">Open catalog</a></div>`));
  res.writeHead(404); res.end(layout('Page not found', '<h1>Page not found</h1><a href="/">Open catalog</a>'));
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Shop QA Demo running at http://127.0.0.1:${port}/ — cart defect enabled. Controls: /control`));
