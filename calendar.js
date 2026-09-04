// Fase 8 — Calendário Financeiro.
// Consolida vencimentos e marcos dos módulos existentes sem alterar o fluxo de caixa.
// Eventos manuais são lembretes informativos; não viram Saídas/Entradas automaticamente.

import {
  MONTH_NAMES, WEEKDAY_NAMES, today, view, data,
  currency, pad2, genId, scheduleSave,
} from './state.js';
import { getInvoiceSummary } from './cards.js';
import { showAlert, showConfirm } from './ui-dialogs.js';

const FILTER_LABELS = {
  todos: 'Todos', prioridade: 'Prioridades', cartao: 'Cartões', divida: 'Dívidas',
  viagem: 'Viagens', lembrete: 'Lembretes', recebimento: 'Recebimentos',
};

const TYPE_META = {
  prioridade: { label: 'Prioridade', icon: 'siren', cls: 'priority' },
  cartao: { label: 'Cartão', icon: 'credit-card', cls: 'card' },
  divida: { label: 'Dívida', icon: 'badge-dollar-sign', cls: 'debt' },
  viagem: { label: 'Viagem', icon: 'plane', cls: 'trip' },
  lembrete: { label: 'Lembrete', icon: 'clock-alert', cls: 'reminder' },
  recebimento: { label: 'Recebimento', icon: 'coins', cls: 'income' },
};

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function esc(v = '') { return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function monthKey(y, m) { return `${y}-${pad2(m + 1)}`; }
function refKey(y, m) { return monthKey(y, m); }
function addMonths(y, m, delta) { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; }
function safeIso(y, m, day) { const max = new Date(y, m + 1, 0).getDate(); return `${y}-${pad2(m + 1)}-${pad2(Math.min(Math.max(Number(day) || 1, 1), max))}`; }
function fmtDate(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }
function dateInMonth(iso, y, m) { return !!iso && iso.startsWith(monthKey(y, m)); }
function dayFromIso(iso) { return Number(String(iso).slice(8, 10)) || 1; }
function compareMonth(y1, m1, y2, m2) { return (y1 * 12 + m1) - (y2 * 12 + m2); }

function manualEventsForMonth(y, m) {
  const out = [];
  for (const e of data.calendarEvents || []) {
    if (!e.date) continue;
    const [ey, em1, ed] = e.date.split('-').map(Number);
    const em = em1 - 1;
    if (e.recurringMonthly) {
      if (compareMonth(y, m, ey, em) < 0) continue;
      out.push({
        id: `manual:${e.id}:${y}-${m}`, sourceId: e.id, type: e.category === 'Recebimento' ? 'recebimento' : 'lembrete',
        date: safeIso(y, m, ed), title: e.title, amount: Number(e.amount) || 0,
        subtitle: `${e.category || 'Lembrete'} · recorrente mensal`, notes: e.notes || '', manual: true, recurring: true,
      });
    } else if (dateInMonth(e.date, y, m)) {
      out.push({
        id: `manual:${e.id}`, sourceId: e.id, type: e.category === 'Recebimento' ? 'recebimento' : 'lembrete',
        date: e.date, title: e.title, amount: Number(e.amount) || 0,
        subtitle: e.category || 'Lembrete', notes: e.notes || '', manual: true, recurring: false,
      });
    }
  }
  return out;
}

function priorityEvents(y, m) {
  return (data.priorities || []).filter((p) => dateInMonth(p.dataVencimento, y, m)).map((p) => {
    const outstanding = Math.max((Number(p.valorPrevisto) || 0) - (Number(p.valorPago) || 0), 0);
    const paid = (Number(p.valorPago) || 0) >= (Number(p.valorPrevisto) || 0) && (Number(p.valorPrevisto) || 0) > 0;
    return {
      id: `priority:${p.id}`, sourceId: p.id, type: 'prioridade', date: p.dataVencimento,
      title: p.nome || 'Prioridade', amount: round2(outstanding),
      subtitle: `${p.nivelPrioridade || 'Prioridade'}${p.recorrente ? ' · recorrente' : ''}`,
      status: paid ? 'Pago' : 'Pendente', paid, notes: p.observacoes || '',
    };
  });
}

function debtEvents(y, m) {
  const out = [];
  for (const d of data.debts || []) {
    if (d.status === 'Quitada' || (Number(d.saldoAtual) || 0) <= 0 || !d.proximoVencimento) continue;
    const [sy, sm1, sd] = d.proximoVencimento.split('-').map(Number);
    const sm = sm1 - 1;
    const remaining = Math.max((Number(d.quantidadeParcelas) || 0) - (Number(d.parcelasPagas) || 0), 1);
    const diff = compareMonth(y, m, sy, sm);
    if (diff < 0 || diff >= remaining) continue;
    const date = safeIso(y, m, sd);
    const amount = Math.min(Number(d.valorParcela) || 0, Number(d.saldoAtual) || Infinity);
    out.push({
      id: `debt:${d.id}:${y}-${m}`, sourceId: d.id, type: 'divida', date,
      title: d.credor || d.descricao || 'Parcela de dívida', amount: round2(amount),
      subtitle: diff === 0 ? 'Próximo vencimento' : `Parcela projetada +${diff} mês${diff === 1 ? '' : 'es'}`,
      status: d.status || 'Ativa', projected: diff > 0, notes: d.observacoes || '',
    });
  }
  return out;
}

function cardEvents(y, m) {
  const out = [];
  const refs = [-1, 0, 1].map((delta) => { const r = addMonths(y, m, delta); return refKey(r.y, r.m); });
  for (const card of data.creditCards || []) {
    if (card.ativo === false) continue;
    for (const ref of refs) {
      const inv = getInvoiceSummary(card.id, ref);
      if (!inv || inv.total <= 0 || !dateInMonth(inv.dates.due, y, m)) continue;
      out.push({
        id: `card:${card.id}:${ref}`, sourceId: card.id, type: 'cartao', date: inv.dates.due,
        title: `Fatura ${card.nome}`, amount: round2(inv.total),
        subtitle: `${MONTH_NAMES[Number(ref.slice(5,7)) - 1]} ${ref.slice(0,4)} · fecha ${fmtDate(inv.dates.closing)}`,
        status: inv.status, paid: inv.status === 'Paga', notes: '',
      });
    }
  }
  return out;
}

function tripEvents(y, m) {
  const out = [];
  for (const t of data.trips || []) {
    if (t.status === 'Cancelada') continue;
    if (dateInMonth(t.dataIda, y, m)) out.push({
      id: `trip:start:${t.id}`, sourceId: t.id, type: 'viagem', date: t.dataIda,
      title: `Início: ${t.nome || t.destino || 'Viagem'}`, amount: 0,
      subtitle: t.destino || 'Viagem', status: t.status || 'Planejada', notes: t.observacoes || '',
    });
    if (t.dataVolta && t.dataVolta !== t.dataIda && dateInMonth(t.dataVolta, y, m)) out.push({
      id: `trip:end:${t.id}`, sourceId: t.id, type: 'viagem', date: t.dataVolta,
      title: `Retorno: ${t.nome || t.destino || 'Viagem'}`, amount: 0,
      subtitle: t.destino || 'Viagem', status: t.status || 'Planejada', notes: '',
    });
  }
  return out;
}

function incomeEvents(y, m) {
  const out = [];
  for (const i of data.incomes || []) {
    if (!dateInMonth(i.date, y, m)) continue;
    out.push({
      id: `income:${i.id}`, sourceId: i.id, type: 'recebimento', date: i.date,
      title: i.description || i.source || 'Entrada', amount: Number(i.value) || 0,
      subtitle: i.category || i.source || 'Recebimento', status: 'Recebido', received: true, notes: i.notes || '',
    });
  }
  for (const d of data.dividends || []) {
    if (!dateInMonth(d.dataPagamento, y, m)) continue;
    const inv = (data.investments || []).find((x) => x.id === d.investimentoId);
    out.push({
      id: `dividend:${d.id}`, sourceId: d.id, type: 'recebimento', date: d.dataPagamento,
      title: `${d.tipoRendimento || 'Rendimento'}${inv ? ` · ${inv.ticker || inv.nome}` : ''}`,
      amount: Number(d.valor) || 0, subtitle: 'Investimentos', status: 'Recebido', received: true, notes: d.observacoes || '',
    });
  }
  return out;
}

export function getCalendarEvents(y = view.yearCalendario, m = view.monthCalendario) {
  return [
    ...priorityEvents(y, m), ...cardEvents(y, m), ...debtEvents(y, m),
    ...tripEvents(y, m), ...manualEventsForMonth(y, m), ...incomeEvents(y, m),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function filteredEvents() {
  const list = getCalendarEvents();
  if (view.filterCalendario === 'todos') return list;
  return list.filter((e) => e.type === view.filterCalendario);
}

function renderHeader() {
  document.getElementById('calendarMonthLabel').textContent = `${MONTH_NAMES[view.monthCalendario]} ${view.yearCalendario}`;
  const filter = document.getElementById('calendarFilter');
  if (filter) filter.value = view.filterCalendario;
}

function shiftMonth(delta) {
  const d = new Date(view.yearCalendario, view.monthCalendario + delta, 1);
  view.yearCalendario = d.getFullYear(); view.monthCalendario = d.getMonth();
  view.selectedCalendarDate = null;
  renderCalendar();
}

function renderSummary() {
  const events = getCalendarEvents();
  const pendingCommitments = events.filter((e) => ['prioridade','cartao','divida','lembrete'].includes(e.type) && !e.paid && !e.received);
  const commitments = round2(pendingCommitments.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const overdue = events.filter((e) => e.status === 'Atrasada').length;
  const cards = events.filter((e) => e.type === 'cartao' && !e.paid).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const received = events.filter((e) => e.type === 'recebimento').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  document.getElementById('calendarSummaryGrid').innerHTML = [
    ['EVENTOS DO MÊS', events.length, 'cyan', false],
    ['COMPROMISSOS', commitments, 'gold', true],
    ['FATURAS A VENCER', cards, 'pink', true],
    ['ATRASADOS', overdue, overdue ? 'pink' : 'green', false],
    ['RECEBIMENTOS', received, 'green', true],
  ].map(([label, value, color, money]) => `<div class="summary-card"><div class="lbl">${label}</div><div class="val mono ${color}">${money ? currency(value) : value}</div></div>`).join('');
}

function renderGrid() {
  const root = document.getElementById('calendarGrid');
  const events = filteredEvents();
  const byDay = new Map();
  events.forEach((e) => { const day = dayFromIso(e.date); if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push(e); });
  const firstWeekday = new Date(view.yearCalendario, view.monthCalendario, 1).getDay();
  const totalDays = new Date(view.yearCalendario, view.monthCalendario + 1, 0).getDate();
  const currentIso = today.toISOString().slice(0,10);
  let html = WEEKDAY_NAMES.map((d) => `<div class="calendar-weekday">${d}</div>`).join('');
  for (let i = 0; i < firstWeekday; i++) html += '<div class="calendar-day empty"></div>';
  for (let day = 1; day <= totalDays; day++) {
    const iso = safeIso(view.yearCalendario, view.monthCalendario, day);
    const list = byDay.get(day) || [];
    const selected = view.selectedCalendarDate === iso;
    const chips = list.slice(0,3).map((e) => {
      const meta = TYPE_META[e.type] || TYPE_META.lembrete;
      return `<div class="calendar-chip ${meta.cls}" title="${esc(e.title)}"><span class="app-icon icon-${meta.icon} sm"></span> ${esc(e.title)}</div>`;
    }).join('');
    html += `<button class="calendar-day${iso === currentIso ? ' today' : ''}${selected ? ' selected' : ''}${list.length ? ' has-events' : ''}" data-date="${iso}">
      <span class="calendar-day-num">${day}</span>${chips}${list.length > 3 ? `<span class="calendar-more">+${list.length-3}</span>` : ''}
    </button>`;
  }
  root.innerHTML = html;
  root.querySelectorAll('.calendar-day[data-date]').forEach((btn) => btn.onclick = () => {
    view.selectedCalendarDate = btn.dataset.date;
    renderGrid(); renderAgenda();
  });
}

function eventCard(e) {
  const meta = TYPE_META[e.type] || TYPE_META.lembrete;
  const amount = Number(e.amount) || 0;
  return `<div class="calendar-agenda-event ${meta.cls}">
    <div class="calendar-event-icon"><span class="app-icon icon-${meta.icon} sm"></span></div>
    <div class="calendar-event-body">
      <div class="calendar-event-title">${esc(e.title)}</div>
      <div class="calendar-event-sub">${esc(e.subtitle || meta.label)}${e.status ? ` · ${esc(e.status)}` : ''}</div>
      ${e.notes ? `<div class="calendar-event-notes">${esc(e.notes)}</div>` : ''}
    </div>
    ${amount ? `<div class="calendar-event-amount mono ${e.type === 'recebimento' ? 'green' : 'gold'}">${currency(amount)}</div>` : ''}
    ${e.manual ? `<div class="calendar-event-actions"><button class="calendar-manual-edit" data-id="${e.sourceId}" title="Editar">✎</button><button class="calendar-manual-delete" data-id="${e.sourceId}" title="Excluir">Excluir</button></div>` : ''}
  </div>`;
}

function renderAgenda() {
  const all = filteredEvents();
  if (!view.selectedCalendarDate) {
    const currentMonth = view.yearCalendario === today.getFullYear() && view.monthCalendario === today.getMonth();
    view.selectedCalendarDate = currentMonth ? today.toISOString().slice(0,10) : (all[0]?.date || safeIso(view.yearCalendario, view.monthCalendario, 1));
  }
  const list = all.filter((e) => e.date === view.selectedCalendarDate);
  document.getElementById('calendarAgendaDate').textContent = fmtDate(view.selectedCalendarDate);
  document.getElementById('calendarAgenda').innerHTML = list.length ? list.map(eventCard).join('') : '<div class="calendar-empty">Nenhum compromisso neste dia.</div>';
  document.querySelectorAll('.calendar-manual-edit').forEach((b) => b.onclick = () => startEditManual(b.dataset.id));
  document.querySelectorAll('.calendar-manual-delete').forEach((b) => b.onclick = async () => {
    if (!(await showConfirm('Excluir este lembrete do calendário?'))) return;
    data.calendarEvents = data.calendarEvents.filter((e) => e.id !== b.dataset.id); scheduleSave(); renderCalendar();
  });
}

function resetManualForm() {
  view.editingCalendarEventId = null;
  document.getElementById('calendarEventTitle').value = '';
  document.getElementById('calendarEventCategory').value = 'Conta/Compromisso';
  document.getElementById('calendarEventDate').value = view.selectedCalendarDate || safeIso(view.yearCalendario, view.monthCalendario, 1);
  document.getElementById('calendarEventAmount').value = '';
  document.getElementById('calendarEventRecurring').checked = false;
  document.getElementById('calendarEventNotes').value = '';
  document.getElementById('calendarEventSave').textContent = '+ Adicionar';
  document.getElementById('calendarEventCancel').style.display = 'none';
}

function startEditManual(id) {
  const e = data.calendarEvents.find((x) => x.id === id); if (!e) return;
  view.editingCalendarEventId = id;
  document.getElementById('calendarEventTitle').value = e.title || '';
  document.getElementById('calendarEventCategory').value = e.category || 'Conta/Compromisso';
  document.getElementById('calendarEventDate').value = e.date || '';
  document.getElementById('calendarEventAmount').value = e.amount || '';
  document.getElementById('calendarEventRecurring').checked = !!e.recurringMonthly;
  document.getElementById('calendarEventNotes').value = e.notes || '';
  document.getElementById('calendarEventSave').textContent = 'Salvar';
  document.getElementById('calendarEventCancel').style.display = 'inline-block';
  document.getElementById('calendarEventTitle').focus();
}

function saveManual() {
  const title = document.getElementById('calendarEventTitle').value.trim();
  const date = document.getElementById('calendarEventDate').value;
  if (!title || !date) return showAlert('Informe o título e a data do lembrete.');
  const fields = {
    title, date,
    category: document.getElementById('calendarEventCategory').value,
    amount: round2(Math.max(Number(document.getElementById('calendarEventAmount').value) || 0, 0)),
    recurringMonthly: document.getElementById('calendarEventRecurring').checked,
    notes: document.getElementById('calendarEventNotes').value.trim(),
  };
  const now = new Date().toISOString();
  if (view.editingCalendarEventId) {
    const e = data.calendarEvents.find((x) => x.id === view.editingCalendarEventId);
    if (e) Object.assign(e, fields, { updatedAt: now });
  } else {
    data.calendarEvents.push({ id: genId(), ...fields, createdAt: now, updatedAt: now });
  }
  scheduleSave();
  const [y,m1] = date.split('-').map(Number);
  view.yearCalendario = y; view.monthCalendario = m1 - 1; view.selectedCalendarDate = date;
  resetManualForm(); renderCalendar();
}

export function renderCalendar() {
  renderHeader(); renderSummary(); renderGrid(); renderAgenda();
  if (!view.editingCalendarEventId && !document.getElementById('calendarEventDate').value) resetManualForm();
}

export function initCalendar() {
  document.getElementById('prevMonthCalendar').onclick = () => shiftMonth(-1);
  document.getElementById('nextMonthCalendar').onclick = () => shiftMonth(1);
  document.getElementById('calendarTodayBtn').onclick = () => {
    view.yearCalendario = today.getFullYear(); view.monthCalendario = today.getMonth();
    view.selectedCalendarDate = today.toISOString().slice(0,10); renderCalendar();
  };
  document.getElementById('calendarFilter').onchange = (e) => { view.filterCalendario = e.target.value; renderGrid(); renderAgenda(); };
  document.getElementById('calendarEventSave').onclick = saveManual;
  document.getElementById('calendarEventCancel').onclick = resetManualForm;
  resetManualForm(); renderCalendar();
}
