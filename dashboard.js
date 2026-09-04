// Visão Geral — Fase 5.5C.
// A área principal agora usa dados REAIS locais (Uber + outras entradas + Saídas)
// e mantém o bloco da planilha antiga como referência/conexão, sem misturar
// números simulados com realizados.

import {
  MONTH_NAMES, view, data, currency, scheduleSave,
  realIncomeSummary, expensesForMonth, prioritiesForMonth, uberFinancialSummary,
} from './state.js';
import { recalc } from './simulator.js';
import { getPortfolioSummary, getMonthlyIncome } from './investments.js';
import { getTripsSummary } from './trips.js';
import { platformClient } from './platform-client.js';

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

function getMonthMovementPoints(y,m){
  const days=new Date(y,m+1,0).getDate(); const daily=Array.from({length:days},()=>({income:0,expense:0}));
  const mk=`${y}-${String(m+1).padStart(2,'0')}`;
  for(const e of data.uberEntries||[]){if(e.active===false||!String(e.date||'').startsWith(mk))continue;const d=Number(String(e.date).slice(8,10));if(d>=1&&d<=days){daily[d-1].income+=Number(e.value)||0;daily[d-1].expense+=Number(e.fuelExpense)||0;}}
  for(const e of data.incomes||[]){const date=e.date||e.data||'';if(!String(date).startsWith(mk))continue;const d=Number(String(date).slice(8,10));if(d>=1&&d<=days)daily[d-1].income+=Number(e.value??e.valor)||0;}
  for(const e of data.expenses||[]){const date=e.date||e.data||'';if(!String(date).startsWith(mk))continue;const d=Number(String(date).slice(8,10));if(d>=1&&d<=days)daily[d-1].expense+=Number(e.value??e.valor)||0;}
  let acc=0;const realized=daily.map(x=>{acc+=x.income-x.expense;return round2(acc)});
  const current=(new Date().getFullYear()===y&&new Date().getMonth()===m)?new Date().getDate():days;
  const upto=Math.max(1,Math.min(days,current));const trend=realized[upto-1]||0; const average=trend/upto;
  const forecast=realized.map((v,i)=>i<upto?v:round2(trend+average*(i+1-upto)));
  return {realized,forecast,upto,days};
}
function renderEvolutionChart(){
  const el=document.getElementById('overviewEvolutionChart'); if(!el)return;
  const p=getMonthMovementPoints(view.yearOverview,view.monthOverview); const vals=[...p.realized.slice(0,p.upto),...p.forecast]; const min=Math.min(0,...vals),max=Math.max(0,...vals); const range=max-min||1; const W=760,H=230,pad=24;
  const x=i=>pad+(W-pad*2)*(i/Math.max(1,p.days-1)); const y=v=>H-pad-(H-pad*2)*((v-min)/range);
  const realizedPoints=p.realized.slice(0,p.upto).map((v,i)=>`${x(i)},${y(v)}`).join(' '); const forecastPoints=p.forecast.slice(Math.max(0,p.upto-1)).map((v,j)=>`${x(j+Math.max(0,p.upto-1))},${y(v)}`).join(' ');
  const grid=[0,.25,.5,.75,1].map(t=>{const yy=pad+(H-pad*2)*t;const val=max-range*t;return `<line x1="${pad}" y1="${yy}" x2="${W-pad}" y2="${yy}" class="chart-grid"/><text x="${pad+2}" y="${yy-5}" class="chart-axis">${currency(val)}</text>`}).join('');
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução financeira mensal">${grid}<polyline class="chart-realized" points="${realizedPoints}"/><polyline class="chart-forecast" points="${forecastPoints}"/></svg>`;
  const bal=p.realized[Math.max(0,p.upto-1)]||0; const b=document.getElementById('overviewChartBalance'); if(b){b.textContent=currency(bal);b.className=`mono overview-chart-balance ${bal>=0?'green':'pink'}`;}
}
function renderCategoryChart(){
  const el=document.getElementById('overviewCategoryChart');if(!el)return;const mk=`${view.yearOverview}-${String(view.monthOverview+1).padStart(2,'0')}`;const map={};
  for(const e of data.expenses||[]){const date=e.date||e.data||'';if(!String(date).startsWith(mk))continue;const k=e.category||e.categoria||'Outros';map[k]=(map[k]||0)+(Number(e.value??e.valor)||0)}
  for(const e of data.uberEntries||[]){if(e.active===false||!String(e.date||'').startsWith(mk)||!(Number(e.fuelExpense)>0))continue;map['Combustível']=(map['Combustível']||0)+Number(e.fuelExpense)}
  const entries=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,6),total=entries.reduce((s,x)=>s+x[1],0);if(!total){el.innerHTML='<div class="empty-chart">Sem saídas neste mês.</div>';return;}
  const stops=[];let acc=0;const palette=['var(--cyan)','var(--pink)','var(--gold)','var(--purple)','var(--orange)','var(--green)'];entries.forEach(([k,v],i)=>{const a=acc/total*100;acc+=v;const b=acc/total*100;stops.push(`${palette[i]} ${a}% ${b}%`)});
  el.innerHTML=`<div class="donut" style="background:conic-gradient(${stops.join(',')})"><div class="donut-hole"><strong>${currency(total)}</strong><span>saídas</span></div></div><div class="category-legend">${entries.map(([k,v],i)=>`<div><i style="background:${palette[i]}"></i><span>${k}</span><strong>${currency(v)}</strong></div>`).join('')}</div>`;
}


