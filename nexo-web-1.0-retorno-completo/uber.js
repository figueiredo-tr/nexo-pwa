// Uber — registro REAL dos ganhos e custos diários.
// Simulador = previsão; Uber = realizado.
// Cada dia pode registrar faturamento bruto, combustível e um valor separado
// (informado por percentual ou valor). O valor separado NÃO é despesa: ele é
// dinheiro comprometido/reservado e reduz o disponível real.

import {
  MONTH_NAMES, WEEKDAY_NAMES, today, view, data,
  currency, pad2, dateKey, daysInMonth, genId, scheduleSave,
  uberEntriesForMonth, uberFinancialSummary,
} from './state.js';

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function clamp(v, min, max) { return Math.min(Math.max(Number(v) || 0, min), max); }

function getWeeksOfMonth(y, m) {
  const total = daysInMonth(y, m);
  const weeks = [];
  for (let start = 1; start <= total; start += 7) weeks.push({ start, end: Math.min(start + 6, total) });
  return weeks;
}

function findEntry(date) { return data.uberEntries.find((e) => e.date === date); }

function ensureEntry(date) {
  let entry = findEntry(date);
  if (!entry) {
    const now = new Date().toISOString();
    entry = {
      id: genId(), date, value: 0, active: true,
      fuelExpense: 0, reservePercent: Number(data.settings?.uberReservePercent) || 0, reserveValue: 0,
      hoursWorked: null, kmDriven: null, notes: '',
      createdAt: now, updatedAt: now,
    };
    data.uberEntries.push(entry);
  }
  if (!Number.isFinite(Number(entry.fuelExpense))) entry.fuelExpense = 0;
  if (!Number.isFinite(Number(entry.reservePercent))) entry.reservePercent = 0;
  if (!Number.isFinite(Number(entry.reserveValue))) entry.reserveValue = 0;
  if (!Number.isFinite(Number(entry.kmDriven))) entry.kmDriven = 0;
  return entry;
}

function maxReservable(entry) {
  return Math.max(round2((Number(entry.value) || 0) - (Number(entry.fuelExpense) || 0)), 0);
}

function recalcReserveFromPercent(entry) {
  const gross = Math.max(Number(entry.value) || 0, 0);
  const pct = clamp(entry.reservePercent, 0, 100);
  entry.reservePercent = round2(pct);
  entry.reserveValue = round2(Math.min(gross * pct / 100, maxReservable(entry)));
}

function recalcPercentFromReserve(entry) {
  const gross = Math.max(Number(entry.value) || 0, 0);
  entry.reserveValue = round2(clamp(entry.reserveValue, 0, maxReservable(entry)));
  entry.reservePercent = gross > 0 ? round2((entry.reserveValue / gross) * 100) : 0;
}

function autoSelectCurrentWeek() {
  const isCurrentMonth = view.yearUber === today.getFullYear() && view.monthUber === today.getMonth();
  if (!isCurrentMonth) return;
  const weeks = getWeeksOfMonth(view.yearUber, view.monthUber);
  const idx = weeks.findIndex((w) => today.getDate() >= w.start && today.getDate() <= w.end);
  if (idx >= 0) view.selectedWeekIdxUber = idx;
}

function renderHeader() {
  document.getElementById('uberMonthLabel').textContent = `${MONTH_NAMES[view.monthUber]} ${view.yearUber}`;
}

function shiftMonth(delta) {
  view.monthUber += delta;
  if (view.monthUber < 0) { view.monthUber = 11; view.yearUber--; }
  if (view.monthUber > 11) { view.monthUber = 0; view.yearUber++; }
  view.selectedWeekIdxUber = 0;
  autoSelectCurrentWeek();
  renderUber();
}

