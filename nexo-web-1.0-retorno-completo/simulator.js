// Aba Simulador — navegação mês/semana, ganhos diários, cálculo, gráfico,
// conexão com Google Sheets (leitura do dashboard + salvar log da simulação).
// Extraído do app.js na Fase 2A. Comportamento idêntico ao anterior.

import {
  MONTH_NAMES, WEEKDAY_NAMES, today, view, data,
  currency, pad2, monthKey, dateKey, daysInMonth,
  scheduleSave, expensesForMonth,
} from './state.js';
import { platformClient } from './platform-client.js';

let lastComputed = null;

// ==================== semanas do mês (blocos de 7 dias) ====================
function getWeeksOfMonth(y, m) {
  const total = daysInMonth(y, m);
  const weeks = [];
  for (let start = 1; start <= total; start += 7) {
    weeks.push({ start, end: Math.min(start + 6, total) });
  }
  return weeks;
}

function defaultForDay(y, m, d) {
  const wd = new Date(y, m, d).getDay(); // 0=Dom
  if (wd === 0) return { value: 0, active: false };
  if (wd === 6) return { value: 240, active: true };
  return { value: 190, active: true };
}

// ==================== NAVEGAÇÃO MÊS ====================
function renderMonthHeader() {
  document.getElementById('monthLabel').textContent = `${MONTH_NAMES[view.month]} ${view.year}`;
}

function shiftMonth(delta) {
  view.month += delta;
  if (view.month < 0) { view.month = 11; view.year--; }
  if (view.month > 11) { view.month = 0; view.year++; }
  view.selectedWeekIdx = 0;
  autoSelectCurrentWeek();
  renderMonthHeader();
  renderWeekPills();
  renderWeekStrip();
  recalc();
}

// só roda quando o mês muda (ou no primeiro carregamento) — nunca sobrescreve
// uma semana que o usuário escolheu manualmente clicando numa pill
function autoSelectCurrentWeek() {
  const isCurrentMonth = view.year === today.getFullYear() && view.month === today.getMonth();
  if (!isCurrentMonth) return;
  const weeks = getWeeksOfMonth(view.year, view.month);
  const idx = weeks.findIndex((w) => today.getDate() >= w.start && today.getDate() <= w.end);
  if (idx >= 0) view.selectedWeekIdx = idx;
}

// ==================== PILLS DE SEMANA ====================
function renderWeekPills() {
  const weeks = getWeeksOfMonth(view.year, view.month);
  const isCurrentMonth = view.year === today.getFullYear() && view.month === today.getMonth();
  const el = document.getElementById('weekPills');
  el.innerHTML = '';
  weeks.forEach((w, i) => {
    const pill = document.createElement('button');
    const isCurrent = isCurrentMonth && today.getDate() >= w.start && today.getDate() <= w.end;
    pill.className = 'week-pill' + (i === view.selectedWeekIdx ? ' active' : '') + (isCurrent ? ' current' : '');
    pill.textContent = `Semana ${i + 1} (${w.start}–${w.end})`;
    pill.onclick = () => {
      view.selectedWeekIdx = i;
      renderWeekPills();
      renderWeekStrip();
      recalc();
    };
    el.appendChild(pill);
  });
}

// ==================== TIRA DE DIAS (semana selecionada) ====================
function renderWeekStrip() {
  const weeks = getWeeksOfMonth(view.year, view.month);
  const w = weeks[view.selectedWeekIdx] || weeks[0];
  const el = document.getElementById('weekStrip');
  el.innerHTML = '';

  for (let d = w.start; d <= w.end; d++) {
    const key = dateKey(view.year, view.month, d);
    const wd = new Date(view.year, view.month, d).getDay();
    const def = defaultForDay(view.year, view.month, d);
    if (!(key in data.dailyEarnings)) data.dailyEarnings[key] = def.value;
    if (!(key in data.dailyActive)) data.dailyActive[key] = def.active;

    const active = data.dailyActive[key];
    const pill = document.createElement('div');
    pill.className = 'day-pill' + (active ? ' active' : '');

    const btn = document.createElement('button');
    btn.innerHTML = `${WEEKDAY_NAMES[wd]}<br><span style="font-weight:400;opacity:.7;">${pad2(d)}/${pad2(view.month + 1)}</span>`;
    btn.onclick = () => {
      data.dailyActive[key] = !data.dailyActive[key];
      scheduleSave();
      renderWeekStrip();
      recalc();
    };

    const input = document.createElement('input');
    input.type = 'number';
    input.value = data.dailyEarnings[key];
    input.disabled = !active;
    input.oninput = (e) => {
      data.dailyEarnings[key] = Number(e.target.value) || 0;
      scheduleSave();
      recalc();
    };

    pill.appendChild(btn);
    pill.appendChild(input);
    el.appendChild(pill);
  }
}

