// Nexo Web 1.0 — bridge de navegador.
// Mantém o mesmo contrato window.ganhosApp usado pelo renderer desktop,
// mas troca Electron/arquivo local por localStorage + Supabase REST.

(() => {
  const DATA_KEY = 'nexo-web-data-v1';
  const CONFIG_KEY = 'nexo-web-sync-config-v1';
  const LEGACY_DATA_KEYS = ['nexo-pwa-snapshot-v1'];
  const LEGACY_CONFIG_KEYS = ['nexo-pwa-config-v1'];
  const ARRAYS = ['expenses','uberEntries','incomes','priorities','investments','dividends','trips','tripItems','debts','debtPayments','creditCards','cardPurchases','cardInvoices','calendarEvents','profiles'];
  const MAPS = ['dailyEarnings','dailyActive','monthSettings'];
  const ROOTS = ['settings','carInstallment'];

  const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
  const stable = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  };
  const defaultData = () => ({
    dailyEarnings:{}, dailyActive:{}, monthSettings:{}, expenses:[], uberEntries:[], incomes:[], priorities:[], investments:[], dividends:[], trips:[], tripItems:[], debts:[], debtPayments:[], creditCards:[], cardPurchases:[], cardInvoices:[], calendarEvents:[], profiles:[], settings:{}, carInstallment:1400, _sync:{records:{}}
  });
  function ensureShape(input){
    const d = input && typeof input === 'object' ? input : defaultData();
    ARRAYS.forEach(k => { if(!Array.isArray(d[k])) d[k]=[]; });
    MAPS.forEach(k => { if(!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k]={}; });
    if(!d.settings || typeof d.settings!=='object') d.settings={};
    if(!d._sync || typeof d._sync!=='object') d._sync={records:{}};
    if(!d._sync.records || typeof d._sync.records!=='object') d._sync.records={};
    return d;
  }
  function loadJSON(key){ try { const s=localStorage.getItem(key); return s?JSON.parse(s):null; } catch { return null; } }
  function loadData(){
    let d=loadJSON(DATA_KEY);
    if(!d){ for(const k of LEGACY_DATA_KEYS){ d=loadJSON(k); if(d) break; } }
    return ensureShape(d || defaultData());
  }
  function saveData(d){ localStorage.setItem(DATA_KEY, JSON.stringify(ensureShape(clone(d)))); return {ok:true}; }
  function defaultConfig(){ return {provider:'supabase',supabaseUrl:'',anonKey:'',householdId:'',accessKey:''}; }
  function loadConfig(){
    let c=loadJSON(CONFIG_KEY);
    if(!c){ for(const k of LEGACY_CONFIG_KEYS){ c=loadJSON(k); if(c) break; } }
    return {...defaultConfig(),...(c||{})};
  }
  function saveConfig(c){
    const next={...defaultConfig(), supabaseUrl:String(c?.supabaseUrl||'').trim().replace(/\/rest\/v1\/?$/i,'').replace(/\/$/,''), anonKey:String(c?.anonKey||'').trim(), householdId:String(c?.householdId||'').trim(), accessKey:String(c?.accessKey||'').trim()};
    localStorage.setItem(CONFIG_KEY,JSON.stringify(next)); return next;
  }
  function validate(c=loadConfig()){
    const e=[]; try{ const u=new URL(c.supabaseUrl); if(u.protocol!=='https:') e.push('Project URL precisa usar HTTPS.'); }catch{e.push('Project URL do Supabase inválida.');}
    if(!c.anonKey) e.push('Anon / Public Key não informada.');
    if(!c.householdId) e.push('ID da família não informado.');
    if(!c.accessKey) e.push('Chave da família não informada.');
    return {ok:e.length===0,errors:e};
  }
  function headers(c){ return {apikey:c.anonKey,Authorization:`Bearer ${c.anonKey}`,'x-family-key':c.accessKey,'x-household-id':c.householdId,'Content-Type':'application/json'}; }
  async function request(c, route, options={}){
    const v=validate(c); if(!v.ok) throw new Error(v.errors.join(' '));
    const res=await fetch(`${c.supabaseUrl}/rest/v1/${route}`,{...options,headers:{...headers(c),...(options.headers||{})}});
    const text=await res.text(); let body=null; try{body=text?JSON.parse(text):null}catch{body=text}
    if(!res.ok) throw new Error(body?.message||body?.hint||body?.details||text||`HTTP ${res.status}`);
    return body;
  }
  function flatten(d){
    const map=new Map();
    for(const type of ARRAYS){ for(const item of d[type]||[]){ if(!item?.id) continue; let payload=clone(item); if(type==='profiles'&&payload.avatarType==='image'&&String(payload.avatarUrl||'').startsWith('blob:')){payload.avatarType='emoji';payload.avatarUrl=null;} map.set(`${type}:${item.id}`,{recordType:type,recordId:String(item.id),payload}); } }
    for(const type of MAPS){ for(const [id,payload] of Object.entries(d[type]||{})) map.set(`${type}:${id}`,{recordType:type,recordId:String(id),payload:clone(payload)}); }
    for(const id of ROOTS){ if(d[id]!==undefined) map.set(`$root:${id}`,{recordType:'$root',recordId:id,payload:clone(d[id])}); }
    return map;
  }
  function apply(d,r){
    if(ARRAYS.includes(r.recordType)){ const i=d[r.recordType].findIndex(x=>String(x?.id)===String(r.recordId)); if(i>=0)d[r.recordType][i]=clone(r.payload);else d[r.recordType].push(clone(r.payload)); }
    else if(MAPS.includes(r.recordType)) d[r.recordType][r.recordId]=clone(r.payload);
    else if(r.recordType==='$root') d[r.recordId]=clone(r.payload);
  }
  function removeLocal(d,type,id){ if(ARRAYS.includes(type))d[type]=d[type].filter(x=>String(x?.id)!==String(id));else if(MAPS.includes(type))delete d[type][id];else if(type==='$root')delete d[id]; }
  async function fetchRemote(c){ const h=encodeURIComponent(c.householdId); const rows=await request(c,`finance_records?household_id=eq.${h}&select=record_type,record_id,payload,updated_at`,{method:'GET'}); return (rows||[]).map(r=>({recordType:r.record_type,recordId:r.record_id,payload:r.payload,updatedAt:r.updated_at,hash:stable(r.payload)})); }
  async function upserts(c,records){ if(!records.length)return; for(let i=0;i<records.length;i+=100){ const rows=records.slice(i,i+100).map(r=>({household_id:c.householdId,access_key:c.accessKey,record_type:r.recordType,record_id:r.recordId,payload:r.payload,updated_at:new Date().toISOString()})); await request(c,'finance_records?on_conflict=household_id,record_type,record_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)}); } }
  async function deleteRemote(c,type,id){ const q=`finance_records?household_id=eq.${encodeURIComponent(c.householdId)}&record_type=eq.${encodeURIComponent(type)}&record_id=eq.${encodeURIComponent(id)}`; await request(c,q,{method:'DELETE',headers:{Prefer:'return=minimal'}}); }
  function financiallyFresh(d){ return ARRAYS.filter(k=>k!=='profiles').every(k=>!(d[k]||[]).length) && MAPS.every(k=>!Object.keys(d[k]||{}).length); }
  async function syncNow(local){
    const c=loadConfig(); const v=validate(c); if(!v.ok)return {ok:false,error:v.errors.join(' ')};
    try{
      let d=ensureShape(clone(local)); const meta=d._sync?.records||{}; const lm=flatten(d); const remote=await fetchRemote(c); const rm=new Map(remote.map(r=>[`${r.recordType}:${r.recordId}`,r])); const keys=new Set([...lm.keys(),...rm.keys(),...Object.keys(meta)]); const remoteHas=remote.length>0, fresh=financiallyFresh(d); const push=[], del=[]; let pulled=0, conflicts=0;
      for(const key of keys){ const l=lm.get(key), r=rm.get(key), prev=meta[key]; const lh=l?stable(l.payload):null,rh=r?.hash||null,last=prev?.lastSyncedHash||null; const lc=!!l&&lh!==last, rc=!!r&&rh!==last;
        if(!prev){ if(l&&r){ if(lh!==rh){ if(remoteHas){apply(d,r);pulled++;}else push.push(l);} } else if(l){ if(remoteHas&&fresh&&l.recordType==='profiles')removeLocal(d,l.recordType,l.recordId); else push.push(l);} else if(r){apply(d,r);pulled++;} continue; }
        if(l&&r){ if(!lc&&rc){apply(d,r);pulled++;} else if(lc){if(rc)conflicts++;push.push(l);} }
        else if(l&&!r){ if(lc)push.push(l); else removeLocal(d,l.recordType,l.recordId); }
        else if(!l&&r){ del.push({recordType:r.recordType,recordId:r.recordId}); }
      }
      await upserts(c,push); for(const x of del) await deleteRemote(c,x.recordType,x.recordId);
      const final=await fetchRemote(c); const fm=new Map(final.map(r=>[`${r.recordType}:${r.recordId}`,r])); const fl=flatten(d); const rec={}; for(const [key,l] of fl){const r=fm.get(key);rec[key]={lastSyncedHash:r?.hash||stable(l.payload),remoteUpdatedAt:r?.updatedAt||null};}
      d._sync={provider:'supabase',householdId:c.householdId,lastSyncAt:new Date().toISOString(),records:rec}; saveData(d); return {ok:true,data:d,stats:{pushed:push.length,pulled,conflicts,deletedRemote:del.length,remoteRecords:final.length},syncedAt:d._sync.lastSyncAt};
    }catch(e){return {ok:false,error:e.message||String(e)}}
  }
  async function pushCentralChanges(local){
    const c=loadConfig(),v=validate(c);if(!v.ok)return {ok:false,error:v.errors.join(' ')};
    try{ const d=ensureShape(clone(local)), meta=d._sync?.records||{}, lm=flatten(d), remote=await fetchRemote(c), rm=new Map(remote.map(r=>[`${r.recordType}:${r.recordId}`,r])), push=[],del=[];
      for(const [key,l] of lm){if(stable(l.payload)!==(meta[key]?.lastSyncedHash||null))push.push(l);} for(const key of Object.keys(meta)){if(!lm.has(key)&&rm.has(key)){const [t,...rest]=key.split(':');del.push({recordType:t,recordId:rest.join(':')});}}
      await upserts(c,push);for(const x of del)await deleteRemote(c,x.recordType,x.recordId);const final=await fetchRemote(c),fm=new Map(final.map(r=>[`${r.recordType}:${r.recordId}`,r])),rec={};for(const [key,l] of lm){const r=fm.get(key);rec[key]={lastSyncedHash:r?.hash||stable(l.payload),remoteUpdatedAt:r?.updatedAt||null};} const syncMeta={provider:'supabase',householdId:c.householdId,lastSyncAt:new Date().toISOString(),records:rec}; return {ok:true,syncMeta,stats:{pushed:push.length,deletedRemote:del.length}};
    }catch(e){return {ok:false,error:e.message||String(e)}}
  }
  async function pickProfileImage(){
    return new Promise(resolve=>{ const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=()=>{const file=input.files?.[0];if(!file)return resolve({ok:false,canceled:true});const reader=new FileReader();reader.onload=()=>resolve({ok:true,url:reader.result});reader.onerror=()=>resolve({ok:false,error:'Não foi possível ler a imagem.'});reader.readAsDataURL(file);};input.click(); });
  }
  window.ganhosApp={
    loadData:async()=>loadData(), saveData:async d=>saveData(d),
    getSyncConfig:async()=>({ok:true,config:loadConfig()}), saveSyncConfig:async c=>({ok:true,config:saveConfig(c)}),
    generateSyncFamily:async()=>({ok:true,householdId:crypto.randomUUID(),accessKey:crypto.randomUUID()}),
    testCentralSync:async()=>{const c=loadConfig(),start=Date.now();try{await fetchRemote(c);return{ok:true,latencyMs:Date.now()-start}}catch(e){return{ok:false,error:e.message}}},
    syncNow, pushCentralChanges,
    authStatus:async()=>({loggedIn:false}),login:async()=>({ok:false,error:'Integração Google legada não é usada na versão web.'}),logout:async()=>({ok:true}),readDashboard:async()=>({ok:false,error:'Planilha Google legada indisponível na versão web.'}),saveSimulation:async()=>({ok:true}),
    selectProfileImage:pickProfileImage
  };
})();