function renderWeekPills() {
  const weeks = getWeeksOfMonth(view.yearUber, view.monthUber);
  const isCurrentMonth = view.yearUber === today.getFullYear() && view.monthUber === today.getMonth();
  const el = document.getElementById('uberWeekPills');
  el.innerHTML = '';
  weeks.forEach((w, i) => {
    const btn = document.createElement('button');
    const current = isCurrentMonth && today.getDate() >= w.start && today.getDate() <= w.end;
    btn.className = 'week-pill' + (i === view.selectedWeekIdxUber ? ' active' : '') + (current ? ' current' : '');
    btn.textContent = `Semana ${i + 1} (${w.start}–${w.end})`;
    btn.onclick = () => {
      view.selectedWeekIdxUber = i;
      renderWeekPills();
      renderWeekStrip();
      renderSummary();
      renderAnalytics();
    };
    el.appendChild(btn);
  });
}

function makeMoneyField(label, value, disabled, onInput, css = '') {
  const wrap = document.createElement('label');
  wrap.className = `uber-mini-field ${css}`;
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number'; input.min = '0'; input.step = '0.01'; input.value = value || 0; input.disabled = disabled;
  input.onchange = onInput;
  wrap.append(span, input);
  return wrap;
}

function renderWeekStrip() {
  const weeks = getWeeksOfMonth(view.yearUber, view.monthUber);
  const w = weeks[view.selectedWeekIdxUber] || weeks[0];
  const el = document.getElementById('uberWeekStrip');
  el.innerHTML = '';

  for (let d = w.start; d <= w.end; d++) {
    const key = dateKey(view.yearUber, view.monthUber, d);
    const wd = new Date(view.yearUber, view.monthUber, d).getDay();
    const entry = findEntry(key);
    const active = !!entry && entry.active !== false;

    const pill = document.createElement('div');
    pill.className = 'day-pill uber-day-pill uber-day-finance' + (active ? ' active' : '');

    const btn = document.createElement('button');
    btn.className = 'uber-day-toggle';
    btn.innerHTML = `${WEEKDAY_NAMES[wd]}<br><span>${pad2(d)}/${pad2(view.monthUber + 1)}</span>`;
    btn.title = active ? 'Clique para marcar como não trabalhado' : 'Clique para marcar como trabalhado';
    btn.onclick = () => {
      const item = ensureEntry(key);
      item.active = !active;
      item.updatedAt = new Date().toISOString();
      scheduleSave(); renderWeekStrip(); renderSummary(); renderAnalytics();
    };
    pill.appendChild(btn);

    pill.appendChild(makeMoneyField('Ganho', entry?.value || 0, !active, (e) => {
      const item = ensureEntry(key);
      item.active = true;
      item.value = round2(Math.max(Number(e.target.value) || 0, 0));
      recalcReserveFromPercent(item);
      item.updatedAt = new Date().toISOString();
      scheduleSave(); renderWeekStrip(); renderSummary(); renderAnalytics();
    }, 'gross'));

    const metricsRow = document.createElement('div');
    metricsRow.className = 'uber-metrics-row';

    metricsRow.appendChild(makeMoneyField('Comb.', entry?.fuelExpense || 0, !active, (e) => {
      const item = ensureEntry(key);
      item.fuelExpense = round2(Math.max(Number(e.target.value) || 0, 0));
      recalcReserveFromPercent(item);
      item.updatedAt = new Date().toISOString();
      scheduleSave(); renderWeekStrip(); renderSummary(); renderAnalytics();
    }, 'fuel'));

    metricsRow.appendChild(makeMoneyField('KM', entry?.kmDriven || 0, !active, (e) => {
      const item = ensureEntry(key);
      item.kmDriven = round2(Math.max(Number(e.target.value) || 0, 0));
      item.updatedAt = new Date().toISOString();
      scheduleSave(); renderWeekStrip(); renderSummary(); renderAnalytics();
    }, 'km'));

    pill.appendChild(metricsRow);

    const reserveRow = document.createElement('div');
    reserveRow.className = 'uber-reserve-row';
    const pctLabel = document.createElement('label');
    pctLabel.className = 'uber-mini-field reserve-pct';
    pctLabel.innerHTML = '<span>Separar %</span>';
    const pctInput = document.createElement('input');
    pctInput.type = 'number'; pctInput.min = '0'; pctInput.max = '100'; pctInput.step = '0.1'; pctInput.disabled = !active;
    pctInput.value = entry?.reservePercent || 0;
    pctInput.onchange = (e) => {
      const item = ensureEntry(key);
      item.reservePercent = round2(clamp(e.target.value, 0, 100));
      recalcReserveFromPercent(item);
      item.updatedAt = new Date().toISOString();
      scheduleSave(); renderWeekStrip(); renderSummary(); renderAnalytics();
    };
    pctLabel.appendChild(pctInput);

    const valLabel = document.createElement('label');
    valLabel.className = 'uber-mini-field reserve-value';
    valLabel.innerHTML = '<span>Separado R$</span>';
    const valInput = document.createElement('input');
    valInput.type = 'number'; valInput.min = '0'; valInput.step = '0.01'; valInput.disabled = !active;
    valInput.value = entry?.reserveValue || 0;
    valInput.onchange = (e) => {
      const item = ensureEntry(key);
      item.reserveValue = round2(Math.max(Number(e.target.value) || 0, 0));
      recalcPercentFromReserve(item);
      item.updatedAt = new Date().toISOString();
      scheduleSave(); renderWeekStrip(); renderSummary(); renderAnalytics();
    };
    valLabel.appendChild(valInput);
    reserveRow.append(pctLabel, valLabel);
    pill.appendChild(reserveRow);

    const gross = Number(entry?.value) || 0;
    const fuel = Number(entry?.fuelExpense) || 0;
    const reserved = Number(entry?.reserveValue) || 0;
    const available = round2(gross - fuel - reserved);
    const net = document.createElement('div');
    net.className = `uber-day-net mono ${available >= 0 ? 'green' : 'pink'}`;
    net.textContent = `Disponível: ${currency(available)}`;
    pill.appendChild(net);

    el.appendChild(pill);
  }
}

