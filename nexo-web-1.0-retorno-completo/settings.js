// Fase 10 — Configurações centrais do aplicativo.
// Mantém preferências no mesmo dados.json e não cria uma segunda camada de persistência.

import { data, scheduleSave, DEFAULT_CATEGORIES, getCategories, currency } from './state.js';
import { recalc } from './simulator.js';
import { renderDashboard } from './dashboard.js';
import { renderMovements } from './movements.js';
import { renderExpenses } from './expenses.js';
import { renderCards } from './cards.js';
import { showAlert, showConfirm } from './ui-dialogs.js';
import { platformClient } from './platform-client.js';

const CATEGORY_GROUPS = [
  ['expenses', 'Saídas'],
  ['incomes', 'Entradas'],
  ['cardPurchases', 'Compras no cartão'],
];

function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function clamp(v,min,max){ return Math.min(Math.max(Number(v)||0,min),max); }


let syncConfigCache = { supabaseUrl:'', anonKey:'', householdId:'', accessKey:'' };

function setSyncStatus(label, tone='muted') {
  const el = document.getElementById('syncStatusBadge');
  if (!el) return;
  el.className = `sync-status-badge ${tone}`;
  el.textContent = label;
}

function syncConfigFromForm() {
  return {
    supabaseUrl: document.getElementById('syncSupabaseUrl')?.value.trim() || '',
    anonKey: document.getElementById('syncAnonKey')?.value.trim() || '',
    householdId: document.getElementById('syncHouseholdId')?.value.trim() || '',
    accessKey: document.getElementById('syncAccessKey')?.value.trim() || '',
  };
}

function renderSyncPanel(config = syncConfigCache) {
  const el = document.getElementById('centralSyncSettings');
  if (!el) return;
  const lastSync = data?._sync?.lastSyncAt ? new Date(data._sync.lastSyncAt).toLocaleString('pt-BR') : 'Nunca';
  el.innerHTML = `
    <div class="sync-config-grid">
      <label class="settings-field sync-span-2"><span>Project URL do Supabase</span><input id="syncSupabaseUrl" class="input-field" value="${esc(config.supabaseUrl || '')}" placeholder="https://xxxx.supabase.co"></label>
      <label class="settings-field sync-span-2"><span>Anon / publishable key</span><input id="syncAnonKey" class="input-field mono" type="password" value="${esc(config.anonKey || '')}" placeholder="Use somente a chave pública/anon — nunca service_role"></label>
      <label class="settings-field"><span>ID da família</span><div class="sync-secret-row"><input id="syncHouseholdId" class="input-field mono" value="${esc(config.householdId || '')}" placeholder="UUID compartilhado"><button id="syncCopyHouseholdId" class="btn-ghost sync-field-action" type="button" title="Copiar ID da família">Copiar</button></div></label>
      <label class="settings-field"><span>Chave da família</span><div class="sync-secret-row"><input id="syncAccessKey" class="input-field mono" type="password" value="${esc(config.accessKey || '')}" placeholder="UUID privado compartilhado"><button id="syncToggleAccessKey" class="btn-ghost sync-field-action sync-eye-btn" type="button" title="Mostrar chave da família">Mostrar</button><button id="syncCopyAccessKey" class="btn-ghost sync-field-action" type="button" title="Copiar chave da família">Copiar</button></div></label>
      <label class="settings-toggle sync-toggle"><input id="syncOnStart" type="checkbox" ${data.settings.centralSyncOnStart ? 'checked' : ''}><span><strong>Sincronização automática</strong><small>Busca alterações ao abrir e ao voltar para a janela do app. Funciona offline quando não houver conexão.</small></span></label>
      <label class="settings-toggle sync-toggle"><input id="syncAutoPush" type="checkbox" ${data.settings.centralSyncAutoPush ? 'checked' : ''}><span><strong>Enviar alterações automaticamente</strong><small>Continua salvando local primeiro e envia mudanças ao Supabase em segundo plano.</small></span></label>
    </div>
    <div class="sync-actions-row">
      <button id="syncGenerateFamily" class="btn-ghost"><span class="app-icon icon-user sm"></span>Gerar espaço familiar</button>
      <button id="syncSaveConfig" class="btn-ghost"><span class="app-icon icon-circle-check sm"></span>Salvar conexão</button>
      <button id="syncTestBtn" class="btn-ghost">Testar conexão</button>
      <button id="syncNowBtn" class="btn-primary">Sincronizar agora</button>
    </div>
    <div class="sync-meta-grid">
      <div><span>Última sincronização</span><strong>${esc(lastSync)}</strong></div>
      <div><span>Estratégia</span><strong>Local-first + merge por registro</strong></div>
      <div><span>Conflito simultâneo</span><strong>Dispositivo que sincroniza vence</strong></div>
    </div>
    <div class="sync-warning">Execute primeiro o arquivo <strong>SUPABASE_SETUP.sql</strong> no SQL Editor do Supabase. A <strong>service_role</strong> nunca deve ser informada neste aplicativo.</div>`;
  bindSyncActions();
}

