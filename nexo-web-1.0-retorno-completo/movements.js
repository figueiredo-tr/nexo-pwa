// Fase 5.5B — Movimentos: consolida ENTRADAS reais (Uber + outras entradas)
// e Saídas já existentes em um extrato mensal. O CRUD de Saídas continua no
// módulo expenses.js; aqui o CRUD novo é somente de outras entradas.

import {
  MONTH_NAMES, view, data, currency, genId, scheduleSave,
  incomesForMonth, expensesForMonth, uberEntriesForMonth, getCategories,
} from './state.js';
import { showAlert, showConfirm } from './ui-dialogs.js';


function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function esc(v = '') { return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function fmtDate(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }
function ownerName(record={}) {
  const id = record.isShared === true ? null : (record.ownerProfileId || record.createdByProfileId || null);
  if (!id) return 'Compartilhado';
  return data.profiles?.find((p) => String(p.id) === String(id))?.name || 'Perfil';
}

function shiftMonth(delta) {
  view.monthMovimentos += delta;
  if (view.monthMovimentos < 0) { view.monthMovimentos = 11; view.yearMovimentos--; }
  if (view.monthMovimentos > 11) { view.monthMovimentos = 0; view.yearMovimentos++; }
  renderMovements();
}

function buildMovements(y, m) {
  const uberEntries = uberEntriesForMonth(y, m).filter((e) => e.active !== false);

  const uber = uberEntries
    .filter((e) => (Number(e.value) || 0) !== 0)
    .map((e) => ({
      uid: `uber:${e.id}`, rawId: e.id, type: 'entrada', origin: 'Uber',
      date: e.date, category: 'Uber', description: 'Ganho diário Uber', value: Number(e.value) || 0, owner: ownerName(e),
    }));

  const uberFuel = uberEntries
    .filter((e) => (Number(e.fuelExpense) || 0) > 0)
    .map((e) => ({
      uid: `uber-fuel:${e.id}`, rawId: e.id, type: 'saida', origin: 'Uber',
      date: e.date, category: 'Combustível', description: 'Combustível Uber', value: Number(e.fuelExpense) || 0, owner: ownerName(e),
    }));

  const uberReserved = uberEntries
    .filter((e) => (Number(e.reserveValue) || 0) > 0)
    .map((e) => ({
      uid: `uber-reserve:${e.id}`, rawId: e.id, type: 'reserva', origin: 'Uber',
      date: e.date, category: 'Valor separado', description: `Valor separado do Uber${Number(e.reservePercent) > 0 ? ` (${Number(e.reservePercent)}%)` : ''}`, value: Number(e.reserveValue) || 0, owner: ownerName(e),
    }));

  const incomes = incomesForMonth(y, m).map((e) => ({
    uid: `income:${e.id}`, rawId: e.id, type: 'entrada', origin: 'Outra entrada',
    date: e.date, category: e.category || 'Outros', description: e.description || e.source || 'Entrada', value: Number(e.value) || 0, owner: ownerName(e),
  }));

  const expenses = expensesForMonth(y, m).map((e) => ({
    uid: `expense:${e.id}`, rawId: e.id, type: 'saida',
    origin: e.sourceType === 'cardInvoice' ? 'Cartão' : e.sourceType === 'debtPayment' ? 'Dívida' : 'Saídas',
    date: e.date, category: e.category || 'Outros', description: e.desc || 'Saída', value: Number(e.value) || 0, owner: ownerName(e),
  }));

  return [...uber, ...uberFuel, ...uberReserved, ...incomes, ...expenses].sort((a, b) => {
    if (a.date === b.date) {
      const order = { entrada: 0, saida: 1, reserva: 2 };
      return order[a.type] - order[b.type];
    }
    return a.date < b.date ? 1 : -1;
  });
}

export function getMovementsSummary(y, m) {
  const rows = buildMovements(y, m);
  const entradas = round2(rows.filter((r) => r.type === 'entrada').reduce((s, r) => s + r.value, 0));
  const saidas = round2(rows.filter((r) => r.type === 'saida').reduce((s, r) => s + r.value, 0));
  const reservado = round2(rows.filter((r) => r.type === 'reserva').reduce((s, r) => s + r.value, 0));
  return {
    entradas, saidas, reservado,
    resultado: round2(entradas - saidas),
    disponivel: round2(entradas - saidas - reservado),
    count: rows.length,
  };
}

function filteredRows() {
  let rows = buildMovements(view.yearMovimentos, view.monthMovimentos);
  if (view.filterTipoMovimentos !== 'todos') {
    const wanted = view.filterTipoMovimentos === 'entradas' ? 'entrada' : view.filterTipoMovimentos === 'reservas' ? 'reserva' : 'saida';
    rows = rows.filter((r) => r.type === wanted);
  }
  const q = view.searchMovimentos.trim().toLowerCase();
  if (q) rows = rows.filter((r) => `${r.origin} ${r.category} ${r.description}`.toLowerCase().includes(q));
  return rows;
}

function renderSummary() {
  const s = getMovementsSummary(view.yearMovimentos, view.monthMovimentos);
  document.getElementById('movSummaryGrid').innerHTML = [
    ['ENTRADAS REAIS', s.entradas, 'green'],
    ['SAÍDAS REAIS', -s.saidas, 'pink'],
    ['SEPARADO UBER', s.reservado, 'gold'],
    ['RESULTADO DO MÊS', s.resultado, s.resultado >= 0 ? 'cyan' : 'pink'],
    ['DISPONÍVEL APÓS SEPARADO', s.disponivel, s.disponivel >= 0 ? 'purple' : 'pink'],
    ['MOVIMENTAÇÕES', s.count, 'purple', false],
  ].map(([label, value, color, money = true]) => `
    <div class="summary-card">
      <div class="lbl">${label}</div>
      <div class="val mono ${color}">${money ? currency(value) : value}</div>
    </div>`).join('');
}

function renderIncomeEdit(row) {
  const item = data.incomes.find((e) => e.id === row.rawId);
  if (!item) return '';
  return `
    <tr data-income-id="${item.id}" class="movement-edit-row">
      <td><input class="input-field mono" type="date" data-field="date" value="${esc(item.date)}"></td>
      <td><select class="input-field" data-field="category">${getCategories('incomes').map((c) => `<option ${c === item.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><input class="input-field" data-field="description" value="${esc(item.description || '')}"></td>
      <td><input class="input-field mono" type="number" min="0" step="0.01" data-field="value" value="${Number(item.value) || 0}"></td>
      <td class="exp-actions"><button class="edit save-income" data-id="${item.id}"><span class="app-icon icon-circle-check sm"></span></button><button class="del cancel-income">Cancelar</button></td>
    </tr>`;
}

function renderTable() {
  const rows = filteredRows();
  const box = document.getElementById('movementsTable');
  if (!rows.length) {
    box.innerHTML = '<div class="exp-empty">Nenhuma movimentação encontrada neste período.</div>';
    return;
  }

  box.innerHTML = `<table class="exp-table movement-table">
    <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th><th></th></tr></thead>
    <tbody>${rows.map((r) => {
      if (r.type === 'entrada' && r.origin === 'Outra entrada' && view.editingIncomeId === r.rawId) return renderIncomeEdit(r);
      const sign = r.type === 'entrada' ? '+' : '-';
      const color = r.type === 'entrada' ? 'green' : r.type === 'reserva' ? 'gold' : 'pink';
      const badge = r.type === 'entrada' ? 'Entrada' : r.type === 'reserva' ? 'Separado' : 'Saída';
      let actions = '<span class="movement-origin">' + esc(r.origin) + '</span>';
      if (r.origin === 'Outra entrada') actions = `<button class="edit edit-income" data-id="${r.rawId}">✎</button><button class="del delete-income" data-id="${r.rawId}">Excluir</button>`;
      return `<tr>
        <td class="mono">${fmtDate(r.date)}</td>
        <td><span class="exp-cat-tag movement-tag ${r.type}">${esc(r.category)}</span><span class="movement-kind">${badge}</span></td>
        <td>${esc(r.description)}<div class="movement-origin">${esc(r.owner || 'Compartilhado')}</div></td>
        <td class="mono ${color}">${sign}${currency(Math.abs(r.value))}</td>
        <td class="exp-actions">${actions}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  box.querySelectorAll('.edit-income').forEach((b) => b.onclick = () => { view.editingIncomeId = b.dataset.id; renderTable(); });
  box.querySelectorAll('.cancel-income').forEach((b) => b.onclick = () => { view.editingIncomeId = null; renderTable(); });
  box.querySelectorAll('.delete-income').forEach((b) => b.onclick = async () => {
    if (!(await showConfirm('Excluir esta entrada?'))) return;
    data.incomes = data.incomes.filter((e) => e.id !== b.dataset.id);
    scheduleSave();
    renderMovements();
  });
  box.querySelectorAll('.save-income').forEach((b) => b.onclick = async () => {
    const item = data.incomes.find((e) => e.id === b.dataset.id);
    const tr = box.querySelector(`tr[data-income-id="${b.dataset.id}"]`);
    if (!item || !tr) return;
    const value = Number(tr.querySelector('[data-field="value"]').value);
    const date = tr.querySelector('[data-field="date"]').value;
    if (!date || !(value > 0)) { await showAlert('Informe uma data e um valor maior que zero.'); return; }
    item.date = date;
    item.category = tr.querySelector('[data-field="category"]').value;
    item.description = tr.querySelector('[data-field="description"]').value.trim();
    item.value = round2(value);
    item.updatedAt = new Date().toISOString();
    view.editingIncomeId = null;
    scheduleSave();
    renderMovements();
  });
}

export function renderMovements() {
  const incomeCategory = document.getElementById('movIncomeCategory');
  if (incomeCategory) {
    const current = incomeCategory.value;
    const cats = getCategories('incomes');
    incomeCategory.innerHTML = cats.map((c) => `<option>${c}</option>`).join('');
    if (cats.includes(current)) incomeCategory.value = current;
  }
  document.getElementById('movMonthLabel').textContent = `${MONTH_NAMES[view.monthMovimentos]} ${view.yearMovimentos}`;
  document.getElementById('movFilterType').value = view.filterTipoMovimentos;
  document.getElementById('movSearch').value = view.searchMovimentos;
  renderSummary();
  renderTable();
}

export function initMovements() {
  document.getElementById('prevMonthMov').onclick = () => shiftMonth(-1);
  document.getElementById('nextMonthMov').onclick = () => shiftMonth(1);
  document.getElementById('movIncomeDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('movIncomeCategory').innerHTML = getCategories('incomes').map((c) => `<option>${c}</option>`).join('');

  document.getElementById('movFilterType').onchange = (e) => { view.filterTipoMovimentos = e.target.value; renderTable(); };
  document.getElementById('movSearch').oninput = (e) => { view.searchMovimentos = e.target.value; renderTable(); };

  document.getElementById('addIncomeBtn').onclick = async () => {
    const date = document.getElementById('movIncomeDate').value;
    const category = document.getElementById('movIncomeCategory').value;
    const source = document.getElementById('movIncomeSource').value.trim();
    const description = document.getElementById('movIncomeDesc').value.trim();
    const value = Number(document.getElementById('movIncomeValue').value);
    const notes = document.getElementById('movIncomeNotes').value.trim();
    if (!date || !(value > 0)) { await showAlert('Preencha a data e um valor maior que zero.'); return; }
    const now = new Date().toISOString();
    data.incomes.push({
      id: genId(), date, category, source, description: description || source || category,
      value: round2(value), notes, ownerProfileId: data.settings.activeProfileId || null, isShared: false, createdByProfileId: data.settings.activeProfileId || null, updatedByProfileId: data.settings.activeProfileId || null, createdAt: now, updatedAt: now,
    });
    scheduleSave();
    document.getElementById('movIncomeSource').value = '';
    document.getElementById('movIncomeDesc').value = '';
    document.getElementById('movIncomeValue').value = '';
    document.getElementById('movIncomeNotes').value = '';
    const [y, m] = date.split('-').map(Number);
    view.yearMovimentos = y; view.monthMovimentos = m - 1;
    renderMovements();
  };

  renderMovements();
}
