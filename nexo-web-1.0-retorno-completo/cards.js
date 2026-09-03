// Fase 7 — Cartões de crédito.
// Compra no cartão = compromisso de fatura (não é Saída real).
// Pagamento da fatura = Saída real vinculada, evitando dupla contagem.

import { MONTH_NAMES, view, data, currency, genId, scheduleSave, pad2, getCategories } from './state.js';
import { showAlert, showConfirm, showDatePrompt } from './ui-dialogs.js';

const CARD_BRANDS = ['Mastercard', 'Visa', 'Elo', 'American Express', 'Hipercard', 'Outro'];

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function esc(v = '') { return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function clampDay(v) { return Math.max(1, Math.min(31, parseInt(v, 10) || 1)); }
function refKey(y, m) { return `${y}-${pad2(m + 1)}`; }
function parseRef(ref) { const [y, m] = String(ref).split('-').map(Number); return { y, m: m - 1 }; }
function addMonthsRef(ref, delta) {
  const { y, m } = parseRef(ref);
  const d = new Date(y, m + delta, 1);
  return refKey(d.getFullYear(), d.getMonth());
}
function safeDate(y, m, day) {
  const max = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(clampDay(day), max));
}
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtDate(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }
function monthLabelFromRef(ref) { const { y, m } = parseRef(ref); return `${MONTH_NAMES[m]} ${y}`; }

export function getInvoiceReferenceMonth(card, purchaseDate) {
  const [y, month1, day] = String(purchaseDate).split('-').map(Number);
  if (!y || !month1 || !day) return '';
  const m = month1 - 1;
  if (day <= clampDay(card.diaFechamento)) return refKey(y, m);
  const next = new Date(y, m + 1, 1);
  return refKey(next.getFullYear(), next.getMonth());
}