// ==================== CÁLCULO PRINCIPAL ====================
function computeAll() {
  const total = daysInMonth(view.year, view.month);
  let monthTotal = 0;
  for (let d = 1; d <= total; d++) {
    const key = dateKey(view.year, view.month, d);
    const def = defaultForDay(view.year, view.month, d);
    const active = key in data.dailyActive ? data.dailyActive[key] : def.active;
    const value = key in data.dailyEarnings ? data.dailyEarnings[key] : def.value;
    if (active) monthTotal += Number(value) || 0;
  }

  const fixedExpenses = Number(document.getElementById('fixedExpenses').value) || 0;
  const includeCar = document.getElementById('includeCar').checked;
  const carInstallment = data.carInstallment || 1400;

  const saidasMes = expensesForMonth(view.year, view.month).reduce((s, e) => s + Number(e.value || 0), 0);
  document.getElementById('saidasDoMes').textContent = currency(saidasMes);

  const monthlyExpenses = fixedExpenses + (includeCar ? carInstallment : 0) + saidasMes;
  const sobra = monthTotal - monthlyExpenses;
  const investPercent = Number(document.getElementById('investPercent').value);
  const growthRate = Number(document.getElementById('growthRate').value);
  const investAmount = Math.max(sobra, 0) * (investPercent / 100);
  const freeAmount = Math.max(sobra, 0) - investAmount;

  // semana selecionada — só pra exibir o resumo da tira de dias
  const weeks = getWeeksOfMonth(view.year, view.month);
  const w = weeks[view.selectedWeekIdx] || weeks[0];
  let weekIncome = 0, daysWorked = 0;
  for (let d = w.start; d <= w.end; d++) {
    const key = dateKey(view.year, view.month, d);
    if (data.dailyActive[key]) { weekIncome += Number(data.dailyEarnings[key]) || 0; daysWorked++; }
  }

  let cumulative = 0;
  const months = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
  const projection = months.map((label, i) => {
    const income = monthTotal * Math.pow(1 + growthRate / 100, i);
    const monthSobra = Math.max(income - monthlyExpenses, 0);
    const invest = monthSobra * (investPercent / 100);
    cumulative += invest;
    return { mes: label, ganhos: income, gastos: monthlyExpenses, investido: cumulative };
  });

  return {
    monthTotal, monthlyExpenses, sobra, investAmount, freeAmount,
    weekIncome, daysWorked, projection, totalInvested12m: projection[11].investido,
  };
}

function renderSummary(c) {
  const cards = [
    ['GANHO DO MÊS (real + estimado)', c.monthTotal, 'cyan'],
    ['GASTOS DO MÊS', -c.monthlyExpenses, 'pink'],
    ['SOBRA DO MÊS', c.sobra, c.sobra >= 0 ? 'green' : 'pink'],
    ['VALOR A INVESTIR', c.investAmount, 'gold'],
    ['LIVRE PRA GASTAR', c.freeAmount, 'purple'],
    ['INVESTIDO EM 12 MESES', c.totalInvested12m, 'orange'],
  ];
  document.getElementById('summaryGrid').innerHTML = cards
    .map(([label, value, color]) => `
      <div class="summary-card">
        <div class="lbl">${label}</div>
        <div class="val mono ${color}">${currency(value)}</div>
      </div>`).join('');

  document.getElementById('warningBox').style.display = c.sobra < 0 ? 'block' : 'none';
  document.getElementById('weekSummary').textContent =
    `${c.daysWorked} dia${c.daysWorked !== 1 ? 's' : ''} ativos nesta semana · renda da semana ${currency(c.weekIncome)}`;
}

