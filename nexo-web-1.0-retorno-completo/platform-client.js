// Adapter de plataforma do cliente desktop.
// O restante do renderer fala com este contrato, não diretamente com Electron.
// No mobile haverá outro adapter com os mesmos métodos, apontando para Supabase/
// armazenamento móvel em vez de window.ganhosApp.

function bridge() {
  if (!window.ganhosApp) throw new Error('Bridge da plataforma indisponível.');
  return window.ganhosApp;
}

export const platformClient = {
  loadData: () => bridge().loadData(),
  saveData: (data) => bridge().saveData(data),
  syncNow: (data) => bridge().syncNow(data),
  pushCentralChanges: (data) => bridge().pushCentralChanges(data),

  authStatus: () => bridge().authStatus(),
  loginGoogle: () => bridge().login(),
  logoutGoogle: () => bridge().logout(),
  readLegacyDashboard: () => bridge().readDashboard(),
  saveSimulation: (row) => bridge().saveSimulation(row),

  selectProfileImage: (profileId) => bridge().selectProfileImage(profileId),

  getSyncConfig: () => bridge().getSyncConfig(),
  saveSyncConfig: (config) => bridge().saveSyncConfig(config),
  generateSyncFamily: () => bridge().generateSyncFamily(),
  testCentralSync: () => bridge().testCentralSync(),
};