export function getOverviewSummary(y = view.yearOverview, m = view.monthOverview) {
  const income = realIncomeSummary(y, m);
  const uber = uberFinancialSummary(y, m);
  const regularExpenses = round2(expensesForMonth(y, m).reduce((s, e) => s + (Number(e.value) || 0), 0));
  // Combustível lançado na aba Uber é uma saída real, mas não é duplicado em data.expenses.
  const expenses = round2(regularExpenses + uber.fuel);
  const result = round2(income.total - expenses);
  const monthPriorities = prioritiesForMonth(y, m);
  const prioritiesPending = round2(monthPriorities.reduce((sum, p) =>
    sum + Math.max((Number(p.valorPrevisto) || 0) - (Number(p.valorPago) || 0), 0), 0));
  const afterPriorities = round2(result - prioritiesPending);
  // Valor separado no Uber é compromisso/reserva, não despesa. Reduz o dinheiro livre.
  const afterUberReserve = round2(afterPriorities - uber.reserved);
  const investPercent = Number(data.settings?.investPercent) || 0;
  const plannedInvestment = afterUberReserve > 0 ? round2(afterUberReserve * (investPercent / 100)) : 0;
  const freeForReal = round2(afterUberReserve - plannedInvestment);
  return {
    uber: round2(income.uber), uberFuel: uber.fuel, uberReserved: uber.reserved,
    uberAvailable: uber.available, otherIncome: round2(income.other), totalIncome: round2(income.total),
    regularExpenses, expenses, result, prioritiesPending, afterPriorities, afterUberReserve,
    plannedInvestment, freeForReal, investPercent,
  };
}

function shiftOverviewMonth(delta) {
  view.monthOverview += delta;
  if (view.monthOverview < 0) { view.monthOverview = 11; view.yearOverview--; }
  if (view.monthOverview > 11) { view.monthOverview = 0; view.yearOverview++; }
  renderDashboard();
}

