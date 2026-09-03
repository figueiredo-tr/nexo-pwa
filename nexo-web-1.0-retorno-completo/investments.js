// Aba Investimentos (Fase 4) — carteira pessoal: quanto foi investido, valor
// atual, lucro/prejuízo, rentabilidade e rendimentos (dividendos/JCP/etc).
// Mesmo padrão de Prioridades (Fase 3): tudo local em `data.investments` /
// `data.dividends`, mutação direta + scheduleSave(). Sem Sheets, sem cotação
// automática — valor atual é informado manualmente. Sem integração com
// Dashboard ainda (getPortfolioSummary/getMonthlyIncome ficam prontos, mas
// não são chamados de fora deste módulo).
//
// MODELO ESCOLHIDO — quantidade vs renda fixa:
//   Ação / Fundo Imobiliário / ETF / Criptomoeda  -> usam quantidade + preçoMédio
//     + valorAtualUnitario. valorInvestido/valorAtual são CALCULADOS
//     (quantidade × preço) e recalculados a cada save — nunca editados direto.
//   Tesouro Direto / CDB / LCI-LCA / Fundo / Outro -> não têm cotação por
//     unidade que faça sentido pro usuário; valorInvestido/valorAtual são
//     digitados diretamente.
// Em ambos os casos, os dois campos ficam gravados no registro (o modelo do
// documento pede os dois), só muda quem calcula: o código (tipo quantidade)
// ou o usuário (tipo renda fixa).
//
// Rendimentos NUNCA alteram valorInvestido/valorAtual — são fluxo separado
// (data.dividends), só somados nos cards de "rendimentos do mês/acumulado".

import {
  view, data, genId, scheduleSave, dividendsForMonth, MONTH_NAMES,
} from './state.js';
import { showAlert, showConfirm } from './ui-dialogs.js';

const QUANTITY_TYPES = ['Ação', 'Fundo Imobiliário', 'ETF', 'Criptomoeda'];
const FIXED_TYPES = ['Tesouro Direto', 'CDB', 'LCI/LCA', 'Fundo', 'Outro'];
const ALL_TYPES = [...QUANTITY_TYPES, ...FIXED_TYPES];

const DIVIDEND_TYPES = ['Dividendo', 'JCP', 'Rendimento FII', 'Juros', 'Cupom', 'Outro'];

const isQuantityType = (tipo) => QUANTITY_TYPES.includes(tipo);

const TIPO_BADGE = {
  'Ação': 'badge-tipo-cyan',
  'Fundo Imobiliário': 'badge-tipo-gold',
  'ETF': 'badge-tipo-purple',
  'Criptomoeda': 'badge-tipo-pink',
  'Tesouro Direto': 'badge-tipo-green',
  'CDB': 'badge-tipo-green',
  'LCI/LCA': 'badge-tipo-green',
  'Fundo': 'badge-tipo-purple',
  'Outro': 'badge-tipo-grey',
};

// ---------------------------------------------------------------------------
// Helpers de dinheiro (evita erro de arredondamento — arredonda em centavos)
// ---------------------------------------------------------------------------

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function money2(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '-R$ ' : 'R$ ') + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedMoney2(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '- ' : '+ ') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedPct(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '' : '+') + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.split('-').reverse().join('/');
}

// ---------------------------------------------------------------------------
// Funções puras de cálculo
// ---------------------------------------------------------------------------

export function computeInvestmentValues(inv) {
  let valorInvestido;
  let valorAtual;
  if (isQuantityType(inv.tipo)) {
    valorInvestido = round2((Number(inv.quantidade) || 0) * (Number(inv.precoMedio) || 0));
    valorAtual = round2((Number(inv.quantidade) || 0) * (Number(inv.valorAtualUnitario) || 0));
  } else {
    valorInvestido = round2(inv.valorInvestido);
    valorAtual = round2(inv.valorAtual);
  }
  const lucroPrejuizo = round2(valorAtual - valorInvestido);
  const rentabilidade = valorInvestido > 0 ? round2((lucroPrejuizo / valorInvestido) * 100) : 0;
  return { valorInvestido, valorAtual, lucroPrejuizo, rentabilidade };
}

