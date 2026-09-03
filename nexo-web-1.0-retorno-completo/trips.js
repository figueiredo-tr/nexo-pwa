// Aba Viagens (Fase 5) — cada viagem funciona como um projeto financeiro
// independente, com orçamento, reserva, itens planejados e pagamentos.
// Persistência 100% local nesta fase: data.trips / data.tripItems + scheduleSave().
// Sem integração automática com Dashboard, Saídas, Prioridades ou Google Sheets.
//
// Regra central:
//   totalPlanejadoItens = soma(valorPrevisto dos itens)
//   totalPagoItens      = soma(valorPago dos itens)
//   coberto             = valorReservado + totalPagoItens
//   faltante            = max(orcamentoTotal - coberto, 0)
//
// Quando um pagamento usa a reserva, o valor é TRANSFERIDO de valorReservado
// para valorPago do item. Assim, o total coberto não é contado duas vezes.

import { view, data, genId, scheduleSave } from './state.js';
import { showAlert, showConfirm } from './ui-dialogs.js';

const TRIP_STATUSES = ['Planejada', 'Em andamento', 'Concluída', 'Cancelada'];
const ITEM_CATEGORIES = [
  'Passagens', 'Hospedagem', 'Alimentação', 'Transporte', 'Passeios',
  'Seguro viagem', 'Compras', 'Documentação', 'Reserva emergencial', 'Outros',
];

const STATUS_BADGE = {
  Planejada: 'badge-status-reservado',
  'Em andamento': 'badge-status-parcial',
  Concluída: 'badge-status-pago',
  Cancelada: 'badge-status-pendente',
};

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function money2(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '-R$ ' : 'R$ ') + Math.abs(n).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.split('-').reverse().join('/');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function itemsForTrip(tripId) {
  return data.tripItems.filter((item) => item.viagemId === tripId);
}

export function computeTripItemStatus(valorPrevisto, valorPago) {
  const previsto = round2(valorPrevisto);
  const pago = round2(valorPago);
  if (previsto > 0 && pago >= previsto) return 'Pago';
  if (pago > 0) return 'Parcialmente pago';
  return 'Pendente';
}

export function getTripSummary(tripOrId) {
  const trip = typeof tripOrId === 'string'
    ? data.trips.find((t) => t.id === tripOrId)
    : tripOrId;
  if (!trip) {
    return {
      budget: 0, plannedItems: 0, reserved: 0, paid: 0, covered: 0,
      remaining: 0, unallocated: 0, overBudget: 0, progress: 0,
    };
  }

  const items = itemsForTrip(trip.id);
  const budget = round2(trip.orcamentoTotal);
  const reserved = round2(Math.max(Number(trip.valorReservado) || 0, 0));
  const plannedItems = round2(items.reduce((sum, item) => sum + (Number(item.valorPrevisto) || 0), 0));
  const paid = round2(items.reduce((sum, item) => sum + (Number(item.valorPago) || 0), 0));
  const covered = round2(reserved + paid);
  const remaining = round2(Math.max(budget - covered, 0));
  const unallocated = round2(Math.max(budget - plannedItems, 0));
  const overBudget = round2(Math.max(plannedItems - budget, 0));
  const progress = budget > 0 ? round2((covered / budget) * 100) : 0;

  return { budget, plannedItems, reserved, paid, covered, remaining, unallocated, overBudget, progress };
}

export function getTripsSummary(list = data.trips) {
  const included = list.filter((trip) => trip.status !== 'Cancelada');
  const activeTrips = included.filter((trip) => trip.status === 'Planejada' || trip.status === 'Em andamento').length;
  const result = included.reduce((acc, trip) => {
    const s = getTripSummary(trip);
    acc.totalBudget += s.budget;
    acc.totalReserved += s.reserved;
    acc.totalPaid += s.paid;
    acc.totalCovered += s.covered;
    acc.totalRemaining += s.remaining;
    return acc;
  }, {
    totalTrips: list.length,
    activeTrips,
    totalBudget: 0,
    totalReserved: 0,
    totalPaid: 0,
    totalCovered: 0,
    totalRemaining: 0,
  });

  Object.keys(result).forEach((key) => {
    if (key.startsWith('total') && key !== 'totalTrips') result[key] = round2(result[key]);
  });
  return result;
}