export function renderDashboard() {
  const label = document.getElementById('overviewMonthLabel');
  if (!label) return;
  label.textContent = `${MONTH_NAMES[view.monthOverview]} ${view.yearOverview}`;

  const s = getOverviewSummary();
  const portfolio = getPortfolioSummary();
  const yields = getMonthlyIncome(view.yearOverview, view.monthOverview);
  const activeTripList = data.trips.filter((t) => t.status === 'Planejada' || t.status === 'Em andamento');
  const trips = getTripsSummary(activeTripList);
  renderEvolutionChart();
  renderCategoryChart();

  document.getElementById('overviewMainGrid').innerHTML = [
    ['ENTRADAS REAIS', s.totalIncome, 'green'],
    ['SAÍDAS REAIS', -s.expenses, 'pink'],
    ['SEPARADO UBER', -s.uberReserved, s.uberReserved > 0 ? 'gold' : 'green'],
    ['RESULTADO DO MÊS', s.result, s.result >= 0 ? 'cyan' : 'pink'],
    ['PRIORIDADES PENDENTES', -s.prioritiesPending, s.prioritiesPending > 0 ? 'gold' : 'green'],
    [`INVESTIMENTO PLANEJADO (${s.investPercent}%)`, -s.plannedInvestment, 'orange'],
    ['LIVRE DE VERDADE', s.freeForReal, s.freeForReal >= 0 ? 'purple' : 'pink'],
  ].map(([name, value, color]) => `<div class="summary-card overview-hero-card"><div class="lbl">${name}</div><div class="val mono ${color}">${currency(value)}</div></div>`).join('');

  document.getElementById('overviewIncomeBreakdown').innerHTML = `
    <div class="overview-break-row"><span>Uber — faturamento bruto</span><strong class="mono cyan">${currency(s.uber)}</strong></div>
    <div class="overview-break-row"><span>Combustível Uber</span><strong class="mono pink">-${currency(s.uberFuel)}</strong></div>
    <div class="overview-break-row"><span>Separado no Uber</span><strong class="mono gold">-${currency(s.uberReserved)}</strong></div>
    <div class="overview-break-row"><span>Uber disponível após combustível + separado</span><strong class="mono ${s.uberAvailable >= 0 ? 'green' : 'pink'}">${currency(s.uberAvailable)}</strong></div>
    <div class="overview-break-row"><span>Outros trabalhos/entradas</span><strong class="mono green">${currency(s.otherIncome)}</strong></div>
    <div class="overview-break-row total"><span>Total de entradas brutas reais</span><strong class="mono green">${currency(s.totalIncome)}</strong></div>`;

  const formula = document.getElementById('overviewFormula');
  formula.innerHTML = `
    <div class="overview-formula-row"><span>Resultado do mês</span><strong class="mono">${currency(s.result)}</strong></div>
    <div class="overview-formula-row"><span>− Prioridades ainda necessárias</span><strong class="mono gold">${currency(s.prioritiesPending)}</strong></div>
    <div class="overview-formula-row"><span>= Após prioridades</span><strong class="mono cyan">${currency(s.afterPriorities)}</strong></div>
    <div class="overview-formula-row"><span>− Separado no Uber</span><strong class="mono gold">${currency(s.uberReserved)}</strong></div>
    <div class="overview-formula-row"><span>= Após valor separado</span><strong class="mono cyan">${currency(s.afterUberReserve)}</strong></div>
    <div class="overview-formula-row"><span>− Investimento planejado (${s.investPercent}%)</span><strong class="mono orange">${currency(s.plannedInvestment)}</strong></div>
    <div class="overview-formula-row final"><span>= LIVRE DE VERDADE</span><strong class="mono ${s.freeForReal >= 0 ? 'purple' : 'pink'}">${currency(s.freeForReal)}</strong></div>`;

  document.getElementById('overviewModuleGrid').innerHTML = [
    ['PATRIMÔNIO INVESTIDO', portfolio.valorAtualCarteira, 'orange', 'valor atual dos investimentos ativos'],
    ['RENDIMENTOS DO MÊS', yields, 'green', 'dividendos, JCP e rendimentos registrados'],
    ['VIAGENS RESERVADO', trips.totalReserved, 'cyan', `${trips.activeTrips} viagem(ns) ativa(s)`],
    ['VIAGENS A COBRIR', trips.totalRemaining, 'gold', 'quanto ainda falta para os orçamentos'],
  ].map(([name, value, color, note]) => `<div class="summary-card"><div class="lbl">${name}</div><div class="val mono ${color}">${currency(value)}</div><div class="overview-card-note">${note}</div></div>`).join('');
}

export async function loadSheetSummary(loggedIn) {
  const panel = document.getElementById('sheetPanel');
  if (loggedIn === undefined) {
    const status = await platformClient.authStatus();
    loggedIn = status.loggedIn;
  }
  panel.style.display = loggedIn ? 'block' : 'none';
  if (!loggedIn) return;

  const res = await platformClient.readLegacyDashboard();
  if (!res.ok) { alert('Erro ao ler a planilha: ' + res.error); return; }
  const d = res.data;
  document.getElementById('sSaldo').textContent = currency(d.saldoConta || 0);
  document.getElementById('sEntradas').textContent = currency(d.entradasMes || 0);
  document.getElementById('sSaidas').textContent = currency(d.saidasMes || 0);
  document.getElementById('sParcela').textContent = currency(d.proximaParcelaCarro || 0);
  document.getElementById('sInvestido').textContent = currency(d.investidoTotal || 0);

  if (d.valorParcelaCarro) {
    data.carInstallment = d.valorParcelaCarro;
    const carLabel = document.getElementById('carValueLabel');
    if (carLabel) carLabel.textContent = currency(d.valorParcelaCarro);
    scheduleSave();
  }
  recalc();
}

export function initDashboard() {
  document.getElementById('refreshBtn').onclick = () => loadSheetSummary();
  document.getElementById('prevMonthOverview').onclick = () => shiftOverviewMonth(-1);
  document.getElementById('nextMonthOverview').onclick = () => shiftOverviewMonth(1);
  renderDashboard();
}
