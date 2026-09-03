import { data, refreshFromCentral } from './state.js';
import { platformClient } from './platform-client.js';
import { refreshCurrentScreen } from './router.js';

async function refresh(){
  const dot=document.getElementById('connDot'),label=document.getElementById('connLabel'),btn=document.getElementById('connBtn');
  const cfg=await platformClient.getSyncConfig();
  const c=cfg?.config||{}; const ready=!!(c.supabaseUrl&&c.anonKey&&c.householdId&&c.accessKey);
  if(dot) dot.className='dot '+(ready?'on':'off');
  if(label) label.textContent=ready?(data?._sync?.lastSyncAt?'Supabase sincronizado':'Supabase configurado'):'Supabase não configurado';
  if(btn) btn.textContent=ready?'Sincronizar':'Configurar Supabase';
}
export function initConnection(){
  const btn=document.getElementById('connBtn');
  if(btn) btn.onclick=async()=>{
    const cfg=await platformClient.getSyncConfig(); const c=cfg?.config||{}; const ready=!!(c.supabaseUrl&&c.anonKey&&c.householdId&&c.accessKey);
    if(!ready){ document.querySelector('[data-screen="config"]')?.click(); return; }
    btn.disabled=true; btn.textContent='Sincronizando…';
    const changed=await refreshFromCentral(); btn.disabled=false; await refresh();
    if(changed) refreshCurrentScreen();
  };
  refresh();
}