function createTrip(fields) {
  const now = new Date().toISOString();
  const record = {
    id: genId(),
    nome: fields.nome,
    destino: fields.destino || '',
    dataIda: fields.dataIda || '',
    dataVolta: fields.dataVolta || '',
    orcamentoTotal: round2(fields.orcamentoTotal),
    valorReservado: 0,
    status: TRIP_STATUSES.includes(fields.status) ? fields.status : 'Planejada',
    observacoes: fields.observacoes || '',
    ativo: fields.status !== 'Cancelada' && fields.status !== 'Concluída',
    createdAt: now,
    updatedAt: now,
  };
  data.trips.push(record);
  scheduleSave();
  return record;
}

function updateTrip(id, fields) {
  const trip = data.trips.find((t) => t.id === id);
  if (!trip) return null;
  Object.assign(trip, {
    ...fields,
    orcamentoTotal: round2(fields.orcamentoTotal),
    ativo: fields.status !== 'Cancelada' && fields.status !== 'Concluída',
    updatedAt: new Date().toISOString(),
  });
  scheduleSave();
  return trip;
}

function deleteTrip(id) {
  data.trips = data.trips.filter((trip) => trip.id !== id);
  data.tripItems = data.tripItems.filter((item) => item.viagemId !== id);
  if (view.openTripId === id) view.openTripId = null;
  if (view.editingTripId === id) view.editingTripId = null;
  scheduleSave();
}

function adjustTripReserve(id, delta) {
  const trip = data.trips.find((t) => t.id === id);
  if (!trip) return false;
  const current = round2(trip.valorReservado);
  const next = round2(current + Number(delta || 0));
  if (next < 0) return false;
  trip.valorReservado = next;
  trip.updatedAt = new Date().toISOString();
  scheduleSave();
  return true;
}

function createTripItem(tripId, fields) {
  const trip = data.trips.find((t) => t.id === tripId);
  if (!trip) return null;
  const now = new Date().toISOString();
  const initialPaid = round2(fields.valorPago);
  const useReserve = !!fields.usarReserva;
  if (initialPaid < 0) return null;
  if (useReserve && initialPaid > round2(trip.valorReservado)) return null;

  if (useReserve && initialPaid > 0) {
    trip.valorReservado = round2(trip.valorReservado - initialPaid);
    trip.updatedAt = now;
  }

  const record = {
    id: genId(),
    viagemId: tripId,
    categoria: ITEM_CATEGORIES.includes(fields.categoria) ? fields.categoria : 'Outros',
    descricao: fields.descricao || '',
    valorPrevisto: round2(fields.valorPrevisto),
    valorPago: initialPaid,
    dataPagamento: initialPaid > 0 ? (fields.dataPagamento || '') : '',
    status: computeTripItemStatus(fields.valorPrevisto, initialPaid),
    observacoes: fields.observacoes || '',
    saidaId: null,
    createdAt: now,
    updatedAt: now,
  };
  data.tripItems.push(record);
  scheduleSave();
  return record;
}

function updateTripItem(id, fields) {
  const item = data.tripItems.find((x) => x.id === id);
  if (!item) return null;
  item.categoria = ITEM_CATEGORIES.includes(fields.categoria) ? fields.categoria : 'Outros';
  item.descricao = fields.descricao || '';
  item.valorPrevisto = round2(fields.valorPrevisto);
  item.observacoes = fields.observacoes || '';
  item.status = computeTripItemStatus(item.valorPrevisto, item.valorPago);
  item.updatedAt = new Date().toISOString();
  scheduleSave();
  return item;
}

function deleteTripItem(id) {
  data.tripItems = data.tripItems.filter((item) => item.id !== id);
  if (view.editingTripItemId === id) view.editingTripItemId = null;
  scheduleSave();
}

function registerTripItemPayment(itemId, amount, useReserve, paymentDate) {
  const item = data.tripItems.find((x) => x.id === itemId);
  if (!item) return { ok: false, reason: 'not-found' };
  const trip = data.trips.find((t) => t.id === item.viagemId);
  if (!trip) return { ok: false, reason: 'trip-not-found' };

  const value = round2(amount);
  if (!(value > 0)) return { ok: false, reason: 'invalid' };
  if (useReserve && value > round2(trip.valorReservado)) {
    return { ok: false, reason: 'insufficient-reserve', available: round2(trip.valorReservado) };
  }

  if (useReserve) {
    trip.valorReservado = round2(trip.valorReservado - value);
    trip.updatedAt = new Date().toISOString();
  }

  item.valorPago = round2((Number(item.valorPago) || 0) + value);
  item.dataPagamento = paymentDate || item.dataPagamento || '';
  item.status = computeTripItemStatus(item.valorPrevisto, item.valorPago);
  item.updatedAt = new Date().toISOString();
  scheduleSave();
  return { ok: true };
}