export function getUberMonthSummary(y, m) {
  const entries = uberEntriesForMonth(y, m).filter((e) => e.active !== false);
  const f = uberFinancialSummary(y, m);
  const worked = entries.filter((e) => (Number(e.value) || 0) > 0 || e.active).length;
  return {
    total: f.gross,
    fuel: f.fuel,
    reserved: f.reserved,
    available: f.available,
    totalKm: f.km,
    daysWorked: worked,
    averagePerDay: worked > 0 ? round2(f.gross / worked) : 0,
    averageKmPerDay: worked > 0 ? round2(f.km / worked) : 0,
    grossPerKm: f.km > 0 ? round2(f.gross / f.km) : 0,
    availablePerKm: f.km > 0 ? round2(f.available / f.km) : 0,
  };
}

function getWeekSummary() {
  const weeks = getWeeksOfMonth(view.yearUber, view.monthUber);
  const w = weeks[view.selectedWeekIdxUber] || weeks[0];
  let gross = 0, fuel = 0, reserved = 0, km = 0, days = 0;
  for (let d = w.start; d <= w.end; d++) {
    const entry = findEntry(dateKey(view.yearUber, view.monthUber, d));
    if (entry && entry.active !== false) {
      gross += Number(entry.value) || 0;
      fuel += Number(entry.fuelExpense) || 0;
      reserved += Number(entry.reserveValue) || 0;
      km += Number(entry.kmDriven) || 0;
      days++;
    }
  }
  return {
    gross: round2(gross),
    fuel: round2(fuel),
    reserved: round2(reserved),
    km: round2(km),
    available: round2(gross - fuel - reserved),
    days,
    grossPerKm: km > 0 ? round2(gross / km) : 0,
  };
}

