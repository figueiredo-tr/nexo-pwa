// Substitui window.alert()/window.confirm() por um modal 100% em HTML.
//
// MOTIVO: no Windows, o alert()/confirm() nativo do Electron (que passa por
// uma chamada síncrona pro processo principal pra desenhar a caixinha do
// sistema operacional) às vezes faz a JANELA em si perder o foco depois de
// fechar — não é um campo específico, é a janela inteira que some do foco
// do SO. Resultado: nenhum clique/tecla funciona até o usuário clicar em
// outro lugar da janela (barra de título, etc). Um modal desenhado dentro
// da própria página evita isso porque nunca sai do contexto do renderer —
// não existe chamada síncrona nem diálogo nativo envolvido.
//
// Usado por Prioridades e Investimentos (onde o bug foi reportado). Se
// aparecer em Saídas/Simulador também, é o mesmo padrão de troca.

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'ui-dialog-overlay';
  const box = document.createElement('div');
  box.className = 'ui-dialog-box';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  return { overlay, box };
}

export function showAlert(message) {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();
    box.innerHTML = `
      <div class="ui-dialog-message">${message}</div>
      <div class="ui-dialog-actions">
        <button class="btn-primary small" data-role="ok">OK</button>
      </div>`;
    const close = () => { overlay.remove(); resolve(); };
    box.querySelector('[data-role="ok"]').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    box.querySelector('[data-role="ok"]').focus();
  });
}

export function showConfirm(message) {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();
    box.innerHTML = `
      <div class="ui-dialog-message">${message}</div>
      <div class="ui-dialog-actions">
        <button class="btn-ghost small" data-role="cancel">Cancelar</button>
        <button class="btn-primary small" data-role="confirm">Confirmar</button>
      </div>`;
    const close = (result) => { overlay.remove(); resolve(result); };
    box.querySelector('[data-role="cancel"]').onclick = () => close(false);
    box.querySelector('[data-role="confirm"]').onclick = () => close(true);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    box.querySelector('[data-role="confirm"]').focus();
  });
}


export function showDatePrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const { overlay, box } = buildOverlay();
    box.innerHTML = `
      <div class="ui-dialog-message">${message}</div>
      <div style="margin-top:12px;">
        <input class="input-field" type="date" data-role="date" value="${defaultValue}" style="width:100%;box-sizing:border-box;" />
      </div>
      <div class="ui-dialog-actions">
        <button class="btn-ghost small" data-role="cancel">Cancelar</button>
        <button class="btn-primary small" data-role="confirm">Confirmar</button>
      </div>`;
    const input = box.querySelector('[data-role="date"]');
    const close = (result) => { overlay.remove(); resolve(result); };
    box.querySelector('[data-role="cancel"]').onclick = () => close(null);
    box.querySelector('[data-role="confirm"]').onclick = () => close(input.value || null);
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value || null);
      if (e.key === 'Escape') close(null);
    });
    input.focus();
  });
}
