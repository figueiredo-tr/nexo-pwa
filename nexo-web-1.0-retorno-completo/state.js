// Estado compartilhado entre os módulos do renderer (Simulador, Saídas, e os
// que vierem na Fase 2B+). Extraído do app.js na Fase 2A — mesmos valores e
// mesmo comportamento de antes, só isolados aqui.

import {
  APP_VERSION, SCHEMA_VERSION, MONTH_NAMES, WEEKDAY_NAMES, DEFAULT_CATEGORIES,
  formatCurrency, pad2, monthKey, dateKey, daysInMonth, uberSummary,
} from './shared/finance-core.js';
import { platformClient } from './platform-client.js';

export { MONTH_NAMES, WEEKDAY_NAMES, DEFAULT_CATEGORIES, pad2, monthKey, dateKey, daysInMonth };

export const today = new Date();

// Mantém o contrato público do state.js usado pelos módulos do desktop.
// A Fase 12 moveu os defaults para o núcleo compartilhado, mas os seletores
// continuam consultando as categorias personalizadas através desta função.
export function getCategories(kind) {
  const list = data?.settings?.categories?.[kind];
  const fallback = DEFAULT_CATEGORIES[kind] || ['Outros'];
  const source = Array.isArray(list) && list.length ? list : fallback;
  return [...new Set(source.map((v) => String(v).trim()).filter(Boolean))];
}

// Objeto único e mutável — módulos importam { view } e mutam as propriedades
// diretamente (o objeto em si nunca é reatribuído, então todo mundo que
// importou continua vendo o mesmo estado).
export const view = {
  tab: 'sim',
  year: today.getFullYear(),
  month: today.getMonth(), // 0-indexed
  yearSaidas: today.getFullYear(),
  monthSaidas: today.getMonth(),
  selectedWeekIdx: 0,
  // ---- Uber / Entradas reais (Fase 5.5A) ----
  yearUber: today.getFullYear(),
  monthUber: today.getMonth(),
  selectedWeekIdxUber: 0,
  // ---- Movimentos / outras entradas (Fase 5.5B) ----
  yearMovimentos: today.getFullYear(),
  monthMovimentos: today.getMonth(),
  filterTipoMovimentos: 'todos', // 'todos' | 'entradas' | 'saidas'
  searchMovimentos: '',
  editingIncomeId: null,
  // ---- Visão Geral real (Fase 5.5C) ----
  yearOverview: today.getFullYear(),
  monthOverview: today.getMonth(),
  editingExpenseId: null,
  // ---- Prioridades (Fase 3) ----
  yearPrioridades: today.getFullYear(),
  monthPrioridades: today.getMonth(),
  filterStatusPrioridades: 'todos',
  filterNivelPrioridades: 'todos',
  sortAscPrioridades: true,
  editingPriorityId: null,
  // ---- Investimentos (Fase 4) ----
  yearInvestimentos: today.getFullYear(),
  monthInvestimentos: today.getMonth(),
  filterTipoInvestimento: 'todos',
  filterAtivoInvestimento: 'ativos', // 'ativos' | 'inativos' | 'todos'
  searchInvestimentos: '',
  sortFieldInvestimentos: 'valorAtual', // 'valorAtual' | 'rentabilidade'
  sortDescInvestimentos: true,
  editingInvestmentId: null,
  openInvestmentId: null, // investimento com histórico de rendimentos expandido
  addingDividendFor: null, // id do investimento com o form de rendimento aberto
  editingDividendId: null,
  // ---- Viagens (Fase 5) ----
  filterStatusTrips: 'todos',
  searchTrips: '',
  sortFieldTrips: 'dataIda', // 'dataIda' | 'orcamento' | 'faltante'
  sortDescTrips: false,
  editingTripId: null,
  openTripId: null,
  editingTripItemId: null,
  // ---- Dívidas (Fase 6) ----
  filterStatusDebts: 'todos',
  searchDebts: '',
  sortFieldDebts: 'saldo', // 'saldo' | 'vencimento' | 'parcela'
  sortDescDebts: true,
  editingDebtId: null,
  openDebtId: null,
  payingDebtId: null,
  // ---- Cartões (Fase 7) ----
  yearCartoes: today.getFullYear(),
  monthCartoes: today.getMonth(),
  filterCardStatus: 'ativos', // 'ativos' | 'inativos' | 'todos'
  searchCards: '',
  editingCardId: null,
  openCardId: null,
  editingCardPurchaseId: null,
  purchaseCardId: null,
  // ---- Calendário financeiro (Fase 8) ----
  yearCalendario: today.getFullYear(),
  monthCalendario: today.getMonth(),
  selectedCalendarDate: null,
  filterCalendario: 'todos',
  editingCalendarEventId: null,
  // ---- Relatórios (Fase 9) ----
  yearRelatorios: today.getFullYear(),
  monthRelatorios: today.getMonth(),
  reportRange: 12, // últimos 6 ou 12 meses, encerrando no mês selecionado
};