async function loadSyncPanel() {
  try {
    const res = await platformClient.getSyncConfig();
    if (res?.ok) syncConfigCache = res.config || syncConfigCache;
    renderSyncPanel(syncConfigCache);
    const configured = syncConfigCache.supabaseUrl && syncConfigCache.anonKey && syncConfigCache.householdId && syncConfigCache.accessKey;
    setSyncStatus(configured ? (data?._sync?.lastSyncAt ? 'Sincronizado' : 'Configurado') : 'Não configurado', configured ? 'ok' : 'muted');
  } catch {
    renderSyncPanel(syncConfigCache);
    setSyncStatus('Indisponível', 'error');
  }
}

async function copySyncField(inputId, label) {
  const input = document.getElementById(inputId);
  const value = input?.value?.trim() || '';
  if (!value) { await showAlert(`${label} ainda não foi definido.`); return; }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      input.focus();
      input.select();
      document.execCommand('copy');
      input.setSelectionRange?.(value.length, value.length);
    }
    await showAlert(`${label} copiado para a área de transferência.`);
  } catch {
    input.focus();
    input.select();
    await showAlert(`Não foi possível copiar automaticamente. O campo ${label.toLowerCase()} foi selecionado para você copiar manualmente.`);
  }
}

function bindSyncActions() {
  const copyHousehold = document.getElementById('syncCopyHouseholdId');
  if (copyHousehold) copyHousehold.onclick = () => copySyncField('syncHouseholdId', 'ID da família');

  const toggleAccess = document.getElementById('syncToggleAccessKey');
  if (toggleAccess) toggleAccess.onclick = () => {
    const input = document.getElementById('syncAccessKey');
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggleAccess.textContent = showing ? 'Mostrar' : 'Ocultar';
    toggleAccess.title = showing ? 'Mostrar chave da família' : 'Ocultar chave da família';
  };

  const copyAccess = document.getElementById('syncCopyAccessKey');
  if (copyAccess) copyAccess.onclick = () => copySyncField('syncAccessKey', 'Chave da família');

  const generate = document.getElementById('syncGenerateFamily');
  if (generate) generate.onclick = async () => {
    const res = await platformClient.generateSyncFamily();
    if (!res?.ok) return;
    document.getElementById('syncHouseholdId').value = res.householdId;
    document.getElementById('syncAccessKey').value = res.accessKey;
    await showAlert('Novo espaço familiar gerado. Use os mesmos dados de conexão no outro dispositivo.');
  };

  const save = document.getElementById('syncSaveConfig');
  if (save) save.onclick = async () => {
    const cfg = syncConfigFromForm();
    const res = await platformClient.saveSyncConfig(cfg);
    data.settings.centralSyncOnStart = !!document.getElementById('syncOnStart')?.checked;
    data.settings.centralSyncAutoPush = !!document.getElementById('syncAutoPush')?.checked;
    scheduleSave();
    if (!res?.ok) { setSyncStatus('Erro', 'error'); await showAlert(res?.error || 'Não foi possível salvar.'); return; }
    syncConfigCache = cfg;
    if (!res.validation?.ok) {
      setSyncStatus('Configuração incompleta', 'warn');
      await showAlert((res.validation?.errors || []).join('\n'));
      return;
    }
    setSyncStatus('Configurado', 'ok');
    await showAlert('Conexão salva. Agora você pode testar ou sincronizar.');
  };

  const test = document.getElementById('syncTestBtn');
  if (test) test.onclick = async () => {
    setSyncStatus('Testando…', 'busy');
    const saveRes = await platformClient.saveSyncConfig(syncConfigFromForm());
    if (!saveRes?.validation?.ok) { setSyncStatus('Configuração incompleta', 'warn'); await showAlert((saveRes.validation?.errors || []).join('\n')); return; }
    const res = await platformClient.testCentralSync();
    if (res?.ok) { setSyncStatus('Conectado', 'ok'); await showAlert(`Conexão com Supabase OK (${res.latencyMs} ms).`); }
    else { setSyncStatus('Falha na conexão', 'error'); await showAlert(`Falha: ${res?.error || 'erro desconhecido'}`); }
  };

  const sync = document.getElementById('syncNowBtn');
  if (sync) sync.onclick = async () => {
    const cfg = syncConfigFromForm();
    const saveRes = await platformClient.saveSyncConfig(cfg);
    data.settings.centralSyncOnStart = !!document.getElementById('syncOnStart')?.checked;
    data.settings.centralSyncAutoPush = !!document.getElementById('syncAutoPush')?.checked;
    await platformClient.saveData(data);
    if (!saveRes?.validation?.ok) { setSyncStatus('Configuração incompleta', 'warn'); await showAlert((saveRes.validation?.errors || []).join('\n')); return; }
    if (!(await showConfirm('Sincronizar agora? Registros locais e remotos serão mesclados por ID. Em conflito simultâneo, esta cópia local terá prioridade.'))) return;
    sync.disabled = true; setSyncStatus('Sincronizando…', 'busy');
    const res = await platformClient.syncNow(data);
    sync.disabled = false;
    if (!res?.ok) { setSyncStatus('Erro de sync', 'error'); await showAlert(res?.error || 'Falha ao sincronizar.'); return; }
    const s = res.stats || {};
    setSyncStatus('Sincronizado', 'ok');
    await showAlert(`Sincronização concluída.\nEnviados: ${s.pushed||0}\nRecebidos: ${s.pulled||0}\nConflitos resolvidos: ${s.conflicts||0}\nExclusões remotas: ${s.deletedRemote||0}`);
    window.location.reload();
  };
}

