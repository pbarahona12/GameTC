import { dismissCelebration } from './engine/saga/chronicle';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/fonts.css';
import './ui/theme.css';
import { App } from './ui/App';
import { store } from './ui/store';
import { otaBoot, markHealthy, failBoot, autoCheck } from './persistence/ota';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { navStore } from './ui/nav';
import { installGlobalErrorLog } from './persistence/errorLog';
import { installOpenWith } from './ui/openWith';

// Registro local de errores (Ajustes → Guardado y copias): nunca sale del dispositivo solo.
installGlobalErrorLog(() => store.getSnapshot().state?.day);

// Arranque: primero se revisa si esta página es una actualización recién instalada
// (para poder volver atrás si falla), después se carga la partida.
void (async () => {
  try {
    await otaBoot();
  } catch {
    /* sin actualizaciones: se sigue normalmente */
  }
  await store.boot();
  const ui = store.getSnapshot();
  if (!ui.state && ui.bootError) failBoot('La versión nueva no pudo leer la partida.');
  else requestAnimationFrame(() => markHealthy(() => void store.onUpdateConfirmed()));
  if (store.getSnapshot().settings.autoUpdate !== false) setTimeout(() => void autoCheck(), 4000);
  // «Abrir con…» desde WhatsApp, Archivos o Drive (después de cargar la partida).
  void installOpenWith();
})();

// Botón "atrás" de Android: hoja de arriba → hoja anterior → lugar anterior → Inicio → guarda y minimiza.
void import('@capacitor/core').then(async ({ Capacitor }) => {
  if (!Capacitor.isNativePlatform()) return;
  const { App: CapApp } = await import('@capacitor/app');
  CapApp.addListener('backButton', () => {
    const ui = store.getSnapshot();
    const cel = ui.state?.saga?.celebrations[0];
    if (cel?.size === 'big') store.quick((st) => dismissCelebration(st, cel.id));
    else if (ui.simError) store.dismissSimError();
    else if (ui.absence) store.dismissAbsence();
    else if (ui.monthReport) store.closeMonthReport();
    else if (ui.incomingImport) store.dismissIncomingImport();
    else if (!navStore.back()) void store.save().then(() => CapApp.minimizeApp());
  });
  // Segundo plano: pausa y guarda; al volver, la ausencia se simula sin dejar vencer decisiones.
  CapApp.addListener('pause', () => store.enterBackground());
  CapApp.addListener('resume', () => void store.resumeFromBackground());
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
