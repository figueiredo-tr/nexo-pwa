// Aba Saídas — CRUD de lançamentos (combustível, manutenção etc).
// Extraído do app.js na Fase 2A. Comportamento idêntico ao anterior — os ids
// continuam Date.now() de propósito (ver nota em state.js sobre genId()).

import { MONTH_NAMES, view, data, currency, expensesForMonth, scheduleSave, getCategories } from './state.js';
import { recalc } from './simulator.js';

function shiftMonthSaidas(delta) {
  view.monthSaidas += delta;
  if (view.monthSaidas < 0) { view.monthSaidas = 11; view.yearSaidas--; }
  if (view.monthSaidas > 11) { view.monthSaidas = 0; view.yearSaidas++; }
  renderExpenses();
}

export function renderExpenses() {
  const addCategory = document.getElementById('expCategory');
  if (addCategory) {
    const current = addCategory.value;
    addCategory.innerHTML = getCategories('expenses').map((c) => `<option>${c}</option>`).join('');
    if (getCategories('expenses').includes(current)) addCategory.value = current;
  }
  document.getElementById('monthLabelSaidas').textContent = `${MONTH_NAMES[view.monthSaidas]} ${view.yearSaidas}`;
  const list = expensesForMonth(view.yearSaidas, view.monthSaidas).sort((a, b) => (a.date < b.date ? 1 : -1));

  const total = list.reduce((s, e) => s + Number(e.value || 0), 0);
  document.getElementById('totalSaidasMes').textContent = currency(total);
  document.getElementById('countSaidasMes').textContent = list.length;

  const table = document.getElementById('expenseTable');
  if (list.length === 0) {
    table.innerHTML = '<div class="exp-empty">Nenhuma saída lançada neste mês ainda.</div>';
    return;
  }

  const rows = list.map((e) => {
    if (view.editingExpenseId === e.id) {
      return `
        <tr data-id="${e.id}">
          <td><input class="input-field" type="date" value="${e.date}" data-field="date" /></td>
          <td>
            <select class="input-field" data-field="category">
              ${getCategories('expenses')
                .map((c) => `<option ${c === e.category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </td>
          <td><input class="input-field" type="text" value="${e.desc || ''}" data-field="desc" /></td>
          <td><input class="input-field mono" type="number" value="${e.value}" data-field="value" /></td>
          <td class="exp-actions">
            <button class="edit save-edit" data-id="${e.id}"><span class="app-icon icon-circle-check sm"></span></button>
            <button class="del cancel-edit">Cancelar</button>
          </td>
        </tr>`;
    }
    const linked = e.sourceType === 'debtPayment' || e.sourceType === 'cardInvoice';
    const linkedLabel = e.sourceType === 'cardInvoice' ? 'Fatura' : e.sourceType === 'debtPayment' ? 'Dívida' : '';
    return `
      <tr data-id="${e.id}">
        <td class="mono">${e.date.split('-').reverse().join('/')}</td>
        <td><span class="exp-cat-tag">${e.category}</span>${linked ? `<span class="movement-kind">${linkedLabel}</span>` : ''}</td>
        <td>${e.desc || '—'}</td>
        <td class="mono">${currency(e.value)}</td>
        <td class="exp-actions">
          ${linked ? '<span class="movement-origin">Gerencie no módulo de origem</span>' : `<button class="edit start-edit" data-id="${e.id}">✎</button><button class="del del-expense" data-id="${e.id}">Excluir</button>`}
        </td>
      </tr>`;
  }).join('');

  table.innerHTML = `
    <table class="exp-table">
      <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Valor</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  table.querySelectorAll('.start-edit').forEach((b) => b.onclick = () => {
    view.editingExpenseId = Number(b.dataset.id);
    renderExpenses();
  });
  table.querySelectorAll('.cancel-edit').forEach((b) => b.onclick = () => {
    view.editingExpenseId = null;
    renderExpenses();
  });
  table.querySelectorAll('.del-expense').forEach((b) => b.onclick = () => {
    if (!confirm('Excluir este lançamento?')) return;
    data.expenses = data.expenses.filter((e) => e.id !== Number(b.dataset.id));
    scheduleSave();
    renderExpenses();
    recalc();
  });
  table.querySelectorAll('.save-edit').forEach((b) => b.onclick = () => {
    const id = Number(b.dataset.id);
    const row = table.querySelector(`tr[data-id="${id}"]`);
    const item = data.expenses.find((e) => e.id === id);
    item.date = row.querySelector('[data-field="date"]').value;
    item.category = row.querySelector('[data-field="category"]').value;
    item.desc = row.querySelector('[data-field="desc"]').value;
    item.value = Number(row.querySelector('[data-field="value"]').value) || 0;
    view.editingExpenseId = null;
    scheduleSave();
    renderExpenses();
    recalc();
  });
}

export function initExpenses() {
  document.getElementById('prevMonthSaidas').onclick = () => shiftMonthSaidas(-1);
  document.getElementById('nextMonthSaidas').onclick = () => shiftMonthSaidas(1);
  document.getElementById('expDate').value = new Date().toISOString().slice(0, 10);
  const expCategory = document.getElementById('expCategory');
  expCategory.innerHTML = getCategories('expenses').map((c) => `<option>${c}</option>`).join('');

  document.getElementById('addExpenseBtn').onclick = () => {
    const date = document.getElementById('expDate').value;
    const category = document.getElementById('expCategory').value;
    const desc = document.getElementById('expDesc').value.trim();
    const value = Number(document.getElementById('expValue').value);
    if (!date || !value) { alert('Preencha ao menos a data e o valor.'); return; }

    data.expenses.push({ id: Date.now(), date, category, desc, value });
    scheduleSave();
    document.getElementById('expDesc').value = '';
    document.getElementById('expValue').value = '';
    // pula pro mês do lançamento, se for diferente
    const [y, m] = date.split('-').map(Number);
    view.yearSaidas = y; view.monthSaidas = m - 1;
    renderExpenses();
    recalc();
  };
}
