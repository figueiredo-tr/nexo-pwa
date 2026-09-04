// Fase 10.1 — Perfis locais compartilhando a mesma base financeira.
import { data, genId, scheduleSave } from './state.js';
import { applyGlobalSettings } from './settings.js';
import { showAlert, showConfirm } from './ui-dialogs.js';
import { platformClient } from './platform-client.js';

const EMOJIS = ['👤','😎','🙂','🤓','🚗','💰','📈','⭐','🧳','🐱','🐶','💙','💜','🔥','🌟','🏠'];
const COLORS = ['cyan','purple','green','gold','pink','orange'];
const MOBILE_SHORTCUTS = [['uber','Uber'],['cards','Cartões'],['priorities','Prioridades'],['reports','Relatórios'],['calendar','Calendário'],['investments','Investir'],['trips','Viagens']];
function esc(v=''){ return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function activeProfile(){ return data.profiles.find(p=>p.id===data.settings.activeProfileId) || data.profiles[0]; }
function avatarHtml(p, cls='profile-avatar-large'){
  const inner = p.avatarType==='image' && p.avatarUrl ? `<img src="${esc(p.avatarUrl)}" alt="">` : `<span>${p.avatarEmoji||'👤'}</span>`;
  return `<div class="${cls} profile-color-${p.color||'cyan'}">${inner}</div>`;
}
function setActive(id){
  if(!data.profiles.some(p=>p.id===id)) return;
  data.settings.activeProfileId=id; scheduleSave(); applyGlobalSettings(); renderProfile();
}
function renderProfileList(){
  const el=document.getElementById('profileList'); if(!el) return;
  const active=activeProfile();
  el.innerHTML=data.profiles.map(p=>`<button class="profile-list-item ${p.id===active?.id?'active':''}" data-profile-id="${p.id}">
    ${avatarHtml(p,'profile-avatar-small')}<span><strong>${esc(p.name)}</strong><small>${p.id===active?.id?'Perfil ativo':'Usar este perfil'}</small></span><i>›</i>
  </button>`).join('') + `<button id="newProfileBtn" class="profile-add-btn">＋ Criar novo perfil</button>`;
  el.querySelectorAll('[data-profile-id]').forEach(b=>b.onclick=()=>setActive(b.dataset.profileId));
  document.getElementById('newProfileBtn').onclick=()=>createProfile();
}
function createProfile(){
  const now=new Date().toISOString(), id=genId();
  data.profiles.push({id,name:`Perfil ${data.profiles.length+1}`,avatarType:'emoji',avatarEmoji:'👤',avatarUrl:null,color:'cyan',mobilePrimaryShortcut:'uber',createdAt:now,updatedAt:now});
  data.settings.activeProfileId=id; scheduleSave(); applyGlobalSettings(); renderProfile();
}
async function choosePhoto(profile){
  const res=await platformClient.selectProfileImage(profile.id);
  if(!res?.ok){ if(!res?.canceled) await showAlert(res?.error||'Não foi possível carregar a imagem.'); return; }
  profile.avatarType='image'; profile.avatarUrl=res.url; profile.updatedAt=new Date().toISOString(); scheduleSave(); applyGlobalSettings(); renderProfile();
}
function renderEditor(){
  const p=activeProfile(), el=document.getElementById('profileEditor'); if(!el||!p) return;
  el.innerHTML=`<div class="profile-editor-head">${avatarHtml(p)}<div><div class="eyebrow">PERFIL ATIVO</div><div class="profile-editor-name">${esc(p.name)}</div><div class="profile-shared-note">Todos os perfis veem a mesma base financeira.</div></div></div>
    <div class="profile-form-grid">
      <label class="settings-field"><span>Nome do perfil</span><input id="profileNameInput" class="input-field" value="${esc(p.name)}"></label>
      <div class="settings-field"><span>Avatar por emoji</span><div class="emoji-picker">${EMOJIS.map(e=>`<button class="emoji-option ${p.avatarType==='emoji'&&p.avatarEmoji===e?'active':''}" data-emoji="${e}">${e}</button>`).join('')}</div></div>
      <div class="settings-field"><span>Foto de perfil</span><div class="profile-photo-actions"><button id="chooseProfilePhoto" class="btn-ghost">Escolher foto</button>${p.avatarType==='image'?'<button id="removeProfilePhoto" class="btn-ghost">Usar emoji</button>':''}</div></div>
      <div class="settings-field"><span>Cor do perfil</span><div class="profile-color-picker">${COLORS.map(c=>`<button class="profile-color-option profile-color-${c} ${p.color===c?'active':''}" data-color="${c}" title="${c}"></button>`).join('')}</div></div>
      <label class="settings-field"><span>Atalho principal no celular</span><select id="profileMobileShortcut" class="input-field">${MOBILE_SHORTCUTS.map(([id,label])=>`<option value="${id}" ${(p.mobilePrimaryShortcut||'uber')===id?'selected':''}>${label}</option>`).join('')}</select><small>Substitui a terceira aba do mobile apenas para este perfil.</small></label>
    </div>
    <div class="profile-editor-actions"><button id="saveProfileBtn" class="btn-primary"><span class="app-icon icon-circle-check sm"></span>Salvar perfil</button>${data.profiles.length>1?'<button id="deleteProfileBtn" class="btn-ghost danger">Excluir perfil</button>':''}</div>
    <div class="profile-future-box"><strong>Perfis familiares ativos</strong><span>Novos lançamentos do mobile guardam autoria por perfil, e cada perfil pode ter um atalho principal diferente sem separar a base financeira da família.</span></div>`;
  el.querySelectorAll('[data-emoji]').forEach(b=>b.onclick=()=>{ p.avatarType='emoji'; p.avatarEmoji=b.dataset.emoji; p.avatarUrl=null; p.updatedAt=new Date().toISOString(); scheduleSave(); applyGlobalSettings(); renderProfile(); });
  el.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{ p.color=b.dataset.color; p.updatedAt=new Date().toISOString(); scheduleSave(); applyGlobalSettings(); renderProfile(); });
  document.getElementById('chooseProfilePhoto').onclick=()=>choosePhoto(p);
  const remove=document.getElementById('removeProfilePhoto'); if(remove) remove.onclick=()=>{p.avatarType='emoji';p.avatarUrl=null;scheduleSave();applyGlobalSettings();renderProfile();};
  document.getElementById('saveProfileBtn').onclick=async()=>{ const name=document.getElementById('profileNameInput').value.trim(); if(!name){await showAlert('Informe o nome do perfil.');return;} p.name=name;p.mobilePrimaryShortcut=document.getElementById('profileMobileShortcut')?.value||p.mobilePrimaryShortcut||'uber';p.updatedAt=new Date().toISOString();scheduleSave();applyGlobalSettings();renderProfile();await showAlert('Perfil salvo.'); };
  const del=document.getElementById('deleteProfileBtn'); if(del) del.onclick=async()=>{ if(!(await showConfirm(`Excluir o perfil “${p.name}”? Seus dados financeiros não serão apagados.`)))return; data.profiles=data.profiles.filter(x=>x.id!==p.id);data.settings.activeProfileId=data.profiles[0]?.id||null;scheduleSave();applyGlobalSettings();renderProfile(); };
}
export function renderProfile(){ renderProfileList(); renderEditor(); }
export function initProfile(){ scheduleSave(); renderProfile(); }
