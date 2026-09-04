// Sidebar / roteamento entre telas (Fase 2B). Cada tela é um <div class="screen"
// id="screen-X"> dentro do main-content; o router só mostra uma por vez e marca
// o item ativo na sidebar. Telas ainda sem módulo próprio (Movimentos, Cartões,
// Prioridades, Investir, Viagens, Dívidas, Calendário, Relatórios, Configurações)
// mostram um aviso "chega na Fase X" — implementação vem nas próximas fases.

const SCREEN_TITLES = {
  overview: 'Visão Geral',
  movimentos: 'Movimentos',
  uber: 'Uber',
  cartoes: 'Cartões',
  prioridades: 'Prioridades',
  investir: 'Investir',
  viagens: 'Viagens',
  dividas: 'Dívidas',
  calendario: 'Calendário',
  relatorios: 'Relatórios',
  sim: 'Simulador',
  saidas: 'Saídas',
  config: 'Configurações',
  profile: 'Perfil',
};

let onNavigate = null;
let currentScreenId = 'overview';

function showScreen(screenId) {
  currentScreenId = screenId;
  document.querySelectorAll('.screen').forEach((el) => {
    el.style.display = el.id === `screen-${screenId}` ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-item, .sidebar-profile-card').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === screenId);
  });
  const titleEl = document.getElementById('screenTitle');
  if (titleEl) titleEl.textContent = SCREEN_TITLES[screenId] || '';
  if (onNavigate) onNavigate(screenId);
}

// navigateCallback(screenId) é chamado toda vez que o usuário troca de tela —
// usado hoje só pra aba Saídas se re-renderizar ao ser aberta.
export function initRouter(navigateCallback) {
  onNavigate = navigateCallback;
  document.querySelectorAll('.nav-item, .sidebar-profile-card').forEach((btn) => {
    btn.onclick = () => showScreen(btn.dataset.screen);
  });
  showScreen('overview');
}

export function refreshCurrentScreen() {
  if (onNavigate) onNavigate(currentScreenId);
}
