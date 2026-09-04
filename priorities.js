// Aba Prioridades (Fase 3) — gastos obrigatórios que devem ser separados ANTES
// de considerar o resto como dinheiro livre. Nesta fase a persistência é 100%
// local (mesmo padrão de Simulador/Saídas: muta `data.priorities` direto e usa
// scheduleSave()). Sincronização com Google Sheets fica pra quando a planilha
// Controle_Financeiro_3_0 existir — os campos mesReferencia/anoReferencia/id
// já estão prontos pra isso.
//
// Regra de negócio (documentada e usada em todo o módulo):
//   coberto   = valorReservado + valorPago
//   faltante  = max(valorPrevisto - coberto, 0)
//   status derivado automaticamente a partir dos três valores (nunca setado à mão)
//   pagamento: transfere de "reservado" pra "pago" (nunca soma nos dois ao
//   mesmo tempo) — reservado nunca fica negativo.

import { MONTH_NAMES, view, data, currency, genId, scheduleSave, prioritiesForMonth } from './state.js';
import { showAlert, showConfirm } from './ui-dialogs.js';

const CATEGORIES = [
  'Aluguel', 'Energia', 'Internet', 'Parcela do carro', 'Seguro',
  'Impostos', 'Compras importantes', 'Reserva específica', 'Outros compromissos',
];
const NIVEIS = ['Alta', 'Média', 'Baixa'];

const NIVEL_BADGE = { Alta: 'badge-nivel-alta', Média: 'badge-nivel-media', Baixa: 'badge-nivel-baixa' };
const STATUS_BADGE = {
  Pendente: 'badge-status-pendente',
  'Parcialmente reservado': 'badge-status-parcial',
  Reservado: 'badge-status-reservado',
  Pago: 'badge-status-pago',
};

// ---------------------------------------------------------------------------
// Funções puras de cálculo — sem DOM, fáceis de revisar/testar isoladamente.
// ---------------------------------------------------------------------------

export function computeStatus(valorPrevisto, valorReservado, valorPago) {
  const previsto = Number(valorPrevisto) || 0;
  const reservado = Number(valorReservado) || 0;
  const pago = Number(valorPago) || 0;
  const coberto = reservado + pago;
  if (previsto > 0 && pago >= previsto) return 'Pago';
  if (previsto > 0 && coberto >= previsto) return 'Reservado';
  if (coberto > 0) return 'Parcialmente reservado';
  return 'Pendente';
}

export function computeFaltante(valorPrevisto, valorReservado, valorPago) {
  const previsto = Number(valorPrevisto) || 0;
  const reservado = Number(valorReservado) || 0;
  const pago = Number(valorPago) || 0;
  return Math.max(previsto - (reservado + pago), 0);
}

export function buildSummary(list) {
  return list.reduce(
    (acc, p) => {
      const previsto = Number(p.valorPrevisto) || 0;
      const reservado = Number(p.valorReservado) || 0;
      const pago = Number(p.valorPago) || 0;
      acc.totalPrevisto += previsto;
      acc.totalReservado += reservado;
      acc.totalPago += pago;
      acc.totalFaltante += computeFaltante(previsto, reservado, pago);
      return acc;
    },
    { totalPrevisto: 0, totalReservado: 0, totalPago: 0, totalFaltante: 0 }
  );
}

// Soma do "ainda necessário" (faltante) — pronta pra quando o Dashboard for
// integrar "Livre de verdade" numa fase futura. Não usada em cálculo nenhum
// ainda nesta fase.
export function computeCommittedAmount(list) {
  return list.reduce((sum, p) => sum + computeFaltante(p.valorPrevisto, p.valorReservado, p.valorPago), 0);
}

// ---------------------------------------------------------------------------
// CRUD — muta data.priorities diretamente e agenda o save local (padrão do app).
// ---------------------------------------------------------------------------

function createPriority(fields) {
  const now = new Date().toISOString();
  const record = {
    id: genId(),
    nome: fields.nome,
    categoria: fields.categoria,
    valorPrevisto: Number(fields.valorPrevisto) || 0,
    valorReservado: 0,
    valorPago: 0,
    dataVencimento: fields.dataVencimento || '',
    nivelPrioridade: fields.nivelPrioridade,
    recorrente: !!fields.recorrente,
    observacoes: fields.observacoes || '',
    mesReferencia: view.monthPrioridades + 1, // 1-12, formato planilha-friendly
    anoReferencia: view.yearPrioridades,
    saidaId: null, // reservado pra ligação futura com Saídas (sem dupla contagem)
    createdAt: now,
    updatedAt: now,
  };
  data.priorities.push(record);
  scheduleSave();
  return record;
}