function installmentAmounts(total, count) {
  const cents = Math.round(Math.max(Number(total) || 0, 0) * 100);
  const n = Math.max(parseInt(count, 10) || 1, 1);
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

function purchaseOccurrences(purchase) {
  const amounts = installmentAmounts(purchase.valorTotal, purchase.numeroParcelas || 1);
  return amounts.map((value, i) => ({
    purchaseId: purchase.id,
    cardId: purchase.cartaoId,
    reference: addMonthsRef(purchase.primeiraFaturaRef, i),
    installmentNumber: i + 1,
    installmentCount: amounts.length,
    value: round2(value),
    description: purchase.descricao,
    category: purchase.categoria,
    purchaseDate: purchase.dataCompra,
  }));
}

function allOccurrences(cardId = null) {
  const purchases = data.cardPurchases.filter((p) => cardId === null || p.cartaoId === cardId);
  return purchases.flatMap(purchaseOccurrences);
}

function invoiceRecord(cardId, reference) {
  return data.cardInvoices.find((i) => i.cartaoId === cardId && i.reference === reference) || null;
}

function isInvoicePaid(cardId, reference) {
  const inv = invoiceRecord(cardId, reference);
  return !!inv?.paidAt;
}

function invoiceDates(card, reference) {
  const { y, m } = parseRef(reference);
  const closing = safeDate(y, m, card.diaFechamento);
  let dueY = y, dueM = m;
  if (clampDay(card.diaVencimento) <= clampDay(card.diaFechamento)) {
    const next = new Date(y, m + 1, 1);
    dueY = next.getFullYear(); dueM = next.getMonth();
  }
  const due = safeDate(dueY, dueM, card.diaVencimento);
  return { closing: isoDate(closing), due: isoDate(due) };
}

function invoiceStatus(card, reference) {
  if (isInvoicePaid(card.id, reference)) return 'Paga';
  const { closing, due } = invoiceDates(card, reference);
  const todayIso = new Date().toISOString().slice(0, 10);
  if (todayIso > due) return 'Atrasada';
  if (todayIso > closing) return 'Fechada';
  return 'Aberta';
}

export function getInvoiceSummary(cardId, reference) {
  const card = data.creditCards.find((c) => c.id === cardId);
  if (!card) return null;
  const record = invoiceRecord(cardId, reference);
  const liveOccurrences = allOccurrences(cardId).filter((o) => o.reference === reference);
  const occurrences = record?.paidAt && Array.isArray(record.snapshotOccurrences)
    ? record.snapshotOccurrences
    : liveOccurrences;
  const total = record?.paidAt && Number.isFinite(Number(record.snapshotTotal))
    ? round2(record.snapshotTotal)
    : round2(occurrences.reduce((s, o) => s + o.value, 0));
  return {
    card, reference, occurrences, total,
    status: invoiceStatus(card, reference),
    paidAt: record?.paidAt || null,
    paidAmount: Number(record?.paidAmount) || 0,
    saidaId: record?.saidaId ?? null,
    dates: invoiceDates(card, reference),
  };
}

export function getCardLimitSummary(cardId) {
  const card = data.creditCards.find((c) => c.id === cardId);
  if (!card) return { limit: 0, used: 0, available: 0 };
  const used = round2(allOccurrences(cardId)
    .filter((o) => !isInvoicePaid(cardId, o.reference))
    .reduce((s, o) => s + o.value, 0));
  const limit = Math.max(Number(card.limiteTotal) || 0, 0);
  return { limit: round2(limit), used, available: round2(limit - used) };
}

export function getCardsSummary(reference = refKey(view.yearCartoes, view.monthCartoes)) {
  const active = data.creditCards.filter((c) => c.ativo !== false);
  const totalLimit = round2(active.reduce((s, c) => s + (Number(c.limiteTotal) || 0), 0));
  const used = round2(active.reduce((s, c) => s + getCardLimitSummary(c.id).used, 0));
  const invoices = round2(active.reduce((s, c) => s + (getInvoiceSummary(c.id, reference)?.total || 0), 0));
  return { cards: active.length, totalLimit, used, available: round2(totalLimit - used), invoices };
}

function purchaseHasPaidOccurrence(purchase) {
  return purchaseOccurrences(purchase).some((o) => isInvoicePaid(purchase.cartaoId, o.reference));
}

// Faturas pagas viram um retrato histórico. Isso permite editar/apagar a compra
// depois sem reescrever retroativamente uma fatura que já foi quitada.
function freezePaidInvoice(cardId, reference) {
  const inv = invoiceRecord(cardId, reference);
  if (!inv?.paidAt || Array.isArray(inv.snapshotOccurrences)) return inv;
  const occurrences = allOccurrences(cardId).filter((o) => o.reference === reference);
  inv.snapshotOccurrences = occurrences.map((o) => ({ ...o }));
  inv.snapshotTotal = round2(occurrences.reduce((sum, o) => sum + o.value, 0));
  inv.updatedAt = new Date().toISOString();
  return inv;
}

function freezePaidInvoicesForPurchase(purchase) {
  const refs = new Set(purchaseOccurrences(purchase).map((o) => o.reference));
  refs.forEach((reference) => {
    if (isInvoicePaid(purchase.cartaoId, reference)) freezePaidInvoice(purchase.cartaoId, reference);
  });
}

function createCard(fields) {
  const now = new Date().toISOString();
  const card = {
    id: genId(), nome: fields.nome.trim(), banco: fields.banco.trim(), bandeira: fields.bandeira,
    limiteTotal: Math.max(round2(fields.limiteTotal), 0), diaFechamento: clampDay(fields.diaFechamento),
    diaVencimento: clampDay(fields.diaVencimento), ativo: true, observacoes: fields.observacoes.trim(),
    createdAt: now, updatedAt: now,
  };
  data.creditCards.push(card); scheduleSave(); return card;
}

function updateCard(id, fields) {
  const card = data.creditCards.find((c) => c.id === id); if (!card) return;
  Object.assign(card, {
    nome: fields.nome.trim(), banco: fields.banco.trim(), bandeira: fields.bandeira,
    limiteTotal: Math.max(round2(fields.limiteTotal), 0), diaFechamento: clampDay(fields.diaFechamento),
    diaVencimento: clampDay(fields.diaVencimento), observacoes: fields.observacoes.trim(), updatedAt: new Date().toISOString(),
  });
  scheduleSave();
}

function createPurchase(fields) {
  const card = data.creditCards.find((c) => c.id === fields.cartaoId); if (!card) return null;
  const total = Math.max(round2(fields.valorTotal), 0); const count = Math.max(parseInt(fields.numeroParcelas, 10) || 1, 1);
  const now = new Date().toISOString();
  const p = {
    id: genId(), cartaoId: card.id, descricao: fields.descricao.trim(), categoria: fields.categoria,
    valorTotal: total, dataCompra: fields.dataCompra, parcelado: count > 1, numeroParcelas: count,
    primeiraFaturaRef: getInvoiceReferenceMonth(card, fields.dataCompra), observacoes: fields.observacoes.trim(),
    createdAt: now, updatedAt: now,
  };
  data.cardPurchases.push(p); scheduleSave(); return p;
}

function updatePurchase(id, fields) {
  const p = data.cardPurchases.find((x) => x.id === id); if (!p) return;
  const card = data.creditCards.find((c) => c.id === p.cartaoId); if (!card) return;
  const count = Math.max(parseInt(fields.numeroParcelas, 10) || 1, 1);
  Object.assign(p, {
    descricao: fields.descricao.trim(), categoria: fields.categoria, valorTotal: Math.max(round2(fields.valorTotal), 0),
    dataCompra: fields.dataCompra, parcelado: count > 1, numeroParcelas: count,
    primeiraFaturaRef: getInvoiceReferenceMonth(card, fields.dataCompra), observacoes: fields.observacoes.trim(), updatedAt: new Date().toISOString(),
  }); scheduleSave();
}

async function payInvoice(cardId, reference, paymentDate) {
  const summary = getInvoiceSummary(cardId, reference); if (!summary || !(summary.total > 0)) return false;
  let inv = invoiceRecord(cardId, reference);
  if (inv?.paidAt || inv?.saidaId != null) { await showAlert('Esta fatura já foi paga.'); return false; }
  const now = new Date().toISOString();
  if (!inv) {
    inv = { id: genId(), cartaoId: cardId, reference, paidAt: null, paidAmount: 0, saidaId: null, createdAt: now, updatedAt: now };
    data.cardInvoices.push(inv);
  }
  const expenseId = Date.now();
  data.expenses.push({
    id: expenseId, date: paymentDate, category: 'Outros',
    desc: `Pagamento fatura — ${summary.card.nome}${summary.card.banco ? ` (${summary.card.banco})` : ''} — ${monthLabelFromRef(reference)}`,
    value: summary.total, sourceType: 'cardInvoice', sourceId: inv.id,
  });
  inv.paidAt = paymentDate;
  inv.paidAmount = summary.total;
  inv.saidaId = expenseId;
  inv.snapshotTotal = summary.total;
  inv.snapshotOccurrences = summary.occurrences.map((o) => ({ ...o }));
  inv.updatedAt = now;
  scheduleSave(); return true;
}

async function deletePurchase(id) {
  const p = data.cardPurchases.find((x) => x.id === id); if (!p) return;
  const hasPaid = purchaseHasPaidOccurrence(p);
  if (hasPaid) freezePaidInvoicesForPurchase(p);
  const message = hasPaid
    ? 'Esta compra possui parcela em fatura já paga. A fatura paga e a Saída correspondente serão preservadas no histórico; somente a compra e parcelas futuras serão removidas. Deseja continuar?'
    : 'Excluir esta compra do cartão?';
  if (!(await showConfirm(message))) return;
  data.cardPurchases = data.cardPurchases.filter((x) => x.id !== id);
  scheduleSave(); renderCards();
}

async function deleteCard(id) {
  const purchases = data.cardPurchases.filter((p) => p.cartaoId === id);
  const invoices = data.cardInvoices.filter((i) => i.cartaoId === id);
  const paidInvoices = invoices.filter((i) => i.paidAt);
  const message = paidInvoices.length
    ? `Este cartão possui ${paidInvoices.length} fatura(s) paga(s) e ${purchases.length} compra(s). O cartão, compras e histórico interno de faturas serão removidos, mas os pagamentos já lançados em Saídas/Movimentos serão preservados como lançamentos comuns. Deseja continuar?`
    : purchases.length
      ? `Este cartão possui ${purchases.length} compra(s). Excluir cartão e todas as compras vinculadas?`
      : 'Excluir este cartão?';
  if (!(await showConfirm(message))) return;

  // Preserva o caixa já realizado, mas desliga o vínculo com um cartão que deixará de existir.
  const invoiceIds = new Set(invoices.map((i) => i.id));
  data.expenses.forEach((e) => {
    if (e.sourceType === 'cardInvoice' && invoiceIds.has(e.sourceId)) {
      e.sourceType = null;
      e.sourceId = null;
    }
  });
  data.creditCards = data.creditCards.filter((c) => c.id !== id);
  data.cardPurchases = data.cardPurchases.filter((p) => p.cartaoId !== id);
  data.cardInvoices = data.cardInvoices.filter((i) => i.cartaoId !== id);
  if (view.openCardId === id) view.openCardId = null;
  if (view.editingCardId === id) view.editingCardId = null;
  scheduleSave(); renderCards();
}

function shiftMonth(delta) {
  view.monthCartoes += delta;
  if (view.monthCartoes < 0) { view.monthCartoes = 11; view.yearCartoes--; }
  if (view.monthCartoes > 11) { view.monthCartoes = 0; view.yearCartoes++; }
  renderCards();
}

function filteredCards() {
  let list = [...data.creditCards];
  if (view.filterCardStatus === 'ativos') list = list.filter((c) => c.ativo !== false);
  if (view.filterCardStatus === 'inativos') list = list.filter((c) => c.ativo === false);
  const q = (view.searchCards || '').trim().toLowerCase();
  if (q) list = list.filter((c) => `${c.nome} ${c.banco} ${c.bandeira}`.toLowerCase().includes(q));
  return list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function renderSummary() {
  const ref = refKey(view.yearCartoes, view.monthCartoes); const s = getCardsSummary(ref);
  document.getElementById('cardSummaryGrid').innerHTML = [
    ['LIMITE TOTAL', s.totalLimit, 'cyan'], ['UTILIZADO', s.used, 'pink'], ['DISPONÍVEL', s.available, s.available >= 0 ? 'green' : 'pink'],
    [`FATURAS — ${MONTH_NAMES[view.monthCartoes]}`, s.invoices, 'gold'], ['CARTÕES ATIVOS', s.cards, 'purple', false],
  ].map(([l,v,c,money=true]) => `<div class="summary-card"><div class="lbl">${l}</div><div class="val mono ${c}">${money ? currency(v) : v}</div></div>`).join('');
}

function renderCardForm() {
  const editing = view.editingCardId ? data.creditCards.find((c) => c.id === view.editingCardId) : null;
  const box = document.getElementById('cardFormBox');
  box.innerHTML = `
    <div class="eyebrow">${editing ? 'EDITAR CARTÃO' : 'NOVO CARTÃO'}</div>
    <div class="credit-card-form">
      <input id="ccName" class="input-field" placeholder="Nome (ex: Nubank)" value="${esc(editing?.nome || '')}">
      <input id="ccBank" class="input-field" placeholder="Banco/Instituição" value="${esc(editing?.banco || '')}">
      <select id="ccBrand" class="input-field">${CARD_BRANDS.map(b => `<option ${b === editing?.bandeira ? 'selected' : ''}>${b}</option>`).join('')}</select>
      <input id="ccLimit" class="input-field mono" type="number" min="0" step="0.01" placeholder="Limite total" value="${editing ? Number(editing.limiteTotal)||0 : ''}">
      <input id="ccClosing" class="input-field mono" type="number" min="1" max="31" placeholder="Fecha dia" value="${editing?.diaFechamento || ''}">
      <input id="ccDue" class="input-field mono" type="number" min="1" max="31" placeholder="Vence dia" value="${editing?.diaVencimento || ''}">
      <input id="ccNotes" class="input-field" placeholder="Observações" value="${esc(editing?.observacoes || '')}">
      <div class="card-form-actions"><button id="saveCardBtn" class="btn-primary small">${editing ? '<span class="app-icon icon-circle-check sm"></span>Salvar' : '+ Cartão'}</button>${editing ? '<button id="cancelCardEdit" class="btn-ghost small">Cancelar</button>' : ''}</div>
    </div>`;
  document.getElementById('saveCardBtn').onclick = async () => {
    const fields = {
      nome: document.getElementById('ccName').value, banco: document.getElementById('ccBank').value, bandeira: document.getElementById('ccBrand').value,
      limiteTotal: document.getElementById('ccLimit').value, diaFechamento: document.getElementById('ccClosing').value,
      diaVencimento: document.getElementById('ccDue').value, observacoes: document.getElementById('ccNotes').value,
    };
    if (!fields.nome.trim() || !(Number(fields.limiteTotal) >= 0) || !Number(fields.diaFechamento) || !Number(fields.diaVencimento)) { await showAlert('Preencha nome, limite, dia de fechamento e dia de vencimento.'); return; }
    if (editing) updateCard(editing.id, fields); else createCard(fields);
    view.editingCardId = null; renderCards();
  };
  document.getElementById('cancelCardEdit')?.addEventListener('click', () => { view.editingCardId = null; renderCardForm(); });
}

function renderPurchaseForm() {
  const cardSelect = document.getElementById('purchaseCard');
  const cards = data.creditCards.filter(c => c.ativo !== false);
  cardSelect.innerHTML = cards.length ? cards.map(c => `<option value="${c.id}">${esc(c.nome)}${c.banco ? ` — ${esc(c.banco)}` : ''}</option>`).join('') : '<option value="">Cadastre um cartão primeiro</option>';
  if (view.purchaseCardId && cards.some(c => c.id === view.purchaseCardId)) cardSelect.value = view.purchaseCardId;
  const date = document.getElementById('purchaseDate'); if (!date.value) date.value = new Date().toISOString().slice(0,10);
}

function renderPurchaseEditor(p) {
  const hasPaid = purchaseHasPaidOccurrence(p);
  return `<div class="card-purchase-edit" data-purchase-edit="${p.id}">
    <label class="card-edit-field card-edit-wide"><span>Descrição</span><input class="input-field" data-field="description" value="${esc(p.descricao)}"></label>
    <label class="card-edit-field"><span>Categoria</span><select class="input-field" data-field="category">${getCategories('cardPurchases').map(c=>`<option ${c===p.categoria?'selected':''}>${c}</option>`).join('')}</select></label>
    <label class="card-edit-field"><span>Data da compra</span><input class="input-field mono" data-field="date" type="date" value="${p.dataCompra}" ${hasPaid?'disabled':''}></label>
    <label class="card-edit-field"><span>Valor total</span><input class="input-field mono" data-field="value" type="number" min="0" step="0.01" value="${p.valorTotal}" ${hasPaid?'disabled':''}></label>
    <label class="card-edit-field"><span>Parcelas</span><input class="input-field mono" data-field="installments" type="number" min="1" max="48" value="${p.numeroParcelas||1}" ${hasPaid?'disabled':''}></label>
    <div class="card-edit-actions"><button class="edit save-card-purchase" data-id="${p.id}"><span class="app-icon icon-circle-check sm"></span>Salvar</button><button class="del cancel-card-purchase">Cancelar</button></div>
    ${hasPaid ? '<div class="card-lock-note">Fatura já paga: descrição e categoria podem ser corrigidas. Data, valor e parcelamento ficam preservados para não alterar o histórico quitado.</div>' : ''}
  </div>`;
}

function futureInstallments(cardId, reference) {
  return allOccurrences(cardId).filter(o => o.reference > reference && !isInvoicePaid(cardId, o.reference)).sort((a,b)=>a.reference.localeCompare(b.reference));
}

function invoiceHistory(cardId) {
  const refs = new Set(allOccurrences(cardId).map((o) => o.reference));
  data.cardInvoices.filter((i) => i.cartaoId === cardId).forEach((i) => refs.add(i.reference));
  return [...refs].sort((a, b) => b.localeCompare(a)).slice(0, 12).map((reference) => getInvoiceSummary(cardId, reference));
}

function cardPanel(card) {
  const ref = refKey(view.yearCartoes, view.monthCartoes); const inv = getInvoiceSummary(card.id, ref); const lim = getCardLimitSummary(card.id);
  const open = view.openCardId === card.id; const purchases = data.cardPurchases.filter(p=>p.cartaoId===card.id).sort((a,b)=>b.dataCompra.localeCompare(a.dataCompra));
  const future = futureInstallments(card.id, ref); const history = invoiceHistory(card.id);
  return `<div class="credit-card-item ${card.ativo === false ? 'inactive' : ''}" data-card-id="${card.id}">
    <div class="credit-card-head">
      <div><div class="credit-card-name">${esc(card.nome)} <span class="card-brand-badge">${esc(card.bandeira)}</span> ${card.ativo===false?'<span class="badge-status">Inativo</span>':''}</div><div class="credit-card-sub">${esc(card.banco||'Sem banco')} · fecha dia ${card.diaFechamento} · vence dia ${card.diaVencimento}</div></div>
      <div class="exp-actions"><button class="edit card-toggle" data-id="${card.id}">${card.ativo===false?'▶':'⏸'}</button><button class="edit card-edit" data-id="${card.id}">✎</button><button class="del card-delete" data-id="${card.id}">Excluir</button></div>
    </div>
    <div class="credit-card-values">
      <div><span>Limite</span><strong>${currency(lim.limit)}</strong></div><div><span>Utilizado</span><strong class="pink">${currency(lim.used)}</strong></div><div><span>Disponível</span><strong class="${lim.available>=0?'green':'pink'}">${currency(lim.available)}</strong></div><div><span>Fatura ${MONTH_NAMES[view.monthCartoes]}</span><strong class="gold">${currency(inv.total)}</strong></div>
    </div>
    <div class="credit-limit-bar"><div style="width:${lim.limit>0?Math.max(0,Math.min(100,(lim.used/lim.limit)*100)):0}%"></div></div>
    <div class="credit-card-invoice-line"><span class="badge-status card-invoice-${inv.status.toLowerCase()}">${inv.status}</span><span>Fecha ${fmtDate(inv.dates.closing)} · vence ${fmtDate(inv.dates.due)}</span></div>
    <div class="debt-actions-row"><button class="btn-ghost small card-open" data-id="${card.id}">${open?'▲ Fechar detalhes':'▼ Abrir detalhes'}</button><button class="btn-primary small card-pay" data-id="${card.id}" ${inv.total<=0||inv.status==='Paga'?'disabled':''}>💳 Pagar fatura</button></div>
    ${open ? `<div class="credit-card-details">
      <div class="card-detail-section"><div class="eyebrow">FATURA DE ${monthLabelFromRef(ref).toUpperCase()}</div>${inv.occurrences.length ? inv.occurrences.map(o=>`<div class="invoice-occurrence"><div><strong>${esc(o.description)}</strong><span>${esc(o.category)} · ${o.installmentNumber}/${o.installmentCount}</span></div><strong class="mono">${currency(o.value)}</strong></div>`).join('') : '<div class="exp-empty compact">Nenhum lançamento nesta fatura.</div>'}</div>
      <div class="card-detail-section"><div class="eyebrow">COMPRAS DO CARTÃO</div>${purchases.length ? purchases.map(p=> view.editingCardPurchaseId===p.id ? renderPurchaseEditor(p) : `<div class="card-purchase-row"><div><strong>${esc(p.descricao)}</strong><span>${fmtDate(p.dataCompra)} · ${esc(p.categoria)} · ${p.numeroParcelas||1}x</span></div><div class="card-purchase-right"><strong>${currency(p.valorTotal)}</strong><button class="edit edit-card-purchase" data-id="${p.id}">✎</button><button class="del delete-card-purchase" data-id="${p.id}">Excluir</button></div></div>`).join('') : '<div class="exp-empty compact">Nenhuma compra neste cartão.</div>'}</div>
      <div class="card-detail-section"><div class="eyebrow">PARCELAS FUTURAS</div>${future.length ? future.slice(0,18).map(o=>`<div class="future-installment"><span>${monthLabelFromRef(o.reference)} · ${esc(o.description)} (${o.installmentNumber}/${o.installmentCount})</span><strong class="mono">${currency(o.value)}</strong></div>`).join('') : '<div class="exp-empty compact">Sem parcelas futuras em aberto.</div>'}</div>
      <div class="card-detail-section card-invoice-history"><div class="eyebrow">HISTÓRICO DE FATURAS</div>${history.length ? history.map(h=>`<div class="future-installment"><span>${monthLabelFromRef(h.reference)} · <span class="badge-status card-invoice-${h.status.toLowerCase()}">${h.status}</span></span><strong class="mono">${currency(h.total)}</strong></div>`).join('') : '<div class="exp-empty compact">Sem histórico ainda.</div>'}</div>
    </div>` : ''}
  </div>`;
}

function bindCardEvents() {
  document.querySelectorAll('.card-open').forEach(b=>b.onclick=()=>{ view.openCardId = view.openCardId===b.dataset.id?null:b.dataset.id; renderCardList(); });
  document.querySelectorAll('.card-edit').forEach(b=>b.onclick=()=>{ view.editingCardId=b.dataset.id; renderCardForm(); });
  document.querySelectorAll('.card-toggle').forEach(b=>b.onclick=()=>{ const c=data.creditCards.find(x=>x.id===b.dataset.id); if(c){c.ativo=c.ativo===false; c.updatedAt=new Date().toISOString(); scheduleSave(); renderCards();} });
  document.querySelectorAll('.card-delete').forEach(b=>b.onclick=()=>deleteCard(b.dataset.id));
  document.querySelectorAll('.card-pay').forEach(b=>b.onclick=async()=>{
    const cardId=b.dataset.id, ref=refKey(view.yearCartoes, view.monthCartoes), inv=getInvoiceSummary(cardId, ref);
    if (!inv?.total) return;
    const date = await showDatePrompt(
      `Data do pagamento da fatura de ${currency(inv.total)}:`,
      new Date().toISOString().slice(0,10)
    );
    if (!date) return;
    if (!(await showConfirm(`Registrar pagamento de ${currency(inv.total)} e gerar uma Saída real?`))) return;
    if (await payInvoice(cardId, ref, date)) {
      renderCards();
      await showAlert('Fatura paga. A saída foi registrada e aparecerá em Saídas, Movimentos e Visão Geral.');
    }
  });
  document.querySelectorAll('.edit-card-purchase').forEach(b=>b.onclick=()=>{ view.editingCardPurchaseId=b.dataset.id; renderCardList(); });
  document.querySelectorAll('.cancel-card-purchase').forEach(b=>b.onclick=()=>{ view.editingCardPurchaseId=null; renderCardList(); });
  document.querySelectorAll('.delete-card-purchase').forEach(b=>b.onclick=()=>deletePurchase(b.dataset.id));
  document.querySelectorAll('.save-card-purchase').forEach(b=>b.onclick=async()=>{
    const p=data.cardPurchases.find(x=>x.id===b.dataset.id); const row=document.querySelector(`[data-purchase-edit="${b.dataset.id}"]`); if(!p||!row)return;
    const hasPaid = purchaseHasPaidOccurrence(p);
    if (hasPaid) freezePaidInvoicesForPurchase(p);
    const fields={
      descricao:row.querySelector('[data-field="description"]').value,
      categoria:row.querySelector('[data-field="category"]').value,
      dataCompra:hasPaid ? p.dataCompra : row.querySelector('[data-field="date"]').value,
      valorTotal:hasPaid ? p.valorTotal : row.querySelector('[data-field="value"]').value,
      numeroParcelas:hasPaid ? p.numeroParcelas : row.querySelector('[data-field="installments"]').value,
      observacoes:p.observacoes||''
    };
    if(!fields.descricao.trim()||!fields.dataCompra||!(Number(fields.valorTotal)>0)){await showAlert('Informe descrição, data e valor maior que zero.');return;}
    updatePurchase(p.id,fields); view.editingCardPurchaseId=null; renderCards();
  });
}

function renderCardList() {
  const list=filteredCards(); const box=document.getElementById('creditCardList');
  box.innerHTML=list.length?list.map(cardPanel).join(''):'<div class="exp-empty">Nenhum cartão encontrado.</div>'; bindCardEvents();
}

export function renderCards() {
  document.getElementById('cardMonthLabel').textContent=`${MONTH_NAMES[view.monthCartoes]} ${view.yearCartoes}`;
  document.getElementById('cardFilterStatus').value=view.filterCardStatus;
  document.getElementById('cardSearch').value=view.searchCards;
  renderSummary(); renderCardForm(); renderPurchaseForm(); renderCardList();
}

export function initCards() {
  document.getElementById('prevMonthCards').onclick=()=>shiftMonth(-1);
  document.getElementById('nextMonthCards').onclick=()=>shiftMonth(1);
  document.getElementById('cardFilterStatus').onchange=e=>{view.filterCardStatus=e.target.value;renderCardList();};
  document.getElementById('cardSearch').oninput=e=>{view.searchCards=e.target.value;renderCardList();};
  document.getElementById('purchaseCard').onchange=e=>{view.purchaseCardId=e.target.value;};
  document.getElementById('purchaseCategory').innerHTML = getCategories('cardPurchases').map((c) => `<option>${c}</option>`).join('');
  document.getElementById('addCardPurchaseBtn').onclick=async()=>{
    const fields={cartaoId:document.getElementById('purchaseCard').value,descricao:document.getElementById('purchaseDesc').value,categoria:document.getElementById('purchaseCategory').value,valorTotal:document.getElementById('purchaseValue').value,dataCompra:document.getElementById('purchaseDate').value,numeroParcelas:document.getElementById('purchaseInstallments').value,observacoes:document.getElementById('purchaseNotes').value};
    if(!fields.cartaoId){await showAlert('Cadastre e selecione um cartão primeiro.');return;}
    if(!fields.descricao.trim()||!fields.dataCompra||!(Number(fields.valorTotal)>0)){await showAlert('Informe descrição, data e valor maior que zero.');return;}
    const p=createPurchase(fields); if(!p)return;
    view.purchaseCardId=fields.cartaoId; view.openCardId=fields.cartaoId;
    ['purchaseDesc','purchaseValue','purchaseNotes'].forEach(id=>document.getElementById(id).value=''); document.getElementById('purchaseInstallments').value='1'; renderCards();
  };
  renderCards();
}
