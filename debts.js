// Fase 6 — Dívidas.
// Controle patrimonial separado do saldo principal. O saldo total das dívidas NÃO
// afeta o Dashboard automaticamente. Somente pagamentos marcados explicitamente
// como "Registrar como saída" entram em data.expenses e, por consequência, em
// Movimentos/Visão Geral.

import { view, data, genId, scheduleSave, currency } from './state.js';
import { showAlert, showConfirm } from './ui-dialogs.js';

const STATUSES = ['Ativa', 'Negociada', 'Atrasada', 'Quitada'];

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function fmtDate(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function paymentsForDebt(debtId) {
  return data.debtPayments.filter((p) => p.dividaId === debtId)
    .sort((a, b) => (a.dataPagamento < b.dataPagamento ? 1 : -1));
}

function effectiveStatus(debt) {
  if ((Number(debt.saldoAtual) || 0) <= 0) return 'Quitada';
  return STATUSES.includes(debt.status) ? debt.status : 'Ativa';
}

function progressPct(debt) {
  const original = Math.max(Number(debt.valorOriginal) || 0, 0);
  if (!original) return 0;
  return Math.max(0, Math.min(100, Math.round(((original - Math.max(Number(debt.saldoAtual) || 0, 0)) / original) * 100)));
}

export function getDebtsSummary(list = data.debts) {
  const active = list.filter((d) => effectiveStatus(d) !== 'Quitada');
  const original = round2(active.reduce((s, d) => s + (Number(d.valorOriginal) || 0), 0));
  const remaining = round2(active.reduce((s, d) => s + (Number(d.saldoAtual) || 0), 0));
  const monthly = round2(active.reduce((s, d) => s + (Number(d.valorParcela) || 0), 0));
  const paid = round2(list.reduce((s, d) => s + Math.max((Number(d.valorOriginal) || 0) - (Number(d.saldoAtual) || 0), 0), 0));
  return { total: list.length, active: active.length, original, remaining, monthly, paid };
}

function createDebt(fields) {
  const now = new Date().toISOString();
  const original = round2(fields.valorOriginal);
  const saldo = fields.saldoAtual === '' || fields.saldoAtual == null ? original : round2(fields.saldoAtual);
  const record = {
    id: genId(),
    credor: fields.credor,
    descricao: fields.descricao || '',
    valorOriginal: original,
    saldoAtual: Math.max(saldo, 0),
    taxaJuros: Math.max(round2(fields.taxaJuros), 0),
    quantidadeParcelas: Math.max(parseInt(fields.quantidadeParcelas, 10) || 0, 0),
    parcelasPagas: Math.max(parseInt(fields.parcelasPagas, 10) || 0, 0),
    valorParcela: Math.max(round2(fields.valorParcela), 0),
    proximoVencimento: fields.proximoVencimento || '',
    dataInicio: fields.dataInicio || '',
    previsaoFim: fields.previsaoFim || '',
    status: saldo <= 0 ? 'Quitada' : (STATUSES.includes(fields.status) ? fields.status : 'Ativa'),
    observacoes: fields.observacoes || '',
    createdAt: now,
    updatedAt: now,
  };
  data.debts.push(record);
  scheduleSave();
  return record;
}

function updateDebt(id, fields) {
  const debt = data.debts.find((d) => d.id === id);
  if (!debt) return null;
  Object.assign(debt, {
    credor: fields.credor,
    descricao: fields.descricao || '',
    valorOriginal: Math.max(round2(fields.valorOriginal), 0),
    saldoAtual: Math.max(round2(fields.saldoAtual), 0),
    taxaJuros: Math.max(round2(fields.taxaJuros), 0),
    quantidadeParcelas: Math.max(parseInt(fields.quantidadeParcelas, 10) || 0, 0),
    parcelasPagas: Math.max(parseInt(fields.parcelasPagas, 10) || 0, 0),
    valorParcela: Math.max(round2(fields.valorParcela), 0),
    proximoVencimento: fields.proximoVencimento || '',
    dataInicio: fields.dataInicio || '',
    previsaoFim: fields.previsaoFim || '',
    status: round2(fields.saldoAtual) <= 0 ? 'Quitada' : (STATUSES.includes(fields.status) ? fields.status : 'Ativa'),
    observacoes: fields.observacoes || '',
    updatedAt: new Date().toISOString(),
  });
  scheduleSave();
  return debt;
}

function deleteDebt(id) {
  const paymentIds = new Set(data.debtPayments.filter((p) => p.dividaId === id).map((p) => p.saidaId).filter(Boolean));
  // Saídas vinculadas NÃO são apagadas automaticamente: já representam fatos financeiros reais.
  data.debts = data.debts.filter((d) => d.id !== id);
  data.debtPayments = data.debtPayments.filter((p) => p.dividaId !== id);
  if (view.openDebtId === id) view.openDebtId = null;
  if (view.editingDebtId === id) view.editingDebtId = null;
  void paymentIds;
  scheduleSave();
}

function registerPayment(debtId, fields) {
  const debt = data.debts.find((d) => d.id === debtId);
  if (!debt) return null;
  const amount = Math.max(round2(fields.valor), 0);
  if (!(amount > 0)) return null;
  const now = new Date().toISOString();
  const actual = Math.min(amount, Math.max(Number(debt.saldoAtual) || 0, 0));
  let saidaId = null;

  if (fields.registrarSaida) {
    saidaId = Date.now();
    data.expenses.push({
      id: saidaId,
      date: fields.dataPagamento,
      category: 'Outros',
      desc: `Pagamento dívida — ${debt.credor}${debt.descricao ? ` (${debt.descricao})` : ''}`,
      value: actual,
      sourceType: 'debtPayment',
      sourceId: debtId,
    });
  }

  const record = {
    id: genId(),
    dividaId: debtId,
    valor: actual,
    dataPagamento: fields.dataPagamento,
    observacoes: fields.observacoes || '',
    contarParcela: !!fields.contarParcela,
    saidaId,
    createdAt: now,
    updatedAt: now,
  };
  data.debtPayments.push(record);
  debt.saldoAtual = round2(Math.max((Number(debt.saldoAtual) || 0) - actual, 0));
  if (fields.contarParcela) debt.parcelasPagas = Math.min((Number(debt.parcelasPagas) || 0) + 1, Number(debt.quantidadeParcelas) || Infinity);
  if (debt.saldoAtual <= 0) debt.status = 'Quitada';
  debt.updatedAt = now;
  scheduleSave();
  return record;
}

function deletePayment(paymentId) {
  const p = data.debtPayments.find((x) => x.id === paymentId);
  if (!p) return;
  const debt = data.debts.find((d) => d.id === p.dividaId);
  if (debt) {
    debt.saldoAtual = round2(Math.min((Number(debt.saldoAtual) || 0) + (Number(p.valor) || 0), Number(debt.valorOriginal) || Infinity));
    if (p.contarParcela) debt.parcelasPagas = Math.max((Number(debt.parcelasPagas) || 0) - 1, 0);
    if (debt.status === 'Quitada' && debt.saldoAtual > 0) debt.status = 'Ativa';
    debt.updatedAt = new Date().toISOString();
  }
  if (p.saidaId != null) data.expenses = data.expenses.filter((e) => e.id !== p.saidaId);
  data.debtPayments = data.debtPayments.filter((x) => x.id !== paymentId);
  scheduleSave();
}

function getFilteredDebts() {
  let list = [...data.debts];
  const filter = view.filterStatusDebts || 'todos';
  if (filter !== 'todos') list = list.filter((d) => effectiveStatus(d) === filter);
  const q = (view.searchDebts || '').trim().toLowerCase();
  if (q) list = list.filter((d) => `${d.credor} ${d.descricao}`.toLowerCase().includes(q));
  const field = view.sortFieldDebts || 'saldo';
  list.sort((a, b) => {
    let av, bv;
    if (field === 'vencimento') { av = a.proximoVencimento || '9999-99-99'; bv = b.proximoVencimento || '9999-99-99'; }
    else if (field === 'parcela') { av = Number(a.valorParcela) || 0; bv = Number(b.valorParcela) || 0; }
    else { av = Number(a.saldoAtual) || 0; bv = Number(b.saldoAtual) || 0; }
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    return view.sortDescDebts ? -cmp : cmp;
  });
  return list;
}

function summaryCards() {
  const s = getDebtsSummary();
  document.getElementById('debtSummaryGrid').innerHTML = `
    <div class="summary-card"><div class="lbl">DÍVIDAS ATIVAS</div><div class="val mono purple">${s.active}</div></div>
    <div class="summary-card"><div class="lbl">SALDO DEVEDOR</div><div class="val mono pink">${currency(s.remaining)}</div></div>
    <div class="summary-card"><div class="lbl">PARCELAS / MÊS</div><div class="val mono gold">${currency(s.monthly)}</div></div>
    <div class="summary-card"><div class="lbl">JÁ AMORTIZADO</div><div class="val mono green">${currency(s.paid)}</div></div>`;
}

function debtCard(debt) {
  const status = effectiveStatus(debt);
  const pct = progressPct(debt);
  const payments = paymentsForDebt(debt.id);
  const open = view.openDebtId === debt.id;
  const remainingInstallments = Math.max((Number(debt.quantidadeParcelas) || 0) - (Number(debt.parcelasPagas) || 0), 0);
  return `
  <div class="debt-item" data-id="${debt.id}">
    <div class="debt-head">
      <div>
        <div class="debt-title">${esc(debt.credor)} <span class="badge-status debt-status-${status.toLowerCase().replaceAll(' ', '-')}">${status}</span></div>
        <div class="debt-sub">${esc(debt.descricao || 'Sem descrição')} · próximo vencimento ${fmtDate(debt.proximoVencimento)}</div>
      </div>
      <div class="exp-actions">
        <button class="edit debt-edit" data-id="${debt.id}">✎</button>
        <button class="del debt-delete" data-id="${debt.id}">Excluir</button>
      </div>
    </div>
    <div class="debt-values">
      <div><span>Original</span><strong>${currency(debt.valorOriginal)}</strong></div>
      <div><span>Saldo atual</span><strong class="pink">${currency(debt.saldoAtual)}</strong></div>
      <div><span>Parcela</span><strong>${currency(debt.valorParcela)}</strong></div>
      <div><span>Parcelas</span><strong>${debt.parcelasPagas || 0}/${debt.quantidadeParcelas || 0}</strong></div>
      <div><span>Restantes</span><strong>${remainingInstallments}</strong></div>
      <div><span>Juros</span><strong>${Number(debt.taxaJuros || 0).toLocaleString('pt-BR')}%</strong></div>
    </div>
    <div class="debt-progress"><div style="width:${pct}%"></div></div>
    <div class="debt-progress-label"><span>${pct}% amortizado</span><span>${currency(Math.max((Number(debt.valorOriginal)||0)-(Number(debt.saldoAtual)||0),0))} pago</span></div>
    <div class="debt-actions-row">
      <button class="btn-primary small debt-pay" data-id="${debt.id}" ${status === 'Quitada' ? 'disabled' : ''}><span class="app-icon icon-wallet sm"></span>Registrar pagamento</button>
      <button class="btn-ghost small debt-toggle" data-id="${debt.id}">${open ? 'Ocultar histórico' : `Histórico (${payments.length})`}</button>
    </div>
    ${open ? renderDebtDetail(debt, payments) : ''}
  </div>`;
}

function renderDebtDetail(debt, payments) {
  const rows = payments.length ? payments.map((p) => `
    <div class="debt-payment-row">
      <div><strong>${fmtDate(p.dataPagamento)}</strong><span>${esc(p.observacoes || (p.contarParcela ? 'Parcela' : 'Amortização'))}</span></div>
      <div class="debt-payment-value">${currency(p.valor)} ${p.saidaId != null ? '<span class="movement-tag saida">Saída</span>' : ''}</div>
      <button class="del debt-payment-delete" data-id="${p.id}" title="Excluir pagamento">Excluir</button>
    </div>`).join('') : '<div class="exp-empty">Nenhum pagamento registrado.</div>';
  return `<div class="debt-detail"><div class="eyebrow">HISTÓRICO DE PAGAMENTOS</div>${rows}</div>`;
}

function renderDebtList() {
  const list = getFilteredDebts();
  const el = document.getElementById('debtList');
  if (!list.length) { el.innerHTML = '<div class="exp-empty">Nenhuma dívida encontrada.</div>'; return; }
  el.innerHTML = list.map(debtCard).join('');

  el.querySelectorAll('.debt-toggle').forEach((b) => b.onclick = () => {
    view.openDebtId = view.openDebtId === b.dataset.id ? null : b.dataset.id;
    renderDebts();
  });
  el.querySelectorAll('.debt-edit').forEach((b) => b.onclick = () => startEditDebt(b.dataset.id));
  el.querySelectorAll('.debt-delete').forEach((b) => b.onclick = async () => {
    if (!await showConfirm('Excluir esta dívida e o histórico de pagamentos? Saídas já geradas por pagamentos serão mantidas.')) return;
    deleteDebt(b.dataset.id); renderDebts();
  });
  el.querySelectorAll('.debt-pay').forEach((b) => b.onclick = () => openPaymentForm(b.dataset.id));
  el.querySelectorAll('.debt-payment-delete').forEach((b) => b.onclick = async () => {
    if (!await showConfirm('Excluir este pagamento? Se ele gerou uma Saída, a Saída vinculada também será removida.')) return;
    deletePayment(b.dataset.id); renderDebts();
  });
}

function readDebtForm() {
  return {
    credor: document.getElementById('debtCreditor').value.trim(),
    descricao: document.getElementById('debtDescription').value.trim(),
    valorOriginal: document.getElementById('debtOriginal').value,
    saldoAtual: document.getElementById('debtBalance').value,
    taxaJuros: document.getElementById('debtInterest').value,
    quantidadeParcelas: document.getElementById('debtInstallments').value,
    parcelasPagas: document.getElementById('debtPaidInstallments').value,
    valorParcela: document.getElementById('debtInstallmentValue').value,
    proximoVencimento: document.getElementById('debtDueDate').value,
    dataInicio: document.getElementById('debtStartDate').value,
    previsaoFim: document.getElementById('debtEndDate').value,
    status: document.getElementById('debtStatus').value,
    observacoes: document.getElementById('debtNotes').value.trim(),
  };
}

function resetDebtForm() {
  view.editingDebtId = null;
  ['debtCreditor','debtDescription','debtOriginal','debtBalance','debtInterest','debtInstallments','debtPaidInstallments','debtInstallmentValue','debtDueDate','debtStartDate','debtEndDate','debtNotes']
    .forEach((id) => document.getElementById(id).value = '');
  document.getElementById('debtStatus').value = 'Ativa';
  document.getElementById('addDebtBtn').textContent = '+ Adicionar dívida';
  document.getElementById('cancelDebtEditBtn').style.display = 'none';
}

function startEditDebt(id) {
  const d = data.debts.find((x) => x.id === id); if (!d) return;
  view.editingDebtId = id;
  document.getElementById('debtCreditor').value = d.credor || '';
  document.getElementById('debtDescription').value = d.descricao || '';
  document.getElementById('debtOriginal').value = d.valorOriginal || 0;
  document.getElementById('debtBalance').value = d.saldoAtual || 0;
  document.getElementById('debtInterest').value = d.taxaJuros || 0;
  document.getElementById('debtInstallments').value = d.quantidadeParcelas || 0;
  document.getElementById('debtPaidInstallments').value = d.parcelasPagas || 0;
  document.getElementById('debtInstallmentValue').value = d.valorParcela || 0;
  document.getElementById('debtDueDate').value = d.proximoVencimento || '';
  document.getElementById('debtStartDate').value = d.dataInicio || '';
  document.getElementById('debtEndDate').value = d.previsaoFim || '';
  document.getElementById('debtStatus').value = effectiveStatus(d);
  document.getElementById('debtNotes').value = d.observacoes || '';
  document.getElementById('addDebtBtn').textContent = '<span class="app-icon icon-circle-check sm"></span>Salvar alterações';
  document.getElementById('cancelDebtEditBtn').style.display = '';
  document.getElementById('debtCreditor').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openPaymentForm(debtId) {
  const debt = data.debts.find((d) => d.id === debtId); if (!debt) return;
  view.payingDebtId = debtId;
  const box = document.getElementById('debtPaymentBox');
  document.getElementById('debtPaymentTitle').textContent = `Pagamento — ${debt.credor}`;
  document.getElementById('debtPaymentValue').value = debt.valorParcela > 0 ? Math.min(debt.valorParcela, debt.saldoAtual) : '';
  document.getElementById('debtPaymentDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('debtPaymentNotes').value = '';
  document.getElementById('debtPaymentAsExpense').checked = false;
  document.getElementById('debtPaymentCountInstallment').checked = true;
  box.style.display = '';
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closePaymentForm() {
  view.payingDebtId = null;
  document.getElementById('debtPaymentBox').style.display = 'none';
}

export function renderDebts() {
  summaryCards();
  document.getElementById('debtFilterStatus').value = view.filterStatusDebts || 'todos';
  document.getElementById('debtSearch').value = view.searchDebts || '';
  document.getElementById('debtSortField').value = view.sortFieldDebts || 'saldo';
  document.getElementById('debtSortDirBtn').textContent = view.sortDescDebts ? '↓' : '↑';
  renderDebtList();
}

export function initDebts() {
  document.getElementById('addDebtBtn').onclick = async () => {
    const fields = readDebtForm();
    if (!fields.credor || !(Number(fields.valorOriginal) > 0)) {
      await showAlert('Preencha ao menos o credor e um valor original maior que zero.'); return;
    }
    if (fields.saldoAtual === '') fields.saldoAtual = fields.valorOriginal;
    if (view.editingDebtId) updateDebt(view.editingDebtId, fields); else createDebt(fields);
    resetDebtForm(); renderDebts();
  };
  document.getElementById('cancelDebtEditBtn').onclick = resetDebtForm;
  document.getElementById('debtFilterStatus').onchange = (e) => { view.filterStatusDebts = e.target.value; renderDebts(); };
  document.getElementById('debtSearch').oninput = (e) => { view.searchDebts = e.target.value; renderDebtList(); };
  document.getElementById('debtSortField').onchange = (e) => { view.sortFieldDebts = e.target.value; renderDebts(); };
  document.getElementById('debtSortDirBtn').onclick = () => { view.sortDescDebts = !view.sortDescDebts; renderDebts(); };
  document.getElementById('cancelDebtPaymentBtn').onclick = closePaymentForm;
  document.getElementById('saveDebtPaymentBtn').onclick = async () => {
    const debt = data.debts.find((d) => d.id === view.payingDebtId);
    if (!debt) return;
    const value = Number(document.getElementById('debtPaymentValue').value);
    const date = document.getElementById('debtPaymentDate').value;
    if (!(value > 0) || !date) { await showAlert('Informe uma data e um valor de pagamento maior que zero.'); return; }
    if (value > Number(debt.saldoAtual || 0)) {
      if (!await showConfirm(`O pagamento é maior que o saldo atual (${currency(debt.saldoAtual)}). Registrar apenas ${currency(debt.saldoAtual)} e quitar a dívida?`)) return;
    }
    registerPayment(debt.id, {
      valor: value,
      dataPagamento: date,
      observacoes: document.getElementById('debtPaymentNotes').value.trim(),
      registrarSaida: document.getElementById('debtPaymentAsExpense').checked,
      contarParcela: document.getElementById('debtPaymentCountInstallment').checked,
    });
    closePaymentForm(); renderDebts();
  };
  renderDebts();
}