function resolvedTheme(theme) {
  if (theme !== 'system') return theme || 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyGlobalSettings() {
  const s = data.settings || {};
  document.body.classList.toggle('compact-ui', !!s.compactMode);
  document.documentElement.dataset.theme = resolvedTheme(s.theme);
  const brand = document.querySelector('.sidebar-header');
  if (brand) brand.innerHTML = `<img class="nexo-brand-mark" src="assets/branding/nexo-mark.png" alt=""><span>Nexo</span>`;
  const active = (data.profiles || []).find((p) => p.id === s.activeProfileId) || data.profiles?.[0];
  const avatar = document.getElementById('sidebarProfileAvatar');
  const name = document.getElementById('sidebarProfileName');
  if (avatar && active) {
    avatar.className = `sidebar-profile-avatar profile-color-${active.color || 'cyan'}`;
    avatar.innerHTML = active.avatarType === 'image' && active.avatarUrl
      ? `<img src="${active.avatarUrl}" alt="">`
      : `<span>${active.avatarEmoji || '👤'}</span>`;
  }
  if (name) name.textContent = active?.name || 'Perfil';
}

function renderCategoryGroup(kind, label) {
  const items = getCategories(kind);
  return `<div class="settings-category-block" data-kind="${kind}">
    <div class="settings-category-head"><div><strong>${label}</strong><span>${items.length} categoria(s)</span></div></div>
    <div class="settings-category-chips">${items.map((item) => `<span class="settings-chip">${esc(item)}<button class="settings-chip-remove" data-kind="${kind}" data-value="${esc(item)}" title="Remover">×</button></span>`).join('')}</div>
    <div class="settings-category-add"><input class="input-field" data-category-input="${kind}" placeholder="Nova categoria"><button class="btn-ghost small add-setting-category" data-kind="${kind}">+ Adicionar</button></div>
  </div>`;
}

function syncLiveControls() {
  const s = data.settings;
  const invest = document.getElementById('investPercent');
  const growth = document.getElementById('growthRate');
  if (invest) invest.value = s.investPercent;
  if (growth) growth.value = s.growthRate;
  const il = document.getElementById('investPercentLabel'); if (il) il.textContent = `${s.investPercent}%`;
  const gl = document.getElementById('growthLabel'); if (gl) gl.textContent = `${s.growthRate}%`;
  const carLabel = document.getElementById('carValueLabel'); if (carLabel) carLabel.textContent = currency(data.carInstallment || 0);
  recalc();
}

async function saveGeneralSettings() {
  const familyName = document.getElementById('settingFamilyName').value.trim();
  const currencyCode = document.getElementById('settingCurrency').value;
  const theme = document.getElementById('settingTheme').value;
  const investPercent = clamp(document.getElementById('settingInvestPercent').value, 0, 100);
  const growthRate = clamp(document.getElementById('settingGrowthRate').value, -20, 50);
  const uberReservePercent = clamp(document.getElementById('settingUberReserve').value, 0, 100);
  const carInstallment = Math.max(Number(document.getElementById('settingCarInstallment').value) || 0, 0);
  const compactMode = document.getElementById('settingCompactMode').checked;

  const centralSyncOnStart = !!document.getElementById('syncOnStart')?.checked;
  const centralSyncAutoPush = !!document.getElementById('syncAutoPush')?.checked;
  Object.assign(data.settings, { familyName, investPercent, growthRate, uberReservePercent, compactMode, currency: currencyCode, theme, centralSyncOnStart, centralSyncAutoPush });
  data.carInstallment = carInstallment;
  scheduleSave();
  applyGlobalSettings();
  syncLiveControls();
  renderDashboard(); renderMovements(); renderExpenses(); renderCards();
  await showAlert('Configurações salvas. A troca de moeda altera apenas a exibição; os valores não são convertidos.');
}

function bindCategoryActions() {
  document.querySelectorAll('.add-setting-category').forEach((btn) => btn.onclick = async () => {
    const kind = btn.dataset.kind;
    const input = document.querySelector(`[data-category-input="${kind}"]`);
    const value = input.value.trim();
    if (!value) return;
    const current = getCategories(kind);
    if (current.some((c) => c.toLowerCase() === value.toLowerCase())) { await showAlert('Essa categoria já existe.'); return; }
    data.settings.categories[kind] = [...current, value];
    scheduleSave(); renderSettings();
  });

  document.querySelectorAll('.settings-chip-remove').forEach((btn) => btn.onclick = async () => {
    const kind = btn.dataset.kind, value = btn.dataset.value;
    const current = getCategories(kind);
    if (current.length <= 1) { await showAlert('Mantenha pelo menos uma categoria.'); return; }
    if (!(await showConfirm(`Remover a categoria “${value}”? Lançamentos antigos manterão o nome já salvo.`))) return;
    data.settings.categories[kind] = current.filter((c) => c !== value);
    scheduleSave(); renderSettings();
  });
}

export function renderSettings() {
  const s = data.settings;
  document.getElementById('settingsGeneral').innerHTML = `
    <label class="settings-field"><span>Nome do painel / família</span><input id="settingFamilyName" class="input-field" value="${esc(s.familyName || '')}" placeholder="Minha família"></label>
    <label class="settings-field"><span>Moeda de exibição</span><select id="settingCurrency" class="input-field">
      <option value="BRL" ${s.currency==='BRL'?'selected':''}>BRL — Real brasileiro (R$)</option>
      <option value="USD" ${s.currency==='USD'?'selected':''}>USD — Dólar americano (US$)</option>
      <option value="EUR" ${s.currency==='EUR'?'selected':''}>EUR — Euro (€)</option>
      <option value="GBP" ${s.currency==='GBP'?'selected':''}>GBP — Libra esterlina (£)</option>
    </select><small>Troca somente a formatação. Não converte lançamentos existentes.</small></label>
    <label class="settings-field"><span>Tema</span><select id="settingTheme" class="input-field">
      <option value="dark" ${s.theme==='dark'?'selected':''}>Escuro</option>
      <option value="light" ${s.theme==='light'?'selected':''}>Claro</option>
      <option value="system" ${s.theme==='system'?'selected':''}>Seguir sistema</option>
    </select></label>`;

  document.getElementById('settingsPlanning').innerHTML = `
    <label class="settings-field"><span>% padrão para investir</span><input id="settingInvestPercent" class="input-field mono" type="number" min="0" max="100" step="1" value="${Number(s.investPercent)||0}"></label>
    <label class="settings-field"><span>Crescimento esperado / mês</span><input id="settingGrowthRate" class="input-field mono" type="number" min="-20" max="50" step="0.1" value="${Number(s.growthRate)||0}"></label>
    <label class="settings-field"><span>% padrão para separar no Uber</span><input id="settingUberReserve" class="input-field mono" type="number" min="0" max="100" step="0.1" value="${Number(s.uberReservePercent)||0}"></label>
    <label class="settings-field"><span>Parcela mensal do carro</span><input id="settingCarInstallment" class="input-field mono" type="number" min="0" step="0.01" value="${Number(data.carInstallment)||0}"></label>
    <label class="settings-toggle"><input id="settingCompactMode" type="checkbox" ${s.compactMode ? 'checked' : ''}><span><strong>Modo compacto</strong><small>Reduz espaçamentos gerais do aplicativo.</small></span></label>`;

  document.getElementById('settingsCategories').innerHTML = CATEGORY_GROUPS.map(([kind,label]) => renderCategoryGroup(kind,label)).join('');
  document.getElementById('settingsSystem').innerHTML = `
    <div class="settings-system-row"><span>Versão do app</span><strong class="mono">${esc(s.appVersion || '3.1.0')}</strong></div>
    <div class="settings-system-row"><span>Schema local</span><strong class="mono">v${Number(s.schemaVersion)||4}</strong></div>
    <div class="settings-system-row"><span>Persistência local</span><strong>dados.json (cache/offline)</strong></div>
    <div class="settings-system-row"><span>Banco central</span><strong>${data?._sync?.lastSyncAt ? 'Supabase sincronizado' : 'Supabase disponível para configurar'}</strong></div>`;
  bindCategoryActions();
  loadSyncPanel();
}

export function initSettings() {
  document.getElementById('saveSettingsBtn').onclick = saveGeneralSettings;
  document.getElementById('resetSettingsBtn').onclick = async () => {
    if (!(await showConfirm('Restaurar preferências gerais e categorias padrão? Seus lançamentos financeiros NÃO serão apagados.'))) return;
    data.settings = {
      schemaVersion: 4, appVersion: '3.1.0', profileName: '', familyName: '', currency: 'BRL', theme: 'dark', activeProfileId: data.settings.activeProfileId, compactMode: false,
      investPercent: 30, growthRate: 0, uberReservePercent: 0, centralSyncOnStart: false, centralSyncAutoPush: false,
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
    };
    scheduleSave(); applyGlobalSettings(); syncLiveControls(); renderSettings(); renderDashboard(); renderMovements(); renderExpenses(); renderCards();
  };
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
      if (data.settings.theme === 'system') applyGlobalSettings();
    });
  }
  applyGlobalSettings();
  renderSettings();
}