// "data" é reatribuído uma única vez, dentro de initData() (após carregar do
// disco). Por ser um binding de export ES module, quem importar { data }
// enxerga o valor atualizado automaticamente depois que initData() resolve.
export let data = null;

let saveTimer = null;
let syncPushTimer = null;

export const currency = (value) => formatCurrency(value, data?.settings?.currency || 'BRL');

// Gerador de id no renderer (browser). Ainda NÃO utilizado nesta fase —
// Saídas continua com Date.now() como id local, sem mudança de comportamento.
// Fica pronto pra Fase 2B (Prioridades, Investimentos, Viagens, Dívidas).
export function genId() {
  return crypto.randomUUID();
}

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await platformClient.saveData(data);
    if (!data?.settings?.centralSyncAutoPush) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(async () => {
      try {
        const res = await platformClient.pushCentralChanges(data);
        if (res?.ok && res.syncMeta) {
          data._sync = res.syncMeta;
          await platformClient.saveData(data);
        }
      } catch {
        // Offline/sem Supabase configurado não pode impedir o salvamento local.
      }
    }, 1200);
  }, 400);
}

// Saídas do mês — usado tanto pelo cálculo do Simulador (compõe "gastos do
// mês") quanto pela própria aba Saídas (listar/somar).
export function expensesForMonth(y, m) {
  const mk = monthKey(y, m);
  return data.expenses.filter((e) => e.date.startsWith(mk));
}

// Prioridades do mês — mesReferencia é 1-12 (formato "planilha-friendly"),
// por isso o +1 ao comparar com view.monthPrioridades (0-indexed, padrão JS Date).
export function prioritiesForMonth(y, m) {
  return data.priorities.filter((p) => p.anoReferencia === y && p.mesReferencia === m + 1);
}

// Rendimentos de um mês específico (todos os investimentos, ou de um só se
// investimentoId for passado). Usado nos cards de resumo e no histórico por ativo.
export function dividendsForMonth(y, m, investimentoId = null) {
  return data.dividends.filter(
    (d) =>
      d.anoReferencia === y &&
      d.mesReferencia === m + 1 &&
      (investimentoId === null || d.investimentoId === investimentoId)
  );
}


// Ganhos reais do Uber de um mês. Um registro pode existir com active=false;
// somente dias ativos entram nos totais financeiros.
export function uberEntriesForMonth(y, m) {
  const mk = monthKey(y, m);
  return data.uberEntries.filter((e) => e.date.startsWith(mk));
}

// Resumo financeiro real do Uber. Combustível é uma saída real; valor separado
// é dinheiro reservado/comprometido, não uma despesa contábil.
export function uberFinancialSummary(y, m) {
  return uberSummary(uberEntriesForMonth(y, m));
}

// Outras entradas reais (salário, freelance, venda etc.) de um mês.
export function incomesForMonth(y, m) {
  const mk = monthKey(y, m);
  return data.incomes.filter((e) => e.date.startsWith(mk));
}

// Receita REAL consolidada do período. O Simulador nunca entra aqui.
export function realIncomeSummary(y, m) {
  const uber = uberEntriesForMonth(y, m)
    .filter((e) => e.active !== false)
    .reduce((sum, e) => sum + (Number(e.value) || 0), 0);
  const other = incomesForMonth(y, m)
    .reduce((sum, e) => sum + (Number(e.value) || 0), 0);
  return { uber, other, total: uber + other };
}


function syncConfigLooksReady(config) {
  return !!(config?.supabaseUrl && config?.anonKey && config?.householdId && config?.accessKey);
}