// Soma apenas investimentos ATIVOS — regra explícita do patrimônio principal.
export function getPortfolioSummary(list = data.investments) {
  const ativos = list.filter((i) => i.ativo);
  const totals = ativos.reduce(
    (acc, inv) => {
      const { valorInvestido, valorAtual } = computeInvestmentValues(inv);
      acc.patrimonioInvestido += valorInvestido;
      acc.valorAtualCarteira += valorAtual;
      return acc;
    },
    { patrimonioInvestido: 0, valorAtualCarteira: 0 }
  );
  const lucroPrejuizo = round2(totals.valorAtualCarteira - totals.patrimonioInvestido);
  const rentabilidade = totals.patrimonioInvestido > 0
    ? round2((lucroPrejuizo / totals.patrimonioInvestido) * 100)
    : 0;
  return {
    patrimonioInvestido: round2(totals.patrimonioInvestido),
    valorAtualCarteira: round2(totals.valorAtualCarteira),
    lucroPrejuizo,
    rentabilidade,
  };
}

export function getMonthlyIncome(y, m) {
  return round2(dividendsForMonth(y, m).reduce((sum, d) => sum + (Number(d.valor) || 0), 0));
}

export function getAccumulatedIncome() {
  return round2(data.dividends.reduce((sum, d) => sum + (Number(d.valor) || 0), 0));
}

function totalReceivedFor(investimentoId) {
  return round2(
    data.dividends
      .filter((d) => d.investimentoId === investimentoId)
      .reduce((sum, d) => sum + (Number(d.valor) || 0), 0)
  );
}

// ---------------------------------------------------------------------------
// CRUD — Investimentos
// ---------------------------------------------------------------------------

function createInvestment(fields) {
  const now = new Date().toISOString();
  const record = {
    id: genId(),
    nome: fields.nome,
    ticker: fields.ticker || '',
    tipo: fields.tipo,
    instituicao: fields.instituicao || '',
    quantidade: isQuantityType(fields.tipo) ? Number(fields.quantidade) || 0 : null,
    precoMedio: isQuantityType(fields.tipo) ? round2(fields.precoMedio) : null,
    valorAtualUnitario: isQuantityType(fields.tipo) ? round2(fields.valorAtualUnitario) : null,
    valorInvestido: isQuantityType(fields.tipo) ? 0 : round2(fields.valorInvestido),
    valorAtual: isQuantityType(fields.tipo) ? 0 : round2(fields.valorAtual),
    dataPrimeiroAporte: fields.dataPrimeiroAporte || '',
    observacoes: fields.observacoes || '',
    ativo: true,
    createdAt: now,
    updatedAt: now,
  };
  const { valorInvestido, valorAtual } = computeInvestmentValues(record);
  record.valorInvestido = valorInvestido;
  record.valorAtual = valorAtual;
  data.investments.push(record);
  scheduleSave();
  return record;
}

function updateInvestment(id, fields) {
  const inv = data.investments.find((x) => x.id === id);
  if (!inv) return null;
  Object.assign(inv, fields, { updatedAt: new Date().toISOString() });
  if (!isQuantityType(inv.tipo)) {
    inv.quantidade = null;
    inv.precoMedio = null;
    inv.valorAtualUnitario = null;
    inv.valorInvestido = round2(inv.valorInvestido);
    inv.valorAtual = round2(inv.valorAtual);
  }
  const { valorInvestido, valorAtual } = computeInvestmentValues(inv);
  inv.valorInvestido = valorInvestido;
  inv.valorAtual = valorAtual;
  scheduleSave();
  return inv;
}

function deleteInvestment(id) {
  data.investments = data.investments.filter((i) => i.id !== id);
  // cascade: rendimentos órfãos não fazem sentido — removidos junto (usuário é avisado antes).
  data.dividends = data.dividends.filter((d) => d.investimentoId !== id);
  scheduleSave();
}

