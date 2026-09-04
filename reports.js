// Fase 9 — Relatórios.
// Consolida dados já existentes sem criar uma segunda fonte de verdade.
// Relatórios são somente leitura: não alteram dados nem regras financeiras.

import {
  MONTH_NAMES, view, data, currency, monthKey,
  expensesForMonth, incomesForMonth, uberEntriesForMonth, prioritiesForMonth,
  uberFinancialSummary,
} from './state.js';
import { getOverviewSummary } from './dashboard.js';
import { getPortfolioSummary, getMonthlyIncome, getAccumulatedIncome } from './investments.js';
import { getTripsSummary } from './trips.js';
import { getDebtsSummary } from './debts.js';
import { getCardsSummary } from './cards.js';

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function esc(v = '') { return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function refKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }

function shiftReportMonth(delta) {
  view.monthRelatorios += delta;
  if (view.monthRelatorios < 0) { view.monthRelatorios = 11; view.yearRelatorios--; }
  if (view.monthRelatorios > 11) { view.monthRelatorios = 0; view.yearRelatorios++; }
  renderReports();
}

function periodMonths(count = view.reportRange) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(view.yearRelatorios, view.monthRelatorios - i, 1);
    out.push({ y: d.getFullYear(), m: d.getMonth(), label: `${MONTH_NAMES[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(2)}` });
  }
  return out;
}

function monthSummary(y, m) {
  const overview = getOverviewSummary(y, m);
  const uber = uberFinancialSummary(y, m);
  const uberEntries = uberEntriesForMonth(y, m).filter((e) => e.active !== false);
  const daysWorked = uberEntries.filter((e) => (Number(e.value) || 0) > 0).length;
  return {
    ...overview,
    km: round2(uber.km),
    uberDays: daysWorked,
    grossPerKm: uber.km > 0 ? round2(overview.uber / uber.km) : 0,
    availablePerKm: uber.km > 0 ? round2(uber.available / uber.km) : 0,
  };
}