// Atualiza a cópia local com o banco central. É seguro chamar ao recuperar foco:
// sem internet, a cópia local permanece intacta. Retorna true quando houve sync.
export async function refreshFromCentral() {
  try {
    const cfg = await platformClient.getSyncConfig();
    if (!cfg?.ok || !syncConfigLooksReady(cfg.config)) return false;
    const synced = await platformClient.syncNow(data);
    if (!synced?.ok || !synced.data) return false;
    data = synced.data;
    data.settings = {
      schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, profileName: '', familyName: '',
      currency: 'BRL', theme: 'dark', activeProfileId: null, compactMode: false,
      investPercent: 30, growthRate: 0, uberReservePercent: 0,
      centralSyncOnStart: true, centralSyncAutoPush: true,
      ...(data.settings || {}),
      categories: { ...DEFAULT_CATEGORIES, ...((data.settings && data.settings.categories) || {}) },
    };
    await platformClient.saveData(data);
    return true;
  } catch {
    return false;
  }
}

// Carrega os dados do disco (via IPC) e aplica os defaults que faltarem.
// Chamado uma única vez no início, pelo app.js.
export async function initData() {
  data = await platformClient.loadData();
  data.settings = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    profileName: '',
    familyName: '',
    currency: 'BRL',
    theme: 'dark',
    activeProfileId: null,
    compactMode: false,
    investPercent: 30,
    growthRate: 0,
    uberReservePercent: 0,
    centralSyncOnStart: false,
    centralSyncAutoPush: false,
    ...(data.settings || {}),
    categories: {
      ...DEFAULT_CATEGORIES,
      ...((data.settings && data.settings.categories) || {}),
    },
  };
  if (!data.carInstallment) data.carInstallment = 1400;
  if (!Array.isArray(data.uberEntries)) data.uberEntries = [];
  data.uberEntries.forEach((e) => {
    if (!Number.isFinite(Number(e.fuelExpense))) e.fuelExpense = 0;
    if (!Number.isFinite(Number(e.reservePercent))) e.reservePercent = 0;
    if (!Number.isFinite(Number(e.reserveValue))) e.reserveValue = 0;
    if (!Number.isFinite(Number(e.kmDriven))) e.kmDriven = 0;
  });
  if (!Array.isArray(data.incomes)) data.incomes = [];
  if (!Array.isArray(data.debts)) data.debts = [];
  if (!Array.isArray(data.debtPayments)) data.debtPayments = [];
  if (!Array.isArray(data.creditCards)) data.creditCards = [];
  if (!Array.isArray(data.cardPurchases)) data.cardPurchases = [];
  if (!Array.isArray(data.cardInvoices)) data.cardInvoices = [];
  if (!Array.isArray(data.calendarEvents)) data.calendarEvents = [];
  if (!Array.isArray(data.profiles)) data.profiles = [];
  if (!data.profiles.length) {
    const now = new Date().toISOString();
    const id = genId();
    data.profiles.push({
      id,
      name: data.settings.profileName?.trim() || 'Meu perfil',
      avatarType: 'emoji', avatarEmoji: '👤', avatarUrl: null,
      color: 'cyan', createdAt: now, updatedAt: now,
    });
    data.settings.activeProfileId = id;
  }
  if (!data.profiles.some((p) => p.id === data.settings.activeProfileId)) {
    data.settings.activeProfileId = data.profiles[0]?.id || null;
  }

  // Fase 11: o arquivo local continua abrindo instantaneamente/offline. Se o
  // usuário ativou sincronização ao iniciar, tentamos mesclar com o banco
  // central antes dos módulos renderizarem. Falha de rede nunca bloqueia o app.
  // Se já existe uma conexão central válida, o desktop passa a buscar o
  // estado remoto automaticamente na abertura. A opção antiga continua
  // registrada por compatibilidade, mas conexão configurada implica sync.
  let shouldSyncOnStart = !!data.settings.centralSyncOnStart;
  try {
    const cfg = await platformClient.getSyncConfig();
    if (cfg?.ok && syncConfigLooksReady(cfg.config)) shouldSyncOnStart = true;
  } catch {}
  if (shouldSyncOnStart) {
    try {
      const synced = await platformClient.syncNow(data);
      if (synced?.ok && synced.data) {
        data = synced.data;
        data.settings = {
          schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, profileName: '', familyName: '',
          currency: 'BRL', theme: 'dark', activeProfileId: null, compactMode: false,
          investPercent: 30, growthRate: 0, uberReservePercent: 0,
          centralSyncOnStart: true, centralSyncAutoPush: true,
          ...(data.settings || {}),
          categories: { ...DEFAULT_CATEGORIES, ...((data.settings && data.settings.categories) || {}) },
        };
      }
    } catch {
      // mantém a cópia local
    }
  }
  return data;
}
