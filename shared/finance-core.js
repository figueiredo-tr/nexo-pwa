// Núcleo financeiro compartilhável entre clientes (Electron hoje, mobile depois).
// Este arquivo NÃO depende de DOM, Electron, Node.js, Google Sheets ou Supabase.
// Qualquer cliente JS/TS pode reutilizar estas regras puras.

export const APP_VERSION = '3.12.6';
export const SCHEMA_VERSION = 4;

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
export const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const DEFAULT_CATEGORIES = {
  expenses: ['Combustível', 'Manutenção', 'Alimentação', 'Documentação/Multas', 'Casa', 'Saúde', 'Lazer', 'Educação', 'Assinaturas', 'Viagem', 'Outros'],
  incomes: ['Salário', 'Freelance', 'Venda', 'Comissão', 'Reembolso', 'Trabalho/Serviço', 'Outros'],
  cardPurchases: ['Alimentação', 'Transporte', 'Compras', 'Casa', 'Saúde', 'Lazer', 'Assinaturas', 'Educação', 'Viagem', 'Outros'],
};

// Coleções centrais sincronizáveis. O mobile deve usar estes mesmos nomes.
export const SYNC_COLLECTIONS = Object.freeze([
  'expenses', 'uberEntries', 'incomes', 'priorities', 'investments', 'dividends',
  'trips', 'tripItems', 'debts', 'debtPayments', 'creditCards', 'cardPurchases',
  'cardInvoices', 'calendarEvents', 'profiles',
]);

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function pad2(value) { return String(value).padStart(2, '0'); }
export function monthKey(year, monthZeroBased) { return `${year}-${pad2(monthZeroBased + 1)}`; }
export function dateKey(year, monthZeroBased, day) { return `${year}-${pad2(monthZeroBased + 1)}-${pad2(day)}`; }
export function daysInMonth(year, monthZeroBased) { return new Date(year, monthZeroBased + 1, 0).getDate(); }

export function formatCurrency(value, currency = 'BRL', locale = 'pt-BR') {
  const number = Number(value) || 0;
  const abs = Math.abs(number);
  const hasCents = Math.abs(abs - Math.round(abs)) > 0.0001;
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(abs);
  return number < 0 ? `-${formatted}` : formatted;
}

export function prioritySummary(priority) {
  const previsto = Math.max(Number(priority?.valorPrevisto) || 0, 0);
  const reservado = Math.max(Number(priority?.valorReservado) || 0, 0);
  const pago = Math.max(Number(priority?.valorPago) || 0, 0);
  const coberto = round2(reservado + pago);
  const faltante = round2(Math.max(previsto - coberto, 0));
  let status = 'Pendente';
  if (pago >= previsto && previsto > 0) status = 'Pago';
  else if (reservado >= previsto && previsto > 0) status = 'Reservado';
  else if (coberto > 0) status = 'Parcialmente reservado';
  return { previsto, reservado, pago, coberto, faltante, status };
}

export function investmentSummary(investment) {
  const valorInvestido = Math.max(Number(investment?.valorInvestido) || 0, 0);
  const valorAtual = Math.max(Number(investment?.valorAtual) || 0, 0);
  const lucroPrejuizo = round2(valorAtual - valorInvestido);
  const rentabilidade = valorInvestido > 0 ? round2((lucroPrejuizo / valorInvestido) * 100) : 0;
  return { valorInvestido, valorAtual, lucroPrejuizo, rentabilidade };
}

export function uberSummary(entries = []) {
  const active = entries.filter((entry) => entry?.active !== false);
  const gross = round2(active.reduce((sum, e) => sum + (Number(e.value) || 0), 0));
  const fuel = round2(active.reduce((sum, e) => sum + (Number(e.fuelExpense) || 0), 0));
  const reserved = round2(active.reduce((sum, e) => sum + (Number(e.reserveValue) || 0), 0));
  const km = round2(active.reduce((sum, e) => sum + (Number(e.kmDriven) || 0), 0));
  return {
    gross, fuel, reserved, km,
    netAfterFuel: round2(gross - fuel),
    available: round2(gross - fuel - reserved),
    grossPerKm: km > 0 ? round2(gross / km) : 0,
  };
}

export function tripSummary(trip, tripItems = []) {
  const budget = Math.max(Number(trip?.orcamentoTotal) || 0, 0);
  const reserved = Math.max(Number(trip?.valorReservado) || 0, 0);
  const items = tripItems.filter((item) => item?.viagemId === trip?.id);
  const plannedItems = round2(items.reduce((sum, item) => sum + (Number(item.valorPrevisto) || 0), 0));
  const paid = round2(items.reduce((sum, item) => sum + (Number(item.valorPago) || 0), 0));
  const covered = round2(reserved + paid);
  const remaining = round2(Math.max(budget - covered, 0));
  const unallocated = round2(Math.max(budget - plannedItems, 0));
  const overBudget = round2(Math.max(plannedItems - budget, 0));
  const progress = budget > 0 ? round2((covered / budget) * 100) : 0;
  return { budget, plannedItems, reserved, paid, covered, remaining, unallocated, overBudget, progress };
}

// Regra aprovada na Fase 7: uma compra feita após o fechamento pertence à
// fatura do mês seguinte. Retorna YYYY-MM.
export function cardInvoiceReference(card, purchaseDate) {
  const raw = String(purchaseDate || '');
  const [yearRaw, monthRaw, dayRaw] = raw.split('-').map(Number);
  if (!yearRaw || !monthRaw || !dayRaw) return null;
  const closingDay = Math.max(1, Math.min(31, Number(card?.diaFechamento) || 1));
  let year = yearRaw;
  let month = monthRaw; // 1-12
  if (dayRaw > closingDay) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return `${year}-${pad2(month)}`;
}

export function withRecordMeta(record, now = new Date().toISOString()) {
  return {
    ...record,
    createdAt: record?.createdAt || now,
    updatedAt: now,
  };
}

// Campo preparado para o mobile / relatórios por pessoa. Não força migração:
// registros antigos sem autoria continuam válidos e são considerados compartilhados.
export function recordOwnerId(record) {
  return record?.createdByProfileId || null;
}