function expenseCategories(y, m) {
  const map = new Map();
  expensesForMonth(y, m).forEach((e) => {
    const name = e.category || 'Outros';
    map.set(name, round2((map.get(name) || 0) + (Number(e.value) || 0)));
  });
  const uberFuel = uberEntriesForMonth(y, m)
    .filter((e) => e.active !== false)
    .reduce((s, e) => s + (Number(e.fuelExpense) || 0), 0);
  if (uberFuel > 0) map.set('Combustível Uber', round2((map.get('Combustível Uber') || 0) + uberFuel));
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function incomeCategories(y, m) {
  const map = new Map();
  const uber = uberEntriesForMonth(y, m)
    .filter((e) => e.active !== false)
    .reduce((s, e) => s + (Number(e.value) || 0), 0);
  if (uber > 0) map.set('Uber', round2(uber));
  incomesForMonth(y, m).forEach((e) => {
    const name = e.category || e.source || 'Outras entradas';
    map.set(name, round2((map.get(name) || 0) + (Number(e.value) || 0)));
  });
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function renderBars(containerId, rows, total, kind = 'expense') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = '<div class="report-empty">Nenhum lançamento neste período.</div>';
    return;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  el.innerHTML = rows.slice(0, 8).map((r) => {
    const pctMax = Math.max(2, (r.value / max) * 100);
    const pctTotal = total > 0 ? (r.value / total) * 100 : 0;
    return `<div class="report-bar-row">
      <div class="report-bar-head"><span>${esc(r.name)}</span><strong class="mono ${kind === 'income' ? 'green' : 'pink'}">${currency(r.value)}</strong></div>
      <div class="report-bar-track"><span class="report-bar-fill ${kind}" style="width:${pctMax}%"></span></div>
      <div class="report-bar-foot">${pctTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do total</div>
    </div>`;
  }).join('');
}

function renderMonthlyChart(series) {
  const el = document.getElementById('reportMonthlyChart');
  if (!el) return;
  const W = 760, H = 270, left = 42, right = 12, top = 18, bottom = 40;
  const plotW = W - left - right, plotH = H - top - bottom;
  const maxValue = Math.max(1, ...series.flatMap((r) => [r.income, r.expenses, r.result]));
  const minValue = Math.min(0, ...series.map((r) => r.result));
  const niceMax = Math.ceil(maxValue / 500) * 500 || 500;
  const niceMin = minValue < 0 ? Math.floor(minValue / 500) * 500 : 0;
  const range = Math.max(niceMax - niceMin, 1);
  const y = (v) => top + plotH - ((v - niceMin) / range) * plotH;
  const zeroY = y(0);
  const groupW = plotW / Math.max(series.length, 1);
  const barW = Math.max(7, Math.min(18, groupW * .22));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas, saídas e resultado por mês">`;
  for (let i = 0; i <= 4; i++) {
    const val = niceMin + range * i / 4;
    const yy = y(val);
    svg += `<line class="report-svg-grid" x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}"/>`;
    svg += `<text class="report-svg-axis" x="${left-6}" y="${yy+3}" text-anchor="end">${Math.abs(val) >= 1000 ? `${(val/1000).toFixed(1)}k` : Math.round(val)}</text>`;
  }
  svg += `<line class="report-svg-zero" x1="${left}" y1="${zeroY}" x2="${W-right}" y2="${zeroY}"/>`;
  const resultPoints = [];
  series.forEach((r, i) => {
    const cx = left + groupW * i + groupW / 2;
    const incomeY = y(r.income), expenseY = y(r.expenses);
    svg += `<rect x="${cx-barW-2}" y="${incomeY}" width="${barW}" height="${Math.max(zeroY-incomeY, 1)}" rx="3" fill="#00E5FF" opacity=".82"/>`;
    svg += `<rect x="${cx+2}" y="${expenseY}" width="${barW}" height="${Math.max(zeroY-expenseY, 1)}" rx="3" fill="#FF3CAC" opacity=".78"/>`;
    const resultY = y(r.result);
    resultPoints.push(`${cx},${resultY}`);
    svg += `<text class="report-svg-month" x="${cx}" y="${H-13}">${esc(r.label)}</text>`;
  });
  svg += `<polyline class="report-svg-result" points="${resultPoints.join(' ')}"/>`;
  resultPoints.forEach((p) => { const [x, yy] = p.split(','); svg += `<circle class="report-svg-result-point" cx="${x}" cy="${yy}" r="2.6"/>`; });
  svg += '</svg>';
  el.innerHTML = svg;
}

function renderExecutive() {
  const s = monthSummary(view.yearRelatorios, view.monthRelatorios);
  const portfolio = getPortfolioSummary();
  const debts = getDebtsSummary();
  const activeTrips = data.trips.filter((t) => t.status === 'Planejada' || t.status === 'Em andamento');
  const trips = getTripsSummary(activeTrips);
  const cards = getCardsSummary(refKey(view.yearRelatorios, view.monthRelatorios));
  const yields = getMonthlyIncome(view.yearRelatorios, view.monthRelatorios);

  document.getElementById('reportExecutiveGrid').innerHTML = [
    ['ENTRADAS', s.totalIncome, 'green', 'receitas reais do mês'],
    ['SAÍDAS', -s.expenses, 'pink', 'saídas reais + combustível Uber'],
    ['RESULTADO', s.result, s.result >= 0 ? 'cyan' : 'pink', 'entradas − saídas'],
    ['LIVRE DE VERDADE', s.freeForReal, s.freeForReal >= 0 ? 'purple' : 'pink', 'após compromissos e investimento planejado'],
    ['PATRIMÔNIO INVESTIDO', portfolio.valorAtualCarteira, 'orange', 'valor atual dos ativos'],
    ['DÍVIDAS EM ABERTO', -debts.remaining, debts.remaining > 0 ? 'pink' : 'green', `${debts.active} dívida(s) ativa(s)`],
    ['FATURAS DO MÊS', -cards.invoices, cards.invoices > 0 ? 'gold' : 'green', `${cards.cards} cartão(ões) ativo(s)`],
    ['RENDIMENTOS', yields, 'green', 'dividendos, JCP e juros'],
  ].map(([name, value, color, note]) => `<div class="summary-card report-kpi-card"><div class="lbl">${name}</div><div class="val mono ${color}">${currency(value)}</div><div class="report-kpi-note">${note}</div></div>`).join('');

  document.getElementById('reportModuleSnapshot').innerHTML = `
    <div class="report-snapshot-row"><span>Prioridades pendentes</span><strong class="mono gold">${currency(s.prioritiesPending)}</strong></div>
    <div class="report-snapshot-row"><span>Separado no Uber</span><strong class="mono gold">${currency(s.uberReserved)}</strong></div>
    <div class="report-snapshot-row"><span>Investimento planejado</span><strong class="mono orange">${currency(s.plannedInvestment)}</strong></div>
    <div class="report-snapshot-row"><span>Viagens reservadas</span><strong class="mono cyan">${currency(trips.totalReserved)}</strong></div>
    <div class="report-snapshot-row"><span>Viagens ainda a cobrir</span><strong class="mono gold">${currency(trips.totalRemaining)}</strong></div>
    <div class="report-snapshot-row"><span>Rendimentos acumulados</span><strong class="mono green">${currency(getAccumulatedIncome())}</strong></div>`;
}

function renderUberReport() {
  const s = monthSummary(view.yearRelatorios, view.monthRelatorios);
  const fuelPct = s.uber > 0 ? round2((s.uberFuel / s.uber) * 100) : 0;
  const reservePct = s.uber > 0 ? round2((s.uberReserved / s.uber) * 100) : 0;
  document.getElementById('reportUberGrid').innerHTML = [
    ['Faturamento bruto', currency(s.uber), 'cyan'],
    ['Combustível', currency(s.uberFuel), 'pink'],
    ['KM rodados', `${s.km.toLocaleString('pt-BR')} km`, 'purple'],
    ['Dias com receita', String(s.uberDays), 'gold'],
    ['Bruto por KM', `${currency(s.grossPerKm)}/km`, 'orange'],
    ['Disponível por KM', `${currency(s.availablePerKm)}/km`, 'green'],
    ['Combustível / bruto', `${fuelPct.toLocaleString('pt-BR')}%`, 'pink'],
    ['Separado / bruto', `${reservePct.toLocaleString('pt-BR')}%`, 'gold'],
  ].map(([label, value, color]) => `<div class="report-mini-kpi"><span>${label}</span><strong class="mono ${color}">${value}</strong></div>`).join('');
}

function renderTrend() {
  const months = periodMonths();
  const series = months.map(({ y, m, label }) => {
    const s = monthSummary(y, m);
    return { label, income: s.totalIncome, expenses: s.expenses, result: s.result, free: s.freeForReal };
  });
  renderMonthlyChart(series);

  const positive = series.filter((r) => r.result > 0).length;
  const avgIncome = round2(series.reduce((s, r) => s + r.income, 0) / Math.max(series.length, 1));
  const avgExpense = round2(series.reduce((s, r) => s + r.expenses, 0) / Math.max(series.length, 1));
  const best = series.reduce((a, b) => !a || b.result > a.result ? b : a, null);
  document.getElementById('reportTrendInsights').innerHTML = `
    <div class="report-mini-kpi"><span>Média de entradas</span><strong class="mono green">${currency(avgIncome)}</strong></div>
    <div class="report-mini-kpi"><span>Média de saídas</span><strong class="mono pink">${currency(avgExpense)}</strong></div>
    <div class="report-mini-kpi"><span>Meses positivos</span><strong class="mono cyan">${positive}/${series.length}</strong></div>
    <div class="report-mini-kpi"><span>Melhor resultado</span><strong class="mono purple">${best ? `${best.label} · ${currency(best.result)}` : '—'}</strong></div>`;
}

function renderBreakdowns() {
  const y = view.yearRelatorios, m = view.monthRelatorios;
  const s = monthSummary(y, m);
  renderBars('reportExpenseCategories', expenseCategories(y, m), s.expenses, 'expense');
  renderBars('reportIncomeCategories', incomeCategories(y, m), s.totalIncome, 'income');
}

export function renderReports() {
  const label = document.getElementById('reportMonthLabel');
  if (!label) return;
  label.textContent = `${MONTH_NAMES[view.monthRelatorios]} ${view.yearRelatorios}`;
  document.getElementById('reportRange').value = String(view.reportRange);
  renderExecutive();
  renderTrend();
  renderBreakdowns();
  renderUberReport();
}

export function initReports() {
  document.getElementById('prevMonthReport').onclick = () => shiftReportMonth(-1);
  document.getElementById('nextMonthReport').onclick = () => shiftReportMonth(1);
  document.getElementById('reportRange').onchange = (e) => {
    view.reportRange = Number(e.target.value) === 6 ? 6 : 12;
    renderReports();
  };
  renderReports();
}