function toggleAtivo(id) {
  const inv = data.investments.find((x) => x.id === id);
  if (!inv) return;
  inv.ativo = !inv.ativo;
  inv.updatedAt = new Date().toISOString();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// CRUD — Rendimentos
// ---------------------------------------------------------------------------

function createDividend(investimentoId, fields) {
  const now = new Date().toISOString();
  const dataPagamento = fields.dataPagamento || '';
  const [ano, mes] = dataPagamento
    ? dataPagamento.split('-').map(Number)
    : [view.yearInvestimentos, view.monthInvestimentos + 1];
  const record = {
    id: genId(),
    investimentoId,
    tipoRendimento: fields.tipoRendimento,
    valor: round2(fields.valor),
    dataPagamento,
    mesReferencia: mes,
    anoReferencia: ano,
    observacoes: fields.observacoes || '',
    createdAt: now,
    updatedAt: now,
  };
  data.dividends.push(record);
  scheduleSave();
  return record;
}

function updateDividend(id, fields) {
  const d = data.dividends.find((x) => x.id === id);
  if (!d) return null;
  Object.assign(d, fields, { valor: round2(fields.valor), updatedAt: new Date().toISOString() });
  if (d.dataPagamento) {
    const [ano, mes] = d.dataPagamento.split('-').map(Number);
    d.anoReferencia = ano;
    d.mesReferencia = mes;
  }
  scheduleSave();
  return d;
}

function deleteDividend(id) {
  data.dividends = data.dividends.filter((d) => d.id !== id);
  scheduleSave();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function shiftMonthInvestimentos(delta) {
  view.monthInvestimentos += delta;
  if (view.monthInvestimentos < 0) { view.monthInvestimentos = 11; view.yearInvestimentos--; }
  if (view.monthInvestimentos > 11) { view.monthInvestimentos = 0; view.yearInvestimentos++; }
  renderInvestments();
}

function getFilteredInvestments() {
  let list = data.investments;
  if (view.filterTipoInvestimento !== 'todos') {
    list = list.filter((i) => i.tipo === view.filterTipoInvestimento);
  }
  if (view.filterAtivoInvestimento === 'ativos') list = list.filter((i) => i.ativo);
  if (view.filterAtivoInvestimento === 'inativos') list = list.filter((i) => !i.ativo);
  const q = view.searchInvestimentos.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (i) => i.nome.toLowerCase().includes(q) || (i.ticker || '').toLowerCase().includes(q)
    );
  }
  const withCalc = list.map((inv) => ({ inv, calc: computeInvestmentValues(inv) }));
  withCalc.sort((a, b) => {
    const va = view.sortFieldInvestimentos === 'rentabilidade' ? a.calc.rentabilidade : a.calc.valorAtual;
    const vb = view.sortFieldInvestimentos === 'rentabilidade' ? b.calc.rentabilidade : b.calc.valorAtual;
    return view.sortDescInvestimentos ? vb - va : va - vb;
  });
  return withCalc;
}

function toggleDynamicFields(tipo, root = document) {
  const qty = isQuantityType(tipo);
  root.querySelectorAll('.field-qty').forEach((el) => { el.style.display = qty ? '' : 'none'; });
  root.querySelectorAll('.field-fixed').forEach((el) => { el.style.display = qty ? 'none' : ''; });
}

function renderSummaryCards() {
  const summary = getPortfolioSummary();
  const lucroClass = summary.lucroPrejuizo >= 0 ? 'green' : 'pink';
  const rendMes = getMonthlyIncome(view.yearInvestimentos, view.monthInvestimentos);
  const rendAcum = getAccumulatedIncome();

  document.getElementById('invSummaryGrid').innerHTML = `
    <div class="summary-card">
      <div class="lbl">PATRIMÔNIO INVESTIDO</div>
      <div class="val mono cyan">${money2(summary.patrimonioInvestido)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">VALOR ATUAL</div>
      <div class="val mono gold">${money2(summary.valorAtualCarteira)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">LUCRO / PREJUÍZO</div>
      <div class="val mono ${lucroClass}">${signedMoney2(summary.lucroPrejuizo)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">RENTABILIDADE</div>
      <div class="val mono ${lucroClass}">${signedPct(summary.rentabilidade)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">RENDIMENTOS DO MÊS</div>
      <div class="val mono green">${money2(rendMes)}</div>
    </div>
    <div class="summary-card">
      <div class="lbl">RENDIMENTOS ACUMULADOS</div>
      <div class="val mono green">${money2(rendAcum)}</div>
    </div>`;
}