function renderChart(projection) {
  const w = 900, h = 260, padL = 44, padB = 24, padT = 10, padR = 10;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxVal = Math.max(...projection.map((p) => Math.max(p.ganhos, p.gastos)), 1);
  const maxInvest = Math.max(...projection.map((p) => p.investido), 1);
  const n = projection.length;
  const groupW = plotW / n;
  const barW = groupW * 0.28;

  let bars = '';
  projection.forEach((p, i) => {
    const x0 = padL + i * groupW + groupW * 0.12;
    const hG = (p.ganhos / maxVal) * plotH;
    const hE = (p.gastos / maxVal) * plotH;
    bars += `<rect x="${x0}" y="${padT + plotH - hG}" width="${barW}" height="${hG}" fill="#00E5FF" rx="3"/>`;
    bars += `<rect x="${x0 + barW + 4}" y="${padT + plotH - hE}" width="${barW}" height="${hE}" fill="#FF3CAC" rx="3"/>`;
  });

  const linePts = projection.map((p, i) => {
    const x = padL + i * groupW + groupW / 2;
    const y = padT + plotH - (p.investido / maxInvest) * plotH;
    return `${x},${y}`;
  }).join(' ');

  const dots = projection.map((p, i) => {
    const x = padL + i * groupW + groupW / 2;
    const y = padT + plotH - (p.investido / maxInvest) * plotH;
    return `<circle cx="${x}" cy="${y}" r="3" fill="#FFE94A"/>`;
  }).join('');

  const labels = projection.map((p, i) => {
    const x = padL + i * groupW + groupW / 2;
    return `<text x="${x}" y="${h - 6}" fill="#8A93A8" font-size="9" text-anchor="middle" font-family="Inter">${p.mes}</text>`;
  }).join('');

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH - f * plotH;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#1B2438" stroke-dasharray="3,3"/>`;
  }).join('');

  document.getElementById('chart').innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:280px;">
      ${gridLines}${bars}
      <polyline points="${linePts}" fill="none" stroke="#FFE94A" stroke-width="2.5"/>
      ${dots}${labels}
    </svg>
    <div style="display:flex;gap:16px;font-size:11px;color:#8A93A8;padding:6px 14px 12px;">
      <span><span style="color:#00E5FF;">■</span> Ganhos</span>
      <span><span style="color:#FF3CAC;">■</span> Gastos</span>
      <span><span style="color:#FFE94A;">●</span> Investido (acumulado)</span>
    </div>`;
}

function recalc() {
  const c = computeAll();
  lastComputed = c;
  renderSummary(c);
  renderChart(c.projection);
}
export { recalc };

function loadMonthSettingsIntoControls() {
  const mk = monthKey(view.year, view.month);
  const mset = data.monthSettings[mk] || { gastosFixos: 3200, includeCar: true };
  document.getElementById('fixedExpenses').value = mset.gastosFixos;
  document.getElementById('includeCar').checked = mset.includeCar;
  document.getElementById('investPercent').value = data.settings.investPercent;
  document.getElementById('growthRate').value = data.settings.growthRate;
  document.getElementById('investPercentLabel').textContent = data.settings.investPercent + '%';
  document.getElementById('growthLabel').textContent = data.settings.growthRate + '%';
}

// ==================== INIT (chamado pelo app.js) ====================
export function initSimulator() {
  document.getElementById('prevMonth').onclick = () => shiftMonth(-1);
  document.getElementById('nextMonth').onclick = () => shiftMonth(1);

  ['fixedExpenses', 'includeCar', 'investPercent', 'growthRate'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      document.getElementById('investPercentLabel').textContent = document.getElementById('investPercent').value + '%';
      document.getElementById('growthLabel').textContent = document.getElementById('growthRate').value + '%';
      const mk = monthKey(view.year, view.month);
      data.monthSettings[mk] = {
        gastosFixos: Number(document.getElementById('fixedExpenses').value) || 0,
        includeCar: document.getElementById('includeCar').checked,
      };
      data.settings.investPercent = Number(document.getElementById('investPercent').value);
      data.settings.growthRate = Number(document.getElementById('growthRate').value);
      scheduleSave();
      recalc();
    });
  });

  document.getElementById('saveBtn').onclick = async () => {
    if (!lastComputed) return;
    const { loggedIn } = await platformClient.authStatus();
    if (!loggedIn) { alert('Conecte ao Google Sheets primeiro pra salvar a simulação.'); return; }
    const c = lastComputed;
    const row = [
      new Date().toLocaleString('pt-BR'),
      `${MONTH_NAMES[view.month]}/${view.year}`,
      Math.round(c.monthTotal),
      Math.round(c.monthlyExpenses),
      Math.round(c.sobra),
      Number(document.getElementById('investPercent').value),
      Math.round(c.investAmount),
      Number(document.getElementById('growthRate').value),
      Math.round(c.totalInvested12m),
    ];
    document.getElementById('saveStatus').textContent = 'salvando…';
    const res = await platformClient.saveSimulation(row);
    document.getElementById('saveStatus').textContent = res.ok ? 'Salvo na aba "Log Simulador"' : 'Erro: ' + res.error;
  };

  document.getElementById('carValueLabel').textContent = currency(data.carInstallment);
  autoSelectCurrentWeek();
  renderMonthHeader();
  renderWeekPills();
  loadMonthSettingsIntoControls();
  renderWeekStrip();
  recalc();
}
