// Orquestrador do renderer (Fase 2B). Inicializa cada módulo na ordem certa
// e liga o router da sidebar. Lógica de negócio continua toda nos módulos.

import { initData, refreshFromCentral } from './state.js';
import { initRouter, refreshCurrentScreen } from './router.js';
import { initConnection } from './connection.js';
import { initDashboard, renderDashboard } from './dashboard.js';
import { initSimulator } from './simulator.js';
import { initExpenses, renderExpenses } from './expenses.js';
import { initPriorities, renderPriorities } from './priorities.js';
import { initInvestments, renderInvestments } from './investments.js';
import { initTrips, renderTrips } from './trips.js';
import { initDebts, renderDebts } from './debts.js';
import { initUber, renderUber } from './uber.js';
import { initMovements, renderMovements } from './movements.js';
import { initCards, renderCards } from './cards.js';
import { initCalendar, renderCalendar } from './calendar.js';
import { initReports, renderReports } from './reports.js';
import { initSettings, renderSettings } from './settings.js';
import { initProfile, renderProfile } from './profile.js';

(async function init() {
  await initData();
  initDashboard();
  initConnection(); // dispara a 1ª leitura da planilha (via dashboard.js)
  initSimulator();
  initExpenses();
  initPriorities();
  initInvestments();
  initTrips();
  initDebts();
  initUber();
  initMovements();
  initCards();
  initCalendar();
  initReports();
  initSettings();
  initProfile();


  // Nexo Web: sidebar responsiva no celular, sem transformar a interface em app.
  const sidebar=document.querySelector('.sidebar');
  const backdrop=document.getElementById('sidebarBackdrop');
  const closeMenu=()=>{sidebar?.classList.remove('mobile-open');backdrop?.classList.remove('show');};
  document.getElementById('mobileMenuBtn')?.addEventListener('click',()=>{sidebar?.classList.toggle('mobile-open');backdrop?.classList.toggle('show');});
  backdrop?.addEventListener('click',closeMenu);
  document.querySelectorAll('.sidebar [data-screen]').forEach(b=>b.addEventListener('click',()=>{if(window.innerWidth<=860)closeMenu();}));

  initRouter((screenId) => {
    if (screenId === 'overview') renderDashboard();
    if (screenId === 'movimentos') renderMovements();
    if (screenId === 'uber') renderUber();
    if (screenId === 'cartoes') renderCards();
    if (screenId === 'saidas') renderExpenses();
    if (screenId === 'prioridades') renderPriorities();
    if (screenId === 'investir') renderInvestments();
    if (screenId === 'viagens') renderTrips();
    if (screenId === 'dividas') renderDebts();
    if (screenId === 'calendario') renderCalendar();
    if (screenId === 'relatorios') renderReports();
    if (screenId === 'config') renderSettings();
    if (screenId === 'profile') renderProfile();
  });

  // Fase 13F.1: ao voltar para a janela do desktop, busca alterações feitas
  // no celular. Evita polling agressivo e não interrompe formulários enquanto
  // o usuário está trabalhando no computador.
  let lastFocusSync = 0;
  window.addEventListener('focus', async () => {
    const now = Date.now();
    if (now - lastFocusSync < 3000) return;
    lastFocusSync = now;
    const changed = await refreshFromCentral();
    const editing = document.activeElement?.matches?.('input, textarea, select');
    if (changed && !editing) refreshCurrentScreen();
  });
})();