function dividendRow(d) {
  return `
    <div class="dividend-row" data-id="${d.id}">
      <span class="mono">${fmtDate(d.dataPagamento)}</span>
      <span class="exp-cat-tag">${d.tipoRendimento}</span>
      <span class="mono green">${money2(d.valor)}</span>
      <span class="dividend-obs">${d.observacoes || ''}</span>
      <span class="exp-actions">
        <button class="del del-dividend" data-id="${d.id}">Excluir</button>
      </span>
    </div>`;
}

function investmentValuesBlock(inv, calc) {
  const lucroClass = calc.lucroPrejuizo >= 0 ? 'green' : 'pink';
  if (isQuantityType(inv.tipo)) {
    return `
      <div class="priority-values-grid mono">
        <div><span class="lbl">Quantidade</span><span class="val">${inv.quantidade}</span></div>
        <div><span class="lbl">Preço médio</span><span class="val cyan">${money2(inv.precoMedio)}</span></div>
        <div><span class="lbl">Preço atual</span><span class="val gold">${money2(inv.valorAtualUnitario)}</span></div>
        <div><span class="lbl">Investido</span><span class="val">${money2(calc.valorInvestido)}</span></div>
        <div><span class="lbl">Atual</span><span class="val">${money2(calc.valorAtual)}</span></div>
        <div><span class="lbl">Lucro/Prejuízo</span><span class="val ${lucroClass}">${signedMoney2(calc.lucroPrejuizo)}</span></div>
        <div><span class="lbl">Rentabilidade</span><span class="val ${lucroClass}">${signedPct(calc.rentabilidade)}</span></div>
      </div>`;
  }
  return `
    <div class="priority-values-grid mono">
      <div><span class="lbl">Investido</span><span class="val">${money2(calc.valorInvestido)}</span></div>
      <div><span class="lbl">Atual</span><span class="val">${money2(calc.valorAtual)}</span></div>
      <div><span class="lbl">Lucro/Prejuízo</span><span class="val ${lucroClass}">${signedMoney2(calc.lucroPrejuizo)}</span></div>
      <div><span class="lbl">Rentabilidade</span><span class="val ${lucroClass}">${signedPct(calc.rentabilidade)}</span></div>
    </div>`;
}