function moneyCompact(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${n < 0 ? '-' : ''}R$ ${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${n < 0 ? '-' : ''}R$ ${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return currency(n);
}

function svgEscape(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
}

function weekChartData() {
  const weeks = getWeeksOfMonth(view.yearUber, view.monthUber);
  const w = weeks[view.selectedWeekIdxUber] || weeks[0];
  const out = [];
  for (let d = w.start; d <= w.end; d++) {
    const key = dateKey(view.yearUber, view.monthUber, d);
    const wd = new Date(view.yearUber, view.monthUber, d).getDay();
    const entry = findEntry(key);
    const active = !!entry && entry.active !== false;
    const gross = active ? Math.max(Number(entry.value) || 0, 0) : 0;
    const fuel = active ? Math.max(Number(entry.fuelExpense) || 0, 0) : 0;
    const reserved = active ? Math.max(Number(entry.reserveValue) || 0, 0) : 0;
    out.push({
      day: d,
      label: `${WEEKDAY_NAMES[wd]} ${pad2(d)}`,
      gross: round2(gross),
      fuel: round2(fuel),
      available: round2(gross - fuel - reserved),
    });
  }
  return out;
}

function monthChartData() {
  const totalDays = daysInMonth(view.yearUber, view.monthUber);
  const out = [];
  let cumulativeAvailable = 0;
  for (let d = 1; d <= totalDays; d++) {
    const entry = findEntry(dateKey(view.yearUber, view.monthUber, d));
    const active = !!entry && entry.active !== false;
    const gross = active ? Math.max(Number(entry.value) || 0, 0) : 0;
    const fuel = active ? Math.max(Number(entry.fuelExpense) || 0, 0) : 0;
    const reserved = active ? Math.max(Number(entry.reserveValue) || 0, 0) : 0;
    cumulativeAvailable = round2(cumulativeAvailable + gross - fuel - reserved);
    out.push({ day: d, gross: round2(gross), cumulativeAvailable });
  }
  return out;
}

function renderWeekChart() {
  const el = document.getElementById('uberWeekChart');
  const kpi = document.getElementById('uberWeekChartTotal');
  if (!el || !kpi) return;
  const rows = weekChartData();
  const week = getWeekSummary();
  kpi.textContent = `${moneyCompact(week.available)} disponível`;

  const W = 440, H = 215, left = 34, right = 8, top = 16, bottom = 28;
  const plotW = W - left - right, plotH = H - top - bottom;
  const maxValue = Math.max(1, ...rows.flatMap((r) => [r.gross, r.fuel, Math.max(r.available, 0)]));
  const niceMax = Math.ceil(maxValue / 50) * 50 || 50;
  const y = (v) => top + plotH - (Math.max(v, 0) / niceMax) * plotH;
  const groupW = plotW / Math.max(rows.length, 1);
  const barW = Math.min(10, groupW / 4.2);
  const colors = { gross: '#00E5FF', fuel: '#FF3CAC', available: '#B6FF3C' };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Desempenho financeiro da semana">`;

  for (let i = 0; i <= 4; i++) {
    const val = niceMax * i / 4;
    const yy = y(val);
    svg += `<line class="uber-svg-grid" x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}"/>`;
    svg += `<text class="uber-svg-axis" x="${left-5}" y="${yy+3}" text-anchor="end">${svgEscape(val >= 1000 ? `${(val/1000).toFixed(1)}k` : Math.round(val))}</text>`;
  }

  rows.forEach((r, i) => {
    const cx = left + groupW * i + groupW / 2;
    const items = [['gross', r.gross, -barW-2], ['fuel', r.fuel, 0], ['available', Math.max(r.available, 0), barW+2]];
    items.forEach(([key, value, offset]) => {
      const yy = y(value);
      const h = Math.max(top + plotH - yy, value > 0 ? 1 : 0);
      svg += `<rect x="${cx + offset - barW/2}" y="${yy}" width="${barW}" height="${h}" rx="2" fill="${colors[key]}" opacity=".88"/>`;
    });
    svg += `<text class="uber-svg-day" x="${cx}" y="${H-10}">${svgEscape(r.label)}</text>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

function renderMonthChart() {
  const el = document.getElementById('uberMonthChart');
  const kpi = document.getElementById('uberMonthChartTotal');
  if (!el || !kpi) return;
  const rows = monthChartData();
  const month = getUberMonthSummary(view.yearUber, view.monthUber);
  kpi.textContent = `${moneyCompact(month.total)} bruto`;

  const W = 440, H = 230, left = 34, right = 9, top = 16, bottom = 28;
  const plotW = W - left - right, plotH = H - top - bottom;
  const values = rows.flatMap((r) => [r.gross, r.cumulativeAvailable]);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(1, ...values);
  const range = Math.max(maxValue - minValue, 1);
  const y = (v) => top + plotH - ((v - minValue) / range) * plotH;
  const zeroY = y(0);
  const stepX = plotW / Math.max(rows.length, 1);
  const barW = Math.max(3, Math.min(8, stepX * .62));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução financeira do mês">`;
  for (let i = 0; i <= 4; i++) {
    const val = minValue + range * i / 4;
    const yy = y(val);
    svg += `<line class="uber-svg-grid" x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}"/>`;
    svg += `<text class="uber-svg-axis" x="${left-5}" y="${yy+3}" text-anchor="end">${svgEscape(Math.abs(val) >= 1000 ? `${(val/1000).toFixed(1)}k` : Math.round(val))}</text>`;
  }

  rows.forEach((r, i) => {
    const cx = left + stepX * i + stepX / 2;
    if (r.gross > 0) {
      const yy = y(r.gross);
      svg += `<rect x="${cx-barW/2}" y="${yy}" width="${barW}" height="${Math.max(zeroY-yy, 1)}" rx="1.5" fill="#00E5FF" opacity=".78"/>`;
    }
    if (r.day === 1 || r.day % 5 === 0 || r.day === rows.length) {
      svg += `<text class="uber-svg-day" x="${cx}" y="${H-10}">${r.day}</text>`;
    }
  });

  const points = rows.map((r, i) => `${left + stepX * i + stepX / 2},${y(r.cumulativeAvailable)}`).join(' ');
  svg += `<polyline class="uber-svg-line" points="${points}"/>`;
  rows.forEach((r, i) => {
    if (r.day === rows.length || r.gross > 0) {
      svg += `<circle class="uber-svg-point" cx="${left + stepX * i + stepX / 2}" cy="${y(r.cumulativeAvailable)}" r="2.2"/>`;
    }
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

function renderInsights() {
  const el = document.getElementById('uberInsights');
  if (!el) return;
  const entries = uberEntriesForMonth(view.yearUber, view.monthUber)
    .filter((e) => e.active !== false && (Number(e.value) || 0) > 0);
  const month = getUberMonthSummary(view.yearUber, view.monthUber);
  const best = entries.reduce((winner, e) => !winner || (Number(e.value) || 0) > (Number(winner.value) || 0) ? e : winner, null);
  const bestAvailable = entries.reduce((winner, e) => {
    const av = (Number(e.value) || 0) - (Number(e.fuelExpense) || 0) - (Number(e.reserveValue) || 0);
    const winAv = winner ? (Number(winner.value) || 0) - (Number(winner.fuelExpense) || 0) - (Number(winner.reserveValue) || 0) : -Infinity;
    return av > winAv ? e : winner;
  }, null);
  const avgAvailable = entries.length ? round2(month.available / entries.length) : 0;
  const fuelPct = month.total > 0 ? round2((month.fuel / month.total) * 100) : 0;
  const reservePct = month.total > 0 ? round2((month.reserved / month.total) * 100) : 0;

  const formatEntryDate = (e) => e?.date ? `${e.date.slice(8,10)}/${e.date.slice(5,7)}` : '—';
  const bestAvailVal = bestAvailable ? round2((Number(bestAvailable.value)||0) - (Number(bestAvailable.fuelExpense)||0) - (Number(bestAvailable.reserveValue)||0)) : 0;
  const cards = [
    ['Melhor faturamento', best ? currency(best.value) : '—', best ? formatEntryDate(best) : 'Sem lançamentos'],
    ['Melhor disponível', bestAvailable ? currency(bestAvailVal) : '—', bestAvailable ? formatEntryDate(bestAvailable) : 'Sem lançamentos'],
    ['Média disponível/dia', currency(avgAvailable), `${entries.length} dia${entries.length === 1 ? '' : 's'} com receita`],
    ['Combustível / bruto', `${fuelPct.toLocaleString('pt-BR')}%`, `${currency(month.fuel)} no mês`],
    ['Separado / bruto', `${reservePct.toLocaleString('pt-BR')}%`, `${currency(month.reserved)} reservado`],
    ['Eficiência líquida', `${month.total > 0 ? round2((month.available / month.total) * 100).toLocaleString('pt-BR') : 0}%`, 'Disponível ÷ bruto'],
    ['KM rodados', `${month.totalKm.toLocaleString('pt-BR')} km`, `${month.averageKmPerDay.toLocaleString('pt-BR')} km/dia trabalhado`],
    ['Bruto por KM', `${currency(month.grossPerKm)}/km`, `${currency(month.availablePerKm)}/km disponível`],
  ];
  el.innerHTML = cards.map(([label, value, sub]) => `
    <div class="uber-insight">
      <div class="lbl">${label}</div>
      <div class="val">${value}</div>
      <div class="sub">${sub}</div>
    </div>`).join('');
}

function renderAnalytics() {
  renderWeekChart();
  renderMonthChart();
  renderInsights();
}

function renderSummary() {
  const month = getUberMonthSummary(view.yearUber, view.monthUber);
  const week = getWeekSummary();
  document.getElementById('uberWeekSummary').textContent =
    `${week.days} dia${week.days !== 1 ? 's' : ''} trabalhado${week.days !== 1 ? 's' : ''} · bruto ${currency(week.gross)} · combustível ${currency(week.fuel)} · ${week.km.toLocaleString('pt-BR')} km · bruto/km ${currency(week.grossPerKm)} · separado ${currency(week.reserved)} · disponível ${currency(week.available)}`;

  const cards = [
    ['GANHO DO MÊS', month.total, 'cyan'],
    ['COMBUSTÍVEL', -month.fuel, 'pink'],
    ['SEPARADO', month.reserved, 'gold'],
    ['DISPONÍVEL UBER', month.available, month.available >= 0 ? 'green' : 'pink'],
    ['DIAS TRABALHADOS', month.daysWorked, 'purple', false],
    ['KM DO MÊS', `${month.totalKm.toLocaleString('pt-BR')} km`, 'cyan', false],
    ['MÉDIA KM / DIA', `${month.averageKmPerDay.toLocaleString('pt-BR')} km`, 'purple', false],
    ['BRUTO / KM', `${currency(month.grossPerKm)}/km`, 'orange', false],
  ];
  document.getElementById('uberSummaryGrid').innerHTML = cards.map(([label, value, color, money = true]) => `
    <div class="summary-card">
      <div class="lbl">${label}</div>
      <div class="val mono ${color}">${money ? currency(value) : value}</div>
    </div>`).join('');
}

export function renderUber() { renderHeader(); renderWeekPills(); renderWeekStrip(); renderSummary(); renderAnalytics(); }

export function initUber() {
  document.getElementById('prevMonthUber').onclick = () => shiftMonth(-1);
  document.getElementById('nextMonthUber').onclick = () => shiftMonth(1);
  autoSelectCurrentWeek();
  renderUber();
}
