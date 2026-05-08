// Verify the 4 bug fixes:
//   Bug 1: convenience store deposit multi-step flow
//   Bug 2/3: stale flow_state cleared → menu clicks restart proper flow
//   Bug 4: widget side (manual visual check)
const BASE = 'https://sloten-standalone-staging-bk.rcc-aoki.workers.dev';

async function api(m,p,b,t){const h={'Content-Type':'application/json'};if(t)h['X-Sloten-Contact-Token']=t;const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined});const x=await r.text();let d;try{d=JSON.parse(x)}catch{d={raw:x}}if(!r.ok)throw new Error(`HTTP ${r.status}: ${d.error||x.slice(0,200)}`);return d;}
async function setup(){const c=await api('POST','/api/widget/contacts',{tenant_id:'tenant_default'});const cv=await api('POST','/api/widget/conversations',{contact_id:c.contact.id,tenant_id:'tenant_default'},c.contact_token);return{token:c.contact_token,convId:cv.conversation.id};}
async function send(c,t,x){return api('POST',`/api/widget/conversations/${c}/messages`,{sender_type:'customer',content:x},t);}
const reply = (r) => {
  const replies = r.bot_replies || (r.bot_reply ? [r.bot_reply] : []);
  return replies.map(x => ({ content: x?.content || '', type: x?.content_type || 'text', items: x?.content_attributes?.items?.length || 0 }));
};

console.log('=== TEST 1: コンビニ入金 multi-step flow ===');
{
  const { convId, token } = await setup();
  await send(convId, token, 'こんにちは'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'deposit_withdrawal'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'deposit_methods'); await new Promise(r=>setTimeout(r,200));
  // Click コンビニ入金
  let r = await send(convId, token, 'convenience_store_deposit');
  console.log('Step 1 reply:', reply(r));
  await new Promise(r=>setTimeout(r,400));
  // Should ask for account ID — input "syt2525m"
  r = await send(convId, token, 'syt2525m');
  console.log('Step 2 reply (after account ID):', reply(r));
  await new Promise(r=>setTimeout(r,400));
  // Should show amount select — pick 5000
  r = await send(convId, token, '5000');
  console.log('Step 3 reply (after amount):', reply(r));
}

console.log('\n=== TEST 2: 銀行振込→AI standby→ボーナス・プロモ click → 正しい sub-menu ===');
{
  const { convId, token } = await setup();
  await send(convId, token, 'こんにちは'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'deposit_withdrawal'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'deposit_methods'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'bank_transfer'); await new Promise(r=>setTimeout(r,500));
  // Now in AI standby. Click "ボーナス・プロモ" from welcome menu (re-emits trigger)
  const r = await send(convId, token, 'bonus_promo');
  const replies = reply(r);
  console.log('After bonus_promo click:', replies);
  // Expect input_select with > 0 items (the configured sub-menu)
  const isSelect = replies.some(x => x.type === 'input_select' && x.items > 0);
  console.log(isSelect ? '✅ PASS: configured sub-menu' : '❌ FAIL: hit AI fallback');
}

console.log('\n=== TEST 3: 同様、ボーナスコード申請 ===');
{
  const { convId, token } = await setup();
  await send(convId, token, 'こんにちは'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'deposit_withdrawal'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'deposit_methods'); await new Promise(r=>setTimeout(r,200));
  await send(convId, token, 'bank_transfer'); await new Promise(r=>setTimeout(r,500));
  const r = await send(convId, token, 'bonus_code_request');
  const replies = reply(r);
  console.log('After bonus_code_request click:', replies);
  // Expect message "ボーナスコードをお持ちの場合は..." with the bonus_code_request prompt
  const hasCorrectPrompt = replies.some(x => (x.content || '').includes('ボーナスコード'));
  console.log(hasCorrectPrompt ? '✅ PASS: correct bonus_code prompt' : '❌ FAIL: wrong/AI response');
}