function investmentEditCard(inv) {
  const qty = isQuantityType(inv.tipo);
  return `
    <div class="priority-item priority-item-editing" data-id="${inv.id}">
      <div class="investment-form" data-edit-form>
        <select class="input-field" data-field="tipo">
          ${ALL_TYPES.map((t) => `<option ${t === inv.tipo ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input class="input-field" type="text" value="${inv.nome}" data-field="nome" placeholder="Nome" />
        <input class="input-field field-qty" type="text" value="${inv.ticker || ''}" data-field="ticker" placeholder="Ticker" style="${qty ? '' : 'display:none;'}" />
        <input class="input-field" type="text" value="${inv.instituicao || ''}" data-field="instituicao" placeholder="Instituição" />
        <input class="input-field field-qty mono" type="number" step="any" value="${inv.quantidade ?? ''}" data-field="quantidade" placeholder="Quantidade" style="${qty ? '' : 'display:none;'}" />
        <input class="input-field field-qty mono" type="number" step="0.01" value="${inv.precoMedio ?? ''}" data-field="precoMedio" placeholder="Preço médio" style="${qty ? '' : 'display:none;'}" />
        <input class="input-field field-qty mono" type="number" step="0.01" value="${inv.valorAtualUnitario ?? ''}" data-field="valorAtualUnitario" placeholder="Preço atual" style="${qty ? '' : 'display:none;'}" />
        <input class="input-field field-fixed mono" type="number" step="0.01" value="${inv.valorInvestido ?? ''}" data-field="valorInvestido" placeholder="Valor investido" style="${qty ? 'display:none;' : ''}" />
        <input class="input-field field-fixed mono" type="number" step="0.01" value="${inv.valorAtual ?? ''}" data-field="valorAtual" placeholder="Valor atual" style="${qty ? 'display:none;' : ''}" />
        <input class="input-field mono" type="date" value="${inv.dataPrimeiroAporte || ''}" data-field="dataPrimeiroAporte" />
        <input class="input-field" type="text" value="${inv.observacoes || ''}" data-field="observacoes" placeholder="Observações" />
        <div class="exp-actions">
          <button class="btn-primary small save-investment" data-id="${inv.id}"><span class="app-icon icon-circle-check sm"></span>Salvar</button>
          <button class="btn-ghost small cancel-investment">Cancelar</button>
        </div>
      </div>
    </div>`;
}

function investmentCard(inv) {
  const calc = computeInvestmentValues(inv);
  const isOpen = view.openInvestmentId === inv.id;
  const isAddingDividend = view.addingDividendFor === inv.id;
  const recebido = totalReceivedFor(inv.id);
  const invDividends = data.dividends
    .filter((d) => d.investimentoId === inv.id)
    .sort((a, b) => (b.dataPagamento || '').localeCompare(a.dataPagamento || ''));

  return `
    <div class="priority-item ${inv.ativo ? '' : 'investment-inactive'}" data-id="${inv.id}">
      <div class="priority-item-head">
        <div class="priority-item-title">
          <strong>${inv.nome}</strong>
          ${inv.ticker ? `<span class="mono">${inv.ticker}</span>` : ''}
          <span class="badge-nivel ${TIPO_BADGE[inv.tipo] || ''}">${inv.tipo}</span>
          <span class="badge-status ${inv.ativo ? 'badge-status-pago' : 'badge-status-pendente'}">${inv.ativo ? 'Ativo' : 'Inativo'}</span>
        </div>
        <div class="exp-actions">
          <button class="edit start-edit-investment" data-id="${inv.id}">✎</button>
          <button class="del toggle-ativo" data-id="${inv.id}" title="Ativar/Inativar">${inv.ativo ? '⏸' : '▶'}</button>
          <button class="del del-investment" data-id="${inv.id}">Excluir</button>
        </div>
      </div>
      <div class="priority-item-meta">
        ${inv.instituicao ? `<span>${inv.instituicao}</span>` : ''}
        ${inv.dataPrimeiroAporte ? `<span class="mono">desde ${fmtDate(inv.dataPrimeiroAporte)}</span>` : ''}
      </div>

      ${investmentValuesBlock(inv, calc)}

      ${inv.observacoes ? `<div class="priority-obs">${inv.observacoes}</div>` : ''}

      <div class="priority-quick-actions">
        <button class="btn-ghost small toggle-dividends" data-id="${inv.id}">
          ${isOpen ? '▲ Ocultar rendimentos' : `▼ Ver rendimentos (${money2(recebido)} recebido)`}
        </button>
        <button class="btn-ghost small start-add-dividend" data-id="${inv.id}">+ Rendimento</button>
      </div>

      ${isAddingDividend ? `
        <div class="dividend-add-form">
          <select class="input-field" data-role="divTipo">
            ${DIVIDEND_TYPES.map((t) => `<option>${t}</option>`).join('')}
          </select>
          <input class="input-field mono" type="number" step="0.01" placeholder="Valor" data-role="divValor" />
          <input class="input-field mono" type="date" data-role="divData" />
          <input class="input-field" type="text" placeholder="Observações (opcional)" data-role="divObs" />
          <button class="btn-primary small save-dividend" data-id="${inv.id}"><span class="app-icon icon-circle-check sm"></span>Salvar</button>
          <button class="btn-ghost small cancel-add-dividend">Cancelar</button>
        </div>` : ''}

      ${isOpen ? `
        <div class="dividend-history">
          <div class="dividend-history-total mono">Total recebido: <strong>${money2(recebido)}</strong></div>
          ${invDividends.length === 0
            ? '<div class="exp-empty">Nenhum rendimento registrado ainda.</div>'
            : invDividends.map(dividendRow).join('')}
        </div>` : ''}
    </div>`;
}

export function renderInvestments() {
  document.getElementById('invMonthLabel').textContent =
    `${MONTH_NAMES[view.monthInvestimentos]} ${view.yearInvestimentos}`;

  renderSummaryCards();

  const filtered = getFilteredInvestments();
  const container = document.getElementById('investmentList');

  if (filtered.length === 0) {
    container.innerHTML = '<div class="exp-empty">Nenhum investimento encontrado com esses filtros.</div>';
    return;
  }

  container.innerHTML = filtered
    .map(({ inv }) => (view.editingInvestmentId === inv.id ? investmentEditCard(inv) : investmentCard(inv)))
    .join('');

  wireCardEvents(container);
}

function wireCardEvents(container) {
  container.querySelectorAll('.start-edit-investment').forEach((b) => b.onclick = () => {
    view.editingInvestmentId = b.dataset.id;
    renderInvestments();
  });
  container.querySelectorAll('.cancel-investment').forEach((b) => b.onclick = () => {
    view.editingInvestmentId = null;
    renderInvestments();
  });
  container.querySelectorAll('.del-investment').forEach((b) => b.onclick = async () => {
    const hasDividends = data.dividends.some((d) => d.investimentoId === b.dataset.id);
    const msg = hasDividends
      ? 'Excluir este investimento também vai apagar o histórico de rendimentos ligado a ele. Continuar?'
      : 'Excluir este investimento?';
    if (!(await showConfirm(msg))) return;
    deleteInvestment(b.dataset.id);
    renderInvestments();
  });
  container.querySelectorAll('.toggle-ativo').forEach((b) => b.onclick = () => {
    toggleAtivo(b.dataset.id);
    renderInvestments();
  });
  container.querySelectorAll('.toggle-dividends').forEach((b) => b.onclick = () => {
    view.openInvestmentId = view.openInvestmentId === b.dataset.id ? null : b.dataset.id;
    renderInvestments();
  });
  container.querySelectorAll('.start-add-dividend').forEach((b) => b.onclick = () => {
    view.addingDividendFor = b.dataset.id;
    view.openInvestmentId = b.dataset.id;
    renderInvestments();
  });
  container.querySelectorAll('.cancel-add-dividend').forEach((b) => b.onclick = () => {
    view.addingDividendFor = null;
    renderInvestments();
  });
  container.querySelectorAll('.save-dividend').forEach((b) => b.onclick = async () => {
    const card = container.querySelector(`.priority-item[data-id="${b.dataset.id}"]`);
    const valor = Number(card.querySelector('[data-role="divValor"]').value);
    if (!(valor > 0)) {
      await showAlert('Informe um valor de rendimento maior que zero.');
      return;
    }
    createDividend(b.dataset.id, {
      tipoRendimento: card.querySelector('[data-role="divTipo"]').value,
      valor,
      dataPagamento: card.querySelector('[data-role="divData"]').value,
      observacoes: card.querySelector('[data-role="divObs"]').value.trim(),
    });
    view.addingDividendFor = null;
    renderInvestments();
  });
  container.querySelectorAll('.del-dividend').forEach((b) => b.onclick = async () => {
    if (!(await showConfirm('Excluir este rendimento?'))) return;
    deleteDividend(b.dataset.id);
    renderInvestments();
  });
  container.querySelectorAll('.save-investment').forEach((b) => b.onclick = () => {
    const card = container.querySelector(`.priority-item[data-id="${b.dataset.id}"] [data-edit-form]`);
    const tipo = card.querySelector('[data-field="tipo"]').value;
    updateInvestment(b.dataset.id, {
      tipo,
      nome: card.querySelector('[data-field="nome"]').value.trim(),
      ticker: card.querySelector('[data-field="ticker"]').value.trim(),
      instituicao: card.querySelector('[data-field="instituicao"]').value.trim(),
      quantidade: card.querySelector('[data-field="quantidade"]').value,
      precoMedio: card.querySelector('[data-field="precoMedio"]').value,
      valorAtualUnitario: card.querySelector('[data-field="valorAtualUnitario"]').value,
      valorInvestido: card.querySelector('[data-field="valorInvestido"]').value,
      valorAtual: card.querySelector('[data-field="valorAtual"]').value,
      dataPrimeiroAporte: card.querySelector('[data-field="dataPrimeiroAporte"]').value,
      observacoes: card.querySelector('[data-field="observacoes"]').value.trim(),
    });
    view.editingInvestmentId = null;
    renderInvestments();
  });
  container.querySelectorAll('[data-edit-form] [data-field="tipo"]').forEach((sel) => sel.onchange = (e) => {
    toggleDynamicFields(e.target.value, sel.closest('[data-edit-form]'));
  });
}

export function initInvestments() {
  document.getElementById('prevMonthInvestimentos').onclick = () => shiftMonthInvestimentos(-1);
  document.getElementById('nextMonthInvestimentos').onclick = () => shiftMonthInvestimentos(1);

  document.getElementById('invFilterTipo').onchange = (e) => {
    view.filterTipoInvestimento = e.target.value;
    renderInvestments();
  };
  document.getElementById('invFilterAtivo').onchange = (e) => {
    view.filterAtivoInvestimento = e.target.value;
    renderInvestments();
  };
  document.getElementById('invSearch').oninput = (e) => {
    view.searchInvestimentos = e.target.value;
    renderInvestments();
  };
  document.getElementById('invSortField').onchange = (e) => {
    view.sortFieldInvestimentos = e.target.value;
    renderInvestments();
  };
  document.getElementById('invSortDirBtn').onclick = () => {
    view.sortDescInvestimentos = !view.sortDescInvestimentos;
    document.getElementById('invSortDirBtn').textContent = view.sortDescInvestimentos ? '↓' : '↑';
    renderInvestments();
  };

  const tipoSelect = document.getElementById('invTipo');
  tipoSelect.onchange = (e) => toggleDynamicFields(e.target.value);
  toggleDynamicFields(tipoSelect.value);

  document.getElementById('addInvestmentBtn').onclick = async () => {
    const nome = document.getElementById('invNome').value.trim();
    const tipo = tipoSelect.value;
    if (!nome) {
      await showAlert('Informe o nome do investimento.');
      document.getElementById('invNome').focus();
      return;
    }
    if (isQuantityType(tipo)) {
      const quantidade = Number(document.getElementById('invQuantidade').value);
      if (!quantidade) {
        await showAlert('Informe a quantidade.');
        document.getElementById('invQuantidade').focus();
        return;
      }
    } else {
      const valorInvestido = Number(document.getElementById('invValorInvestido').value);
      if (!valorInvestido) {
        await showAlert('Informe o valor investido.');
        document.getElementById('invValorInvestido').focus();
        return;
      }
    }

    createInvestment({
      nome,
      tipo,
      ticker: document.getElementById('invTicker').value.trim(),
      instituicao: document.getElementById('invInstituicao').value.trim(),
      quantidade: document.getElementById('invQuantidade').value,
      precoMedio: document.getElementById('invPrecoMedio').value,
      valorAtualUnitario: document.getElementById('invValorAtualUnitario').value,
      valorInvestido: document.getElementById('invValorInvestido').value,
      valorAtual: document.getElementById('invValorAtual').value,
      dataPrimeiroAporte: document.getElementById('invData').value,
      observacoes: document.getElementById('invObs').value.trim(),
    });

    ['invNome', 'invTicker', 'invInstituicao', 'invQuantidade', 'invPrecoMedio',
      'invValorAtualUnitario', 'invValorInvestido', 'invValorAtual', 'invData', 'invObs']
      .forEach((id) => { document.getElementById(id).value = ''; });

    renderInvestments();
  };

  renderInvestments();
}