function updatePriority(id, fields) {
  const p = data.priorities.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, fields, { updatedAt: new Date().toISOString() });
  scheduleSave();
  return p;
}

function deletePriority(id) {
  data.priorities = data.priorities.filter((p) => p.id !== id);
  scheduleSave();
}

// delta pode ser positivo (reservar mais) ou negativo (reduzir reserva).
// Nunca deixa valorReservado negativo.
function adjustReserved(id, delta) {
  const p = data.priorities.find((x) => x.id === id);
  if (!p || !delta) return;
  p.valorReservado = Math.max((Number(p.valorReservado) || 0) + delta, 0);
  p.updatedAt = new Date().toISOString();
  scheduleSave();
}

// Transfere de reservado pra pago (até o limite do que estava reservado);
// se o pagamento for maior que o reservado, o excedente só soma em pago.
function registerPayment(id, amount) {
  const p = data.priorities.find((x) => x.id === id);
  if (!p || !(amount > 0)) return;
  const reservadoAtual = Number(p.valorReservado) || 0;
  const usadoDoReservado = Math.min(amount, reservadoAtual);
  p.valorReservado = Math.max(reservadoAtual - usadoDoReservado, 0);
  p.valorPago = (Number(p.valorPago) || 0) + amount;
  p.updatedAt = new Date().toISOString();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function shiftMonthPrioridades(delta) {
  view.monthPrioridades += delta;
  if (view.monthPrioridades < 0) { view.monthPrioridades = 11; view.yearPrioridades--; }
  if (view.monthPrioridades > 11) { view.monthPrioridades = 0; view.yearPrioridades++; }
  renderPriorities();
}

function getFilteredList() {
  let list = prioritiesForMonth(view.yearPrioridades, view.monthPrioridades);
  if (view.filterStatusPrioridades !== 'todos') {
    list = list.filter(
      (p) => computeStatus(p.valorPrevisto, p.valorReservado, p.valorPago) === view.filterStatusPrioridades
    );
  }
  if (view.filterNivelPrioridades !== 'todos') {
    list = list.filter((p) => p.nivelPrioridade === view.filterNivelPrioridades);
  }
  return [...list].sort((a, b) => {
    const da = a.dataVencimento || '9999-99-99';
    const db = b.dataVencimento || '9999-99-99';
    if (da === db) return 0;
    const cmp = da < db ? -1 : 1;
    return view.sortAscPrioridades ? cmp : -cmp;
  });
}

function fmtDate(iso) {
  if (!iso) return 'sem vencimento';
  return iso.split('-').reverse().join('/');
}

function progressPct(previsto, reservado, pago) {
  const p = Number(previsto) || 0;
  if (p <= 0) return 0;
  return Math.min(100, Math.round(((Number(reservado) || 0) + (Number(pago) || 0)) / p * 100));
}

function renderSummaryCards(monthList) {
  const s = buildSummary(monthList);
  document.getElementById('prioSummaryGrid').innerHTML = `
    <div class="summary-card">
      <div class="lbl">TOTAL PREVISTO</div>
      <div class="val mono cyan">${currency(s.totalPrevisto)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">JÁ RESERVADO</div>
      <div class="val mono gold">${currency(s.totalReservado)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">AINDA PRECISA RESERVAR</div>
      <div class="val mono pink">${currency(s.totalFaltante)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">PAGO</div>
      <div class="val mono green">${currency(s.totalPago)}</div>
    </div>`;
}

function priorityCard(p) {
  const status = computeStatus(p.valorPrevisto, p.valorReservado, p.valorPago);
  const faltante = computeFaltante(p.valorPrevisto, p.valorReservado, p.valorPago);
  const pct = progressPct(p.valorPrevisto, p.valorReservado, p.valorPago);

  return `
    <div class="priority-item" data-id="${p.id}">
      <div class="priority-item-head">
        <div class="priority-item-title">
          <strong>${p.nome}</strong>
          <span class="badge-nivel ${NIVEL_BADGE[p.nivelPrioridade] || ''}">${p.nivelPrioridade}</span>
          <span class="badge-status ${STATUS_BADGE[status] || ''}">${status}</span>
        </div>
        <div class="exp-actions">
          <button class="edit start-edit-prio" data-id="${p.id}">✎</button>
          <button class="del del-prio" data-id="${p.id}">Excluir</button>
        </div>
      </div>
      <div class="priority-item-meta">
        <span class="exp-cat-tag">${p.categoria}</span>
        <span class="mono">Vence ${fmtDate(p.dataVencimento)}</span>
        ${p.recorrente ? '<span class="mono">Recorrente</span>' : ''}
      </div>

      <div class="priority-progress-track">
        <div class="priority-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="priority-progress-label mono">
        ${currency(p.valorReservado + p.valorPago)} / ${currency(p.valorPrevisto)} (${pct}%)
      </div>

      <div class="priority-values-grid mono">
        <div><span class="lbl">Previsto</span><span class="val cyan">${currency(p.valorPrevisto)}</span></div>
        <div><span class="lbl">Reservado</span><span class="val gold">${currency(p.valorReservado)}</span></div>
        <div><span class="lbl">Pago</span><span class="val green">${currency(p.valorPago)}</span></div>
        <div><span class="lbl">Faltante</span><span class="val pink">${currency(faltante)}</span></div>
      </div>

      ${p.observacoes ? `<div class="priority-obs">${p.observacoes}</div>` : ''}

      <div class="priority-quick-actions">
        <div class="priority-quick-group">
          <input type="number" class="input-field mono" placeholder="Valor" data-role="reserveInput" />
          <button class="btn-ghost small do-reserve" data-id="${p.id}" data-dir="1">+ Reservar</button>
          <button class="btn-ghost small do-reserve" data-id="${p.id}" data-dir="-1">− Reduzir</button>
        </div>
        <div class="priority-quick-group">
          <input type="number" class="input-field mono" placeholder="Valor" data-role="payInput" />
          <button class="btn-ghost small do-pay" data-id="${p.id}"><span class="app-icon icon-coins sm"></span>Registrar pagamento</button>
        </div>
      </div>
    </div>`;
}

function priorityEditCard(p) {
  return `
    <div class="priority-item priority-item-editing" data-id="${p.id}">
      <div class="priority-form">
        <input class="input-field" type="text" value="${p.nome}" data-field="nome" placeholder="Nome" />
        <select class="input-field" data-field="categoria">
          ${CATEGORIES.map((c) => `<option ${c === p.categoria ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <select class="input-field" data-field="nivelPrioridade">
          ${NIVEIS.map((n) => `<option value="${n}" ${n === p.nivelPrioridade ? 'selected' : ''}>${n} prioridade</option>`).join('')}
        </select>
        <input class="input-field mono" type="number" value="${p.valorPrevisto}" data-field="valorPrevisto" placeholder="Valor previsto" />
        <input class="input-field mono" type="date" value="${p.dataVencimento || ''}" data-field="dataVencimento" />
        <label class="checkbox-row" style="margin-top:0;">
          <input type="checkbox" data-field="recorrente" ${p.recorrente ? 'checked' : ''} /> Recorrente
        </label>
        <input class="input-field" type="text" value="${p.observacoes || ''}" data-field="observacoes" placeholder="Observações" />
        <div class="exp-actions">
          <button class="btn-primary small save-prio" data-id="${p.id}"><span class="app-icon icon-circle-check sm"></span>Salvar</button>
          <button class="btn-ghost small cancel-prio">Cancelar</button>
        </div>
      </div>
    </div>`;
}

export function renderPriorities() {
  document.getElementById('monthLabelPrioridades').textContent =
    `${MONTH_NAMES[view.monthPrioridades]} ${view.yearPrioridades}`;

  const monthList = prioritiesForMonth(view.yearPrioridades, view.monthPrioridades);
  renderSummaryCards(monthList);

  const list = getFilteredList();
  const container = document.getElementById('priorityList');

  if (list.length === 0) {
    container.innerHTML = '<div class="exp-empty">Nenhuma prioridade cadastrada neste mês (com esses filtros).</div>';
    return;
  }

  container.innerHTML = list
    .map((p) => (view.editingPriorityId === p.id ? priorityEditCard(p) : priorityCard(p)))
    .join('');

  container.querySelectorAll('.start-edit-prio').forEach((b) => b.onclick = () => {
    view.editingPriorityId = b.dataset.id;
    renderPriorities();
  });
  container.querySelectorAll('.cancel-prio').forEach((b) => b.onclick = () => {
    view.editingPriorityId = null;
    renderPriorities();
  });
  container.querySelectorAll('.del-prio').forEach((b) => b.onclick = async () => {
    if (!(await showConfirm('Excluir esta prioridade?'))) return;
    deletePriority(b.dataset.id);
    renderPriorities();
  });
  container.querySelectorAll('.save-prio').forEach((b) => b.onclick = () => {
    const id = b.dataset.id;
    const card = container.querySelector(`.priority-item[data-id="${id}"]`);
    updatePriority(id, {
      nome: card.querySelector('[data-field="nome"]').value.trim(),
      categoria: card.querySelector('[data-field="categoria"]').value,
      nivelPrioridade: card.querySelector('[data-field="nivelPrioridade"]').value,
      valorPrevisto: Number(card.querySelector('[data-field="valorPrevisto"]').value) || 0,
      dataVencimento: card.querySelector('[data-field="dataVencimento"]').value,
      recorrente: card.querySelector('[data-field="recorrente"]').checked,
      observacoes: card.querySelector('[data-field="observacoes"]').value.trim(),
    });
    view.editingPriorityId = null;
    renderPriorities();
  });
  container.querySelectorAll('.do-reserve').forEach((b) => b.onclick = async () => {
    const card = container.querySelector(`.priority-item[data-id="${b.dataset.id}"]`);
    const input = card.querySelector('[data-role="reserveInput"]');
    const amount = Number(input.value);
    if (!amount) { await showAlert('Informe um valor para reservar/reduzir.'); return; }
    adjustReserved(b.dataset.id, amount * Number(b.dataset.dir));
    renderPriorities();
  });
  container.querySelectorAll('.do-pay').forEach((b) => b.onclick = async () => {
    const card = container.querySelector(`.priority-item[data-id="${b.dataset.id}"]`);
    const input = card.querySelector('[data-role="payInput"]');
    const amount = Number(input.value);
    if (!(amount > 0)) { await showAlert('Informe um valor de pagamento maior que zero.'); return; }
    registerPayment(b.dataset.id, amount);
    renderPriorities();
  });
}

export function initPriorities() {
  document.getElementById('prevMonthPrioridades').onclick = () => shiftMonthPrioridades(-1);
  document.getElementById('nextMonthPrioridades').onclick = () => shiftMonthPrioridades(1);

  document.getElementById('prioFilterStatus').onchange = (e) => {
    view.filterStatusPrioridades = e.target.value;
    renderPriorities();
  };
  document.getElementById('prioFilterNivel').onchange = (e) => {
    view.filterNivelPrioridades = e.target.value;
    renderPriorities();
  };
  document.getElementById('prioSortBtn').onclick = () => {
    view.sortAscPrioridades = !view.sortAscPrioridades;
    document.getElementById('prioSortBtn').textContent = `Vencimento ${view.sortAscPrioridades ? '↑' : '↓'}`;
    renderPriorities();
  };

  document.getElementById('addPriorityBtn').onclick = async () => {
    const nome = document.getElementById('prioNome').value.trim();
    const valorPrevisto = Number(document.getElementById('prioValor').value);
    if (!nome || !valorPrevisto) {
      await showAlert('Preencha ao menos o nome e o valor previsto.');
      return;
    }

    createPriority({
      nome,
      categoria: document.getElementById('prioCategoria').value,
      nivelPrioridade: document.getElementById('prioNivel').value,
      valorPrevisto,
      dataVencimento: document.getElementById('prioVencimento').value,
      recorrente: document.getElementById('prioRecorrente').checked,
      observacoes: document.getElementById('prioObs').value.trim(),
    });

    document.getElementById('prioNome').value = '';
    document.getElementById('prioValor').value = '';
    document.getElementById('prioVencimento').value = '';
    document.getElementById('prioRecorrente').checked = false;
    document.getElementById('prioObs').value = '';
    renderPriorities();
  };
}