function getFilteredTrips() {
  let list = [...data.trips];
  if (view.filterStatusTrips !== 'todos') {
    list = list.filter((trip) => trip.status === view.filterStatusTrips);
  }
  const q = view.searchTrips.trim().toLowerCase();
  if (q) {
    list = list.filter((trip) =>
      (trip.nome || '').toLowerCase().includes(q) ||
      (trip.destino || '').toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => {
    let va;
    let vb;
    if (view.sortFieldTrips === 'orcamento') {
      va = Number(a.orcamentoTotal) || 0;
      vb = Number(b.orcamentoTotal) || 0;
    } else if (view.sortFieldTrips === 'faltante') {
      va = getTripSummary(a).remaining;
      vb = getTripSummary(b).remaining;
    } else {
      va = a.dataIda || '9999-99-99';
      vb = b.dataIda || '9999-99-99';
    }
    if (va === vb) return 0;
    const cmp = va < vb ? -1 : 1;
    return view.sortDescTrips ? -cmp : cmp;
  });
  return list;
}

function renderSummaryCards() {
  const s = getTripsSummary();
  document.getElementById('tripSummaryGrid').innerHTML = `
    <div class="summary-card"><div class="lbl">VIAGENS ATIVAS</div><div class="val mono cyan">${s.activeTrips}</div></div>
    <div class="summary-card"><div class="lbl">ORÇAMENTO TOTAL</div><div class="val mono cyan">${money2(s.totalBudget)}</div></div>
    <div class="summary-card"><div class="lbl">TOTAL RESERVADO</div><div class="val mono gold">${money2(s.totalReserved)}</div></div>
    <div class="summary-card"><div class="lbl">TOTAL PAGO</div><div class="val mono green">${money2(s.totalPaid)}</div></div>
    <div class="summary-card"><div class="lbl">TOTAL COBERTO</div><div class="val mono purple">${money2(s.totalCovered)}</div></div>
    <div class="summary-card"><div class="lbl">AINDA FALTA</div><div class="val mono pink">${money2(s.totalRemaining)}</div></div>`;
}

function tripEditCard(trip) {
  return `
    <div class="trip-card trip-editing" data-trip-id="${trip.id}">
      <div class="eyebrow">EDITAR VIAGEM</div>
      <div class="trip-form" data-trip-edit-form>
        <input class="input-field" data-field="nome" value="${escapeHtml(trip.nome)}" placeholder="Nome da viagem" />
        <input class="input-field" data-field="destino" value="${escapeHtml(trip.destino)}" placeholder="Destino" />
        <input class="input-field mono" type="date" data-field="dataIda" value="${trip.dataIda || ''}" />
        <input class="input-field mono" type="date" data-field="dataVolta" value="${trip.dataVolta || ''}" />
        <input class="input-field mono" type="number" min="0" step="0.01" data-field="orcamentoTotal" value="${trip.orcamentoTotal}" placeholder="Orçamento total" />
        <select class="input-field" data-field="status">${TRIP_STATUSES.map((s) => `<option ${s === trip.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input class="input-field" data-field="observacoes" value="${escapeHtml(trip.observacoes)}" placeholder="Observações" />
        <button class="btn-primary small save-trip" data-id="${trip.id}"><span class="app-icon icon-circle-check sm"></span>Salvar</button>
        <button class="btn-ghost small cancel-trip-edit">Cancelar</button>
      </div>
    </div>`;
}

function tripItemEditRow(item) {
  return `
    <div class="trip-item trip-item-editing" data-item-id="${item.id}">
      <div class="trip-item-edit-form" data-item-edit-form>
        <select class="input-field" data-field="categoria">${ITEM_CATEGORIES.map((c) => `<option ${c === item.categoria ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <input class="input-field" data-field="descricao" value="${escapeHtml(item.descricao)}" placeholder="Descrição" />
        <input class="input-field mono" type="number" min="0" step="0.01" data-field="valorPrevisto" value="${item.valorPrevisto}" placeholder="Previsto" />
        <input class="input-field" data-field="observacoes" value="${escapeHtml(item.observacoes)}" placeholder="Observações" />
        <button class="btn-primary small save-trip-item" data-id="${item.id}"><span class="app-icon icon-circle-check sm"></span></button>
        <button class="btn-ghost small cancel-trip-item-edit">Cancelar</button>
      </div>
      <div class="trip-item-edit-note">Pagamentos não são alterados aqui; use “Registrar pagamento” para preservar a regra da reserva.</div>
    </div>`;
}

function tripItemRow(item, trip) {
  const status = computeTripItemStatus(item.valorPrevisto, item.valorPago);
  const remaining = round2(Math.max((Number(item.valorPrevisto) || 0) - (Number(item.valorPago) || 0), 0));
  return `
    <div class="trip-item" data-item-id="${item.id}">
      <div class="trip-item-head">
        <div>
          <strong>${escapeHtml(item.descricao || item.categoria)}</strong>
          <div class="trip-item-meta">
            <span class="exp-cat-tag">${escapeHtml(item.categoria)}</span>
            <span class="badge-status ${status === 'Pago' ? 'badge-status-pago' : status === 'Parcialmente pago' ? 'badge-status-parcial' : 'badge-status-pendente'}">${status}</span>
            ${item.dataPagamento ? `<span class="mono">últ. pag. ${fmtDate(item.dataPagamento)}</span>` : ''}
          </div>
        </div>
        <div class="exp-actions">
          <button class="edit start-edit-trip-item" data-id="${item.id}">✎</button>
          <button class="del del-trip-item" data-id="${item.id}">Excluir</button>
        </div>
      </div>
      <div class="trip-item-values mono">
        <div><span class="lbl">Previsto</span><span class="val cyan">${money2(item.valorPrevisto)}</span></div>
        <div><span class="lbl">Pago</span><span class="val green">${money2(item.valorPago)}</span></div>
        <div><span class="lbl">Falta no item</span><span class="val pink">${money2(remaining)}</span></div>
      </div>
      ${item.observacoes ? `<div class="priority-obs">${escapeHtml(item.observacoes)}</div>` : ''}
      <div class="trip-payment-form">
        <input class="input-field mono" type="number" min="0" step="0.01" data-role="paymentValue" placeholder="Pagamento (R$)" />
        <input class="input-field mono" type="date" data-role="paymentDate" />
        <label class="checkbox-row trip-inline-check"><input type="checkbox" data-role="paymentUseReserve" /> Usar valor reservado</label>
        <button class="btn-ghost small register-trip-payment" data-id="${item.id}">Registrar pagamento</button>
        <span class="trip-reserve-hint">Reserva disponível: <strong class="mono gold">${money2(trip.valorReservado)}</strong></span>
      </div>
    </div>`;
}

function tripDetails(trip) {
  const s = getTripSummary(trip);
  const items = itemsForTrip(trip.id);
  const budgetNote = s.overBudget > 0
    ? `<span class="pink">Acima do orçamento: ${money2(s.overBudget)}</span>`
    : `<span class="gold">Ainda sem destinação: ${money2(s.unallocated)}</span>`;

  return `
    <div class="trip-details">
      <div class="trip-detail-summary mono">
        <div><span class="lbl">Orçamento</span><strong>${money2(s.budget)}</strong></div>
        <div><span class="lbl">Planejado nos itens</span><strong>${money2(s.plannedItems)}</strong></div>
        <div><span class="lbl">Reservado</span><strong class="gold">${money2(s.reserved)}</strong></div>
        <div><span class="lbl">Pago</span><strong class="green">${money2(s.paid)}</strong></div>
        <div><span class="lbl">Coberto</span><strong class="purple">${money2(s.covered)}</strong></div>
        <div><span class="lbl">Falta</span><strong class="pink">${money2(s.remaining)}</strong></div>
      </div>
      <div class="trip-budget-note mono">${budgetNote}</div>

      <div class="trip-reserve-actions">
        <input class="input-field mono" type="number" min="0" step="0.01" data-role="reserveValue" placeholder="Valor da reserva" />
        <button class="btn-ghost small adjust-trip-reserve" data-id="${trip.id}" data-dir="1">+ Adicionar à reserva</button>
        <button class="btn-ghost small adjust-trip-reserve" data-id="${trip.id}" data-dir="-1">− Retirar da reserva</button>
      </div>

      <div class="trip-items-section">
        <div class="eyebrow">NOVO ITEM DA VIAGEM</div>
        <div class="trip-item-form" data-new-item-form data-trip-id="${trip.id}">
          <select class="input-field" data-field="categoria">${ITEM_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
          <input class="input-field" data-field="descricao" placeholder="Descrição (ex: Hotel X)" />
          <input class="input-field mono" type="number" min="0" step="0.01" data-field="valorPrevisto" placeholder="Valor previsto" />
          <input class="input-field mono" type="number" min="0" step="0.01" data-field="valorPago" placeholder="Pago inicial (opcional)" />
          <input class="input-field mono" type="date" data-field="dataPagamento" />
          <input class="input-field" data-field="observacoes" placeholder="Observações" />
          <label class="checkbox-row trip-inline-check"><input type="checkbox" data-field="usarReserva" /> Usar reserva no pago inicial</label>
          <button class="btn-primary small add-trip-item" data-id="${trip.id}">+ Item</button>
        </div>

        <div class="eyebrow trip-items-title">ITENS</div>
        <div class="trip-items-list">
          ${items.length === 0
            ? '<div class="exp-empty">Nenhum item planejado para esta viagem.</div>'
            : items.map((item) => view.editingTripItemId === item.id ? tripItemEditRow(item) : tripItemRow(item, trip)).join('')}
        </div>
      </div>

      ${trip.observacoes ? `<div class="trip-notes"><span class="eyebrow">OBSERVAÇÕES</span><p>${escapeHtml(trip.observacoes)}</p></div>` : ''}
    </div>`;
}

function tripCard(trip) {
  const s = getTripSummary(trip);
  const pctText = s.progress.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pctBar = Math.max(0, Math.min(100, s.progress));
  const isOpen = view.openTripId === trip.id;

  return `
    <div class="trip-card ${trip.status === 'Cancelada' ? 'trip-cancelled' : ''}" data-trip-id="${trip.id}">
      <div class="trip-card-head">
        <div>
          <div class="trip-title-row">
            <strong>${escapeHtml(trip.nome)}</strong>
            <span class="badge-status ${STATUS_BADGE[trip.status] || ''}">${trip.status}</span>
          </div>
          <div class="trip-meta">
            ${trip.destino ? `<span>${escapeHtml(trip.destino)}</span>` : ''}
            <span class="mono">${fmtDate(trip.dataIda)} → ${fmtDate(trip.dataVolta)}</span>
          </div>
        </div>
        <div class="exp-actions">
          <button class="edit start-edit-trip" data-id="${trip.id}">✎</button>
          <button class="del del-trip" data-id="${trip.id}">Excluir</button>
        </div>
      </div>

      <div class="trip-values-grid mono">
        <div><span class="lbl">Orçamento</span><span class="val cyan">${money2(s.budget)}</span></div>
        <div><span class="lbl">Reservado</span><span class="val gold">${money2(s.reserved)}</span></div>
        <div><span class="lbl">Pago</span><span class="val green">${money2(s.paid)}</span></div>
        <div><span class="lbl">Falta</span><span class="val pink">${money2(s.remaining)}</span></div>
      </div>

      <div class="priority-progress-track"><div class="priority-progress-fill" style="width:${pctBar}%"></div></div>
      <div class="priority-progress-label mono">${pctText}% coberto · ${money2(s.covered)} de ${money2(s.budget)}</div>

      <div class="trip-card-actions">
        <button class="btn-ghost small toggle-trip-details" data-id="${trip.id}">${isOpen ? '▲ Fechar detalhes' : '▼ Abrir detalhes'}</button>
      </div>

      ${isOpen ? tripDetails(trip) : ''}
    </div>`;
}

export function renderTrips() {
  renderSummaryCards();
  const list = getFilteredTrips();
  const container = document.getElementById('tripList');
  if (!list.length) {
    container.innerHTML = '<div class="exp-empty">Nenhuma viagem encontrada com esses filtros.</div>';
    return;
  }
  container.innerHTML = list.map((trip) => view.editingTripId === trip.id ? tripEditCard(trip) : tripCard(trip)).join('');
  wireTripEvents(container);
}

function wireTripEvents(container) {
  container.querySelectorAll('.toggle-trip-details').forEach((btn) => btn.onclick = () => {
    view.openTripId = view.openTripId === btn.dataset.id ? null : btn.dataset.id;
    view.editingTripItemId = null;
    renderTrips();
  });

  container.querySelectorAll('.start-edit-trip').forEach((btn) => btn.onclick = () => {
    view.editingTripId = btn.dataset.id;
    renderTrips();
  });
  container.querySelectorAll('.cancel-trip-edit').forEach((btn) => btn.onclick = () => {
    view.editingTripId = null;
    renderTrips();
  });
  container.querySelectorAll('.save-trip').forEach((btn) => btn.onclick = async () => {
    const form = container.querySelector(`.trip-card[data-trip-id="${btn.dataset.id}"] [data-trip-edit-form]`);
    const nome = form.querySelector('[data-field="nome"]').value.trim();
    const dataIda = form.querySelector('[data-field="dataIda"]').value;
    const dataVolta = form.querySelector('[data-field="dataVolta"]').value;
    const budget = Number(form.querySelector('[data-field="orcamentoTotal"]').value);
    if (!nome) return showAlert('Informe o nome da viagem.');
    if (budget < 0) return showAlert('O orçamento não pode ser negativo.');
    if (dataIda && dataVolta && dataVolta < dataIda) return showAlert('A data de volta não pode ser anterior à data de ida.');
    updateTrip(btn.dataset.id, {
      nome,
      destino: form.querySelector('[data-field="destino"]').value.trim(),
      dataIda,
      dataVolta,
      orcamentoTotal: budget,
      status: form.querySelector('[data-field="status"]').value,
      observacoes: form.querySelector('[data-field="observacoes"]').value.trim(),
    });
    view.editingTripId = null;
    renderTrips();
  });

  container.querySelectorAll('.del-trip').forEach((btn) => btn.onclick = async () => {
    const hasItems = data.tripItems.some((item) => item.viagemId === btn.dataset.id);
    const msg = hasItems
      ? 'Excluir esta viagem também vai apagar todos os itens ligados a ela. Continuar?'
      : 'Excluir esta viagem?';
    if (!(await showConfirm(msg))) return;
    deleteTrip(btn.dataset.id);
    renderTrips();
  });

  container.querySelectorAll('.adjust-trip-reserve').forEach((btn) => btn.onclick = async () => {
    const card = container.querySelector(`.trip-card[data-trip-id="${btn.dataset.id}"]`);
    const input = card.querySelector('[data-role="reserveValue"]');
    const value = round2(input.value);
    if (!(value > 0)) return showAlert('Informe um valor de reserva maior que zero.');
    const ok = adjustTripReserve(btn.dataset.id, value * Number(btn.dataset.dir));
    if (!ok) return showAlert('Não é possível retirar mais do que o valor atualmente reservado.');
    renderTrips();
  });

  container.querySelectorAll('.add-trip-item').forEach((btn) => btn.onclick = async () => {
    const form = container.querySelector(`[data-new-item-form][data-trip-id="${btn.dataset.id}"]`);
    const valorPrevisto = Number(form.querySelector('[data-field="valorPrevisto"]').value);
    const valorPago = Number(form.querySelector('[data-field="valorPago"]').value || 0);
    const descricao = form.querySelector('[data-field="descricao"]').value.trim();
    const usarReserva = form.querySelector('[data-field="usarReserva"]').checked;
    const trip = data.trips.find((t) => t.id === btn.dataset.id);
    if (!(valorPrevisto >= 0)) return showAlert('Informe um valor previsto válido.');
    if (valorPago < 0) return showAlert('O valor pago não pode ser negativo.');
    if (!descricao) return showAlert('Informe uma descrição para o item.');
    if (usarReserva && valorPago > round2(trip.valorReservado)) {
      return showAlert(`Saldo reservado insuficiente. Disponível: ${money2(trip.valorReservado)}.`);
    }
    createTripItem(btn.dataset.id, {
      categoria: form.querySelector('[data-field="categoria"]').value,
      descricao,
      valorPrevisto,
      valorPago,
      dataPagamento: form.querySelector('[data-field="dataPagamento"]').value,
      observacoes: form.querySelector('[data-field="observacoes"]').value.trim(),
      usarReserva,
    });
    renderTrips();
  });

  container.querySelectorAll('.start-edit-trip-item').forEach((btn) => btn.onclick = () => {
    view.editingTripItemId = btn.dataset.id;
    renderTrips();
  });
  container.querySelectorAll('.cancel-trip-item-edit').forEach((btn) => btn.onclick = () => {
    view.editingTripItemId = null;
    renderTrips();
  });
  container.querySelectorAll('.save-trip-item').forEach((btn) => btn.onclick = async () => {
    const itemEl = container.querySelector(`.trip-item[data-item-id="${btn.dataset.id}"]`);
    const form = itemEl.querySelector('[data-item-edit-form]');
    const valorPrevisto = Number(form.querySelector('[data-field="valorPrevisto"]').value);
    const descricao = form.querySelector('[data-field="descricao"]').value.trim();
    if (!(valorPrevisto >= 0)) return showAlert('Informe um valor previsto válido.');
    if (!descricao) return showAlert('Informe uma descrição para o item.');
    updateTripItem(btn.dataset.id, {
      categoria: form.querySelector('[data-field="categoria"]').value,
      descricao,
      valorPrevisto,
      observacoes: form.querySelector('[data-field="observacoes"]').value.trim(),
    });
    view.editingTripItemId = null;
    renderTrips();
  });

  container.querySelectorAll('.del-trip-item').forEach((btn) => btn.onclick = async () => {
    if (!(await showConfirm('Excluir este item da viagem?'))) return;
    deleteTripItem(btn.dataset.id);
    renderTrips();
  });

  container.querySelectorAll('.register-trip-payment').forEach((btn) => btn.onclick = async () => {
    const itemEl = container.querySelector(`.trip-item[data-item-id="${btn.dataset.id}"]`);
    const value = Number(itemEl.querySelector('[data-role="paymentValue"]').value);
    const useReserve = itemEl.querySelector('[data-role="paymentUseReserve"]').checked;
    const date = itemEl.querySelector('[data-role="paymentDate"]').value;
    const result = registerTripItemPayment(btn.dataset.id, value, useReserve, date);
    if (!result.ok) {
      if (result.reason === 'insufficient-reserve') {
        return showAlert(`Saldo reservado insuficiente. Disponível: ${money2(result.available)}.`);
      }
      return showAlert('Informe um valor de pagamento maior que zero.');
    }
    renderTrips();
  });
}

export function initTrips() {
  document.getElementById('tripFilterStatus').onchange = (e) => {
    view.filterStatusTrips = e.target.value;
    renderTrips();
  };
  document.getElementById('tripSearch').oninput = (e) => {
    view.searchTrips = e.target.value;
    renderTrips();
  };
  document.getElementById('tripSortField').onchange = (e) => {
    view.sortFieldTrips = e.target.value;
    renderTrips();
  };
  document.getElementById('tripSortDirBtn').onclick = () => {
    view.sortDescTrips = !view.sortDescTrips;
    document.getElementById('tripSortDirBtn').textContent = view.sortDescTrips ? '↓' : '↑';
    renderTrips();
  };

  document.getElementById('addTripBtn').onclick = async () => {
    const nome = document.getElementById('tripNome').value.trim();
    const destino = document.getElementById('tripDestino').value.trim();
    const dataIda = document.getElementById('tripDataIda').value;
    const dataVolta = document.getElementById('tripDataVolta').value;
    const orcamentoTotal = Number(document.getElementById('tripOrcamento').value);
    const status = document.getElementById('tripStatus').value;
    const observacoes = document.getElementById('tripObs').value.trim();

    if (!nome) return showAlert('Informe o nome da viagem.');
    if (!(orcamentoTotal >= 0)) return showAlert('Informe um orçamento válido e não negativo.');
    if (dataIda && dataVolta && dataVolta < dataIda) return showAlert('A data de volta não pode ser anterior à data de ida.');

    createTrip({ nome, destino, dataIda, dataVolta, orcamentoTotal, status, observacoes });
    ['tripNome', 'tripDestino', 'tripDataIda', 'tripDataVolta', 'tripOrcamento', 'tripObs']
      .forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('tripStatus').value = 'Planejada';
    renderTrips();
  };

  renderTrips();
}
