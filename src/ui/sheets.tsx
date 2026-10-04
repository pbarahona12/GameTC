import { ageOf } from '../engine/saga/life';
import { Fragment, ReactNode, useEffect, useState } from 'react';
import { navStore, useNav, SheetSpec } from './nav';
import { store, useUI, useGame, useDerived } from './store';
import { insightsOf, stageOf } from './derived';
import { GLOSSARY, GLOSSARY_BY_ID, GlossaryEntry } from '../content/glossary';
import { CATEGORY_NAMES, Insight, AdvisorCategory } from '../engine/advisor/advisor';
import { DIFFICULTIES, DIFFICULTY_BY_ID } from '../engine/economy/difficulty';
import type { PauseCategory } from './store';
import { runScenario, ScenarioInput, ScenarioResult } from '../engine/advisor/scenarios';
import { STAGES, ACHIEVEMENTS } from '../engine/progression/progression';
import { sectionsFromStage } from '../engine/progression/unlocks';
import { TUTORIAL, CHAPTERS, nextMission, isMissionDone, missionProgress } from '../engine/progression/tutorial';
import { SKILL_BY_ID } from '../content/skills';
import { LIFESTYLES } from '../content/lifestyle';
import { BANKS, BANK_BY_ID } from '../content/banks';
import { fmtMoney } from '../engine/format';
import { usd } from '../engine/money';
import { formatDate } from '../engine/time/calendar';
import { Sheet, SheetLayer, Pill, Seg, Bar, LineChart, Legend, AmountInput, ConfirmButton, Empty, InfoButton, Switch } from './components/common';
import { Icon, IconName } from './icons';
import { Avatar, avatarOf } from './components/Avatar';
import { SlotList, SavedAgo, agoText, useNow, LastExport } from './components/Slots';
import { ErrorBoundary } from './components/ErrorBoundary';
import { IllegalToggle } from './components/IllegalToggle';
import { APP_VERSION } from '../version';
import { LEGAL, PRIVACY, TERMS, LICENSES } from '../content/legal';
import { AD_REWARDS, STUDY_SKIP_DAYS, DEBT_ADS_NEEDED, adRewardsLeft, cashRewardAmount, debtCutAmount, grantAdReward, reducibleLoans, skippableCourses, type AdRewardKind } from '../engine/rewards';
import { COURSE_BY_ID } from '../content/courses';
import { showRewardedAd, todayKey, ADS_LIVE } from './ads';
import { applyUpdate, checkForUpdate, OTA_REPO, dismissUpdateNotes } from '../persistence/ota';
import { useOta } from './useOta';
import { LogRow } from './screens/Home';
import { CHAPTER_ICON } from './contentIcons';
import { GoalsView, DilemmaSheet, AgendaSheet, ChronicleView, ChallengesView, ExplainView, LifeView } from './screens/saga/sagaSheets';
import { playTone } from './feedback';

/** Bloque de una ficha del glosario (no se muestra si el campo está vacío). */
function TermBlock({ t, v }: { t: string; v?: string }) {
  return v ? <div className="stack" style={{ gap: 2 }}><span className="eyebrow">{t}</span><p className="small">{v}</p></div> : null;
}

function TermView({ id }: { id: string }) {
  const g = GLOSSARY_BY_ID[id];
  useEffect(() => store.markSeen(id), [id]);
  if (!g) return <Sheet title="Término">No encontrado.</Sheet>;
  return (
    <Sheet title={g.term}>
      <Pill tone="neutral">{g.category}</Pill>
      <p style={{ fontSize: 16, fontWeight: 600 }}>{g.short}</p>
      <TermBlock t="Para qué sirve" v={g.purpose} />
      {g.formula && <div className="stack" style={{ gap: 2 }}><span className="eyebrow">Cómo se calcula</span><p className="num small" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>{g.formula}</p></div>}
      <TermBlock t="Ejemplo" v={g.example} />
      <TermBlock t="Cómo te afecta" v={g.impact} />
      <TermBlock t="Riesgos" v={g.risks} />
      <TermBlock t="Errores comunes" v={g.mistakes} />
      <TermBlock t="Diferencia con conceptos parecidos" v={g.versus} />
      <TermBlock t="Consejo" v={g.tip} />
      <button className="btn ghost" onClick={() => navStore.open({ kind: 'glossary' })}>Abrir el glosario completo</button>
    </Sheet>
  );
}

function GlossaryView() {
  const [q, setQ] = useState('');
  const ui = useUI();
  const seen = ui.state?.meta.seenTerms ?? [];
  const list = GLOSSARY.filter((g) => !q || (g.term + ' ' + g.short).toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, GlossaryEntry[]>();
  for (const g of list) groups.set(g.category, [...(groups.get(g.category) ?? []), g]);
  return (
    <Sheet title="Glosario financiero">
      <input className="input" id="glossary-q" placeholder="Buscar término (ej.: liquidez, deducción)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <p className="tiny muted">{GLOSSARY.length} términos · {seen.length} consultados</p>
      {[...groups.entries()].map(([cat, items]) => (
        <div key={cat} className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{cat}</span>
          <div className="card" style={{ paddingBlock: 4 }}>
            <div className="rows">
              {items.map((g) => (
                <button key={g.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left' }} onClick={() => navStore.open({ kind: 'term', id: g.id })}>
                  <div className="grow"><div className="title small">{g.term} {!seen.includes(g.id) && <Pill tone="accent">nuevo</Pill>}</div><div className="meta">{g.short}</div></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {list.length === 0 && <Empty icon="search">Sin resultados para “{q}”.</Empty>}
    </Sheet>
  );
}

function InsightCard({ i, open, onToggle }: { i: Insight; open: boolean; onToggle: () => void }) {
  const tone = i.severity === 'critical' ? 'loss' : i.severity === 'warning' ? 'warn' : i.severity === 'opportunity' ? 'gain' : 'info';
  const label = { critical: 'Crítico', warning: 'Advertencia', opportunity: 'Oportunidad', info: 'Información' }[i.severity];
  return (
    <div className={`alert ${i.severity}`} style={{ flexDirection: 'column', gap: 8 }}>
      <button onClick={onToggle} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }} aria-expanded={open}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Pill tone={tone}>{label}</Pill><span className="tiny muted">{CATEGORY_NAMES[i.category]}</span></span>
        <strong>{i.title}</strong>
        <span className="small">{i.what}</span>
      </button>
      {open && (
        <div className="stack small" style={{ gap: 8 }}>
          <div><span className="eyebrow">Por qué ocurre</span><p>{i.why}</p></div>
          <div>
            <span className="eyebrow">Datos</span>
            <div className="kv" style={{ marginTop: 4 }}>
              {i.data.map((d) => (
                <Fragment key={d.label}><dt>{d.label} <Pill tone={d.kind === 'hecho' ? 'neutral' : 'info'}>{d.kind}</Pill></dt><dd>{d.value}</dd></Fragment>
              ))}
            </div>
          </div>
          <div><span className="eyebrow">Consecuencias</span><p>{i.consequence}</p></div>
          {i.timeframe && <div><span className="eyebrow">Plazo estimado</span><p>{i.timeframe}</p></div>}
          {i.uncertainty && <p className="tiny muted">{i.uncertainty}</p>}
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">Opciones (recomendaciones)</span>
            {i.options.map((o) => (
              <div key={o.label} className="card flat" style={{ padding: 10, gap: 4 }}>
                <strong>{o.label}</strong>
                <span className="gain">+ {o.pros}</span>
                <span className="loss">− {o.cons}</span>
                {o.tab && <button className="btn sm" onClick={() => navStore.go(o.tab!, o.sub)}>Ir</button>}
              </div>
            ))}
          </div>
          <div><span className="eyebrow">Si no hacés nada</span><p>{i.ifNothing}</p></div>
          {i.term && <span className="tiny">Concepto relacionado <InfoButton term={i.term} /></span>}
        </div>
      )}
    </div>
  );
}

type ScenKind = 'save_monthly' | 'lifestyle' | 'loan' | 'deposit' | 'quit_job' | 'pension' | 'recession' | 'rate_shock' | 'market_crash' | 'buy_property' | 'sell_portfolio';

function Scenarios() {
  const s = useGame();
  const [kind, setKind] = useState<ScenKind>('save_monthly');
  const [amount, setAmount] = useState(usd(200));
  const [lifestyle, setLifestyle] = useState(LIFESTYLES[0].id);
  const [bank, setBank] = useState(BANKS[1].id);
  const [months, setMonths] = useState(12);
  const [res, setRes] = useState<ScenarioResult | null>(null);
  const [pct, setPct] = useState(30);
  const [listing, setListing] = useState<number | null>(s.realEstate.listings[0]?.id ?? null);
  const run = () => {
    let input: ScenarioInput;
    switch (kind) {
      case 'save_monthly': input = { kind, amount }; break;
      case 'lifestyle': input = { kind, lifestyle }; break;
      case 'loan': input = { kind, bankId: bank, amount, termMonths: 24 }; break;
      case 'deposit': input = { kind, amount, termMonths: 12 }; break;
      case 'pension': input = { kind, rate: 0.1 }; break;
      case 'recession': input = { kind, months: Math.max(6, months) }; break;
      case 'rate_shock': input = { kind, delta: pct / 1000 }; break;
      case 'market_crash': input = { kind, drop: pct / 100 }; break;
      case 'buy_property': input = { kind, listingId: listing ?? -1, ltv: 0.6, years: 25, rateType: 'fija' }; break;
      case 'sell_portfolio': input = { kind }; break;
      default: input = { kind: 'quit_job' };
    }
    setRes(runScenario(s, input, months));
  };
  const last = res && !res.error ? res.scenario[res.scenario.length - 1] : null;
  const base = res ? res.baseline[res.baseline.length - 1] : null;
  return (
    <div className="stack">
      <p className="small muted">Simula una copia de tu partida. Nada de esto cambia tu juego real.</p>
      <select className="input" aria-label="Escenario" value={kind} onChange={(e) => { const k = e.target.value as ScenKind; setKind(k); setRes(null); if (k === 'rate_shock') setPct(20); if (k === 'market_crash') setPct(30); }}>
        <option value="save_monthly">Ahorrar un monto fijo cada mes</option>
        <option value="lifestyle">Cambiar de estilo de vida</option>
        <option value="loan">Tomar un préstamo a 24 meses</option>
        <option value="deposit">Abrir un depósito a 12 meses</option>
        <option value="pension">Aportar 10 % a jubilación</option>
        <option value="quit_job">Renunciar a mi empleo</option>
        <option value="recession">Una recesión empieza ahora</option>
        <option value="rate_shock">Suben (o bajan) las tasas de interés</option>
        <option value="market_crash">Caída de la bolsa</option>
        <option value="buy_property">Comprar un inmueble con hipoteca (60 %)</option>
        <option value="sell_portfolio">Vender toda mi cartera financiera hoy</option>
      </select>
      {kind === 'rate_shock' && <Seg items={[{ id: -20, label: '−2 pp' }, { id: 10, label: '+1 pp' }, { id: 20, label: '+2 pp' }, { id: 40, label: '+4 pp' }]} value={pct} onChange={setPct} />}
      {kind === 'market_crash' && <Seg items={[{ id: 15, label: '−15 %' }, { id: 30, label: '−30 %' }, { id: 50, label: '−50 %' }]} value={pct} onChange={setPct} />}
      {kind === 'buy_property' && (s.realEstate.listings.length === 0 ? <p className="small muted">No hay inmuebles publicados ahora.</p> : (
        <select className="input" aria-label="Inmueble" value={listing ?? ''} onChange={(e) => setListing(Number(e.target.value))}>
          {s.realEstate.listings.map((l) => <option key={l.id} value={l.id}>{l.property.name} · {fmtMoney(l.askPrice, { decimals: false })}</option>)}
        </select>
      ))}
      {(kind === 'save_monthly' || kind === 'loan' || kind === 'deposit') && <AmountInput id="scen-amt" value={amount} onChange={setAmount} />}
      {kind === 'lifestyle' && <Seg items={LIFESTYLES.map((l) => ({ id: l.id, label: l.name }))} value={lifestyle} onChange={setLifestyle} />}
      {kind === 'loan' && <Seg items={BANKS.map((b) => ({ id: b.id, label: b.name }))} value={bank} onChange={setBank} />}
      <Seg items={[{ id: 6, label: '6 meses' }, { id: 12, label: '12 meses' }, { id: 24, label: '24 meses' }]} value={months} onChange={setMonths} />
      <span className="act"><button className="btn dark" onClick={run}>Simular</button><InfoButton term="accion_escenarios" /></span>
      {res?.error && <p className="small loss">No se puede simular: {res.error}</p>}
      {res && !res.error && last && base && (
        <div className="card">
          <LineChart
            series={[
              { name: 'Liquidez actual', values: res.baseline.map((p) => p.liquid), color: 'var(--faint)', dashed: true },
              { name: 'Liquidez escenario', values: res.scenario.map((p) => p.liquid), color: 'var(--info)' },
              { name: 'Patrimonio escenario', values: res.scenario.map((p) => p.netWorth), color: 'var(--accent)' },
            ]}
            labels={['hoy', `+${months} m`]}
          />
          <Legend series={[{ name: 'Liquidez si no cambiás nada', values: [], color: 'var(--faint)' }, { name: 'Liquidez escenario', values: [], color: 'var(--info)' }, { name: 'Patrimonio escenario', values: [], color: 'var(--accent)' }]} />
          <div className="kv">
            <dt>Patrimonio en {months} meses</dt><dd>{fmtMoney(last.netWorth)} <span className={last.netWorth >= base.netWorth ? 'gain' : 'loss'}>({fmtMoney(last.netWorth - base.netWorth, { sign: true })})</span></dd>
            <dt>Liquidez en {months} meses</dt><dd>{fmtMoney(last.liquid)} <span className={last.liquid >= base.liquid ? 'gain' : 'loss'}>({fmtMoney(last.liquid - base.liquid, { sign: true })})</span></dd>
            <dt>Deudas en {months} meses</dt><dd>{fmtMoney(last.debt)}</dd>
          </div>
          <p className="tiny muted">{res.note}</p>
        </div>
      )}
    </div>
  );
}

function AdvisorView() {
  const ui = useUI();
  const s = useGame();
  const [tab, setTab] = useState<'alerts' | 'scen' | 'prefs'>('alerts');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => store.markSeen('asesor'), []);
  const all = useDerived(insightsOf);
  const list = all.filter((i) => ui.settings.alertCategories.includes(i.category));
  return (
    <Sheet title="Asesor">
      <Seg items={[{ id: 'alerts', label: `Alertas (${list.length})` }, { id: 'scen', label: '¿Qué pasaría si…?' }, { id: 'prefs', label: 'Categorías' }]} value={tab} onChange={setTab} />
      {tab === 'alerts' && (
        <>
          <p className="tiny muted">Análisis con los datos reales de tu partida al {formatDate(s.day)}. Los <Pill tone="neutral">hechos</Pill> salen del libro mayor; las <Pill tone="info">estimaciones</Pill> son proyecciones con supuestos explícitos. El asesor nunca toca tu dinero.</p>
          {list.length === 0 && <Empty icon="check">No detecto problemas ni oportunidades claras en las categorías activas. Seguí así.</Empty>}
          {list.map((i) => <InsightCard key={i.id} i={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />)}
        </>
      )}
      {tab === 'scen' && <Scenarios />}
      {tab === 'prefs' && (
        <div className="stack">
          <p className="small muted">Elegí qué categorías de alertas ver en Inicio y en el contador del asesor.</p>
          {(Object.keys(CATEGORY_NAMES) as AdvisorCategory[]).map((c) => {
            const on = ui.settings.alertCategories.includes(c);
            return (
              <label key={c} className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={on} onChange={() => store.updateSettings({ alertCategories: on ? ui.settings.alertCategories.filter((x) => x !== c) : [...ui.settings.alertCategories, c] })} />
                <span className="grow">{CATEGORY_NAMES[c]}</span>
              </label>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

function SettingsSection({ id, icon, title, summary, open, onToggle, children }: { id: string; icon: IconName; title: string; summary: ReactNode; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <section className={`card settings-section ${open ? 'open' : ''}`}>
      <button className="ss-head" aria-expanded={open} onClick={() => onToggle(id)}>
        <span className="ss-icon" aria-hidden><Icon name={icon} size={19} /></span>
        <span className="ss-text"><strong>{title}</strong><span className="tiny muted">{summary}</span></span>
        <Icon name="chevron" size={16} className={`ss-chev ${open ? 'rot' : ''}`} />
      </button>
      {open && <div className="ss-body">{children}</div>}
    </section>
  );
}

function UpdatesPanel() {
  const ota = useOta();
  const [busy, setBusy] = useState(false);
  const c = ota.check;
  const install = async () => {
    if (!c || c.kind !== 'available') return;
    setBusy(true);
    const err = await applyUpdate(c.manifest, () => store.saveForUpdate());
    setBusy(false);
    if (err) store.toast(err, 'error');
  };
  return (
    <>
      <div className="kv">
        <dt>Versión del juego</dt><dd>{APP_VERSION}</dd>
        {ota.native && <><dt>Aplicación instalada (APK)</dt><dd>{ota.native.version} · código {ota.native.code}</dd></>}
      </div>
      {!ota.native && <p className="small muted">En el navegador siempre jugás la última versión publicada. Las actualizaciones automáticas son para la app de Android.</p>}
      {ota.native && (
        <>
          {c?.kind === 'none' && <p className="small gain">Tenés la última versión.</p>}
          {c?.kind === 'available' && (
            <div className="update-box">
              <strong>Versión {c.manifest.version} disponible</strong>
              <ul className="small">{c.manifest.notes.slice(0, 8).map((n) => <li key={n}>{n}</li>)}</ul>
              <span className="tiny muted">{(c.manifest.size / 1024 / 1024).toFixed(1)} MB · se guarda tu partida y una copia antes de actualizar; si algo falla, vuelve sola a la versión actual.</span>
              <button className="btn primary" disabled={busy} onClick={() => void install()}>{busy ? (ota.phase === 'downloading' ? `Descargando… ${Math.round(ota.progress * 100)} %` : ota.phase === 'verifying' ? 'Verificando…' : 'Instalando…') : 'Actualizar ahora'}</button>
            </div>
          )}
          {c?.kind === 'failed-before' && <p className="small warn">La versión {c.manifest.version} no pudo iniciar en tu teléfono la última vez. Podés intentarlo de nuevo con "Buscar actualización".</p>}
          {c?.kind === 'needs-apk' && <p className="small warn">La versión {c.manifest.version} necesita instalar una APK nueva (cambió algo del sistema). Se instala encima de la actual y conserva tu partida: <a href={`https://github.com/${OTA_REPO}/releases/latest`} target="_blank" rel="noreferrer">descargala acá</a>.</p>}
          {(ota.phase === 'error' || c?.kind === 'error') && <p className="small loss">{ota.message ?? (c?.kind === 'error' ? c.message : '')}</p>}
          <span className="act"><button className="btn" disabled={busy || ota.phase === 'checking'} onClick={() => void checkForUpdate(true)}>{ota.phase === 'checking' ? 'Buscando…' : 'Buscar actualización'}</button><InfoButton term="accion_buscar_actualizacion" /></span>
        </>
      )}
    </>
  );
}

/** Importar desde archivo o texto, con confirmación antes de cambiar de partida. */
function ImportControls({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState<{ text: string; label: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const run = async (text: string) => {
    const r = await store.importText(text);
    if (r.ok) {
      setPending(null);
      setPasted('');
      navStore.closeAll();
    }
  };
  if (pending) {
    return (
      <div className="card flat" style={{ padding: 12, gap: 8 }}>
        <div className="small">Vas a importar {pending.label}. Se verifica la contabilidad y se abre como una partida nueva; la que tenés abierta queda guardada.</div>
        <div className="btn-row">
          <button className="btn sm ghost" onClick={() => setPending(null)}>Cancelar</button>
          <button className="btn sm dark" onClick={() => void run(pending.text)}>Importar</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <label className="small" htmlFor="import-file">Desde un archivo .json</label>
      <input id="import-file" type="file" disabled={disabled} accept=".json,application/json,text/plain" className="small" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPending({ text: await f.text(), label: `«${f.name}»` }); }} />
      <textarea className="input" aria-label="Texto de una partida exportada" disabled={disabled} placeholder="…o pegá aquí el texto de una partida exportada" value={pasted} onChange={(e) => setPasted(e.target.value)} style={{ minHeight: 60, padding: 8, fontSize: 12 }} />
      <span className="act"><button className="btn sm" disabled={disabled || !pasted.trim()} onClick={() => setPending({ text: pasted, label: 'el texto pegado' })}>Importar y verificar</button><InfoButton term="accion_exportar" /></span>
    </>
  );
}

function SettingsView() {
  const ui = useUI();
  const [exportText, setExportText] = useState<string | null>(null);
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof store.backups>>>([]);
  const [audit, setAudit] = useState<string[] | null>(null);
  const [open, setOpen] = useState<string>('game');
  useEffect(() => { void store.backups().then(setBackups); }, [ui.lastSaved]);
  const st = ui.settings;
  const s = ui.state;
  const toggle = (id: string) => setOpen((o) => (o === id ? '' : id));
  const ota = useOta();
  const now = useNow();
  return (
    <Sheet title="Ajustes">
      {s && (
        <div className="settings-hero">
          <Avatar data={avatarOf(s)} size={46} bust />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{s.player.name}</strong>
            <div className="tiny muted">{Math.floor(ageOf(s))} años · {formatDate(s.day)} · dificultad {DIFFICULTY_BY_ID[s.options.difficulty].name.toLowerCase()} · <SavedAgo className="" /></div>
          </div>
          <span className="act"><button className="btn sm dark" onClick={async () => { if (await store.save()) store.toast('Partida guardada.', 'ok'); }}><Icon name="save" size={15} /> Guardar</button><InfoButton term="accion_guardar" /></span>
        </div>
      )}
      {s && (
        <SettingsSection id="game" icon="rocket" title="Partida" summary={`${DIFFICULTY_BY_ID[s.options.difficulty].name} · ilegales ${s.options.illegalEnabled ? 'activadas' : 'desactivadas'}`} open={open === 'game'} onToggle={toggle}>
          <span className="small">Dificultad económica <InfoButton term="accion_dificultad" /></span>
          <Seg items={DIFFICULTIES.map((d) => ({ id: d.id, label: d.name }))} value={s.options.difficulty} onChange={(v) => store.run((x) => { x.options.difficulty = v; return { ok: true, message: `Dificultad: ${DIFFICULTY_BY_ID[v].name}.` }; })} />
          <p className="tiny muted">{DIFFICULTY_BY_ID[s.options.difficulty].description}</p>
          <IllegalToggle />
          <Switch checked={st.showAllSections} onChange={() => store.updateSettings({ showAllSections: !st.showAllSections })} label="Mostrar todas las secciones desde el inicio" sub="Sin avisos de «recomendado desde la etapa…». Nada está bloqueado de todos modos." term="secciones_recomendadas" />
          <div className="btn-row">
            <button className="btn sm" onClick={() => { store.run((x) => { x.tutorial.dismissed = false; }, { toast: false }); navStore.open({ kind: 'tutorial' }); }}><Icon name="missions" size={15} /> Ver misiones</button>
            {s.saga.firstMonth.dismissed && s.day <= 365 && <button className="btn sm" onClick={() => store.run((x) => { x.saga.firstMonth.dismissed = false; }, { toast: false })}><Icon name="rocket" size={15} /> Ver la guía del primer mes</button>}
          </div>
          <ConfirmButton label="Nueva partida" className="btn sm" disabled={!store.canCreateSlot()} confirmLabel="Empezar otra partida" detail={<>Vas a la pantalla de partida nueva. «{s.player.name}» se guarda antes y queda en «Tus partidas» para volver cuando quieras.</>} onConfirm={() => { navStore.closeAll(); void store.requestNewGame(); }} />
          <p className="tiny muted">{store.canCreateSlot() ? 'La partida actual queda guardada: podés volver a ella desde «Tus partidas».' : 'Ya tenés el máximo de partidas: borrá una en «Guardado y copias» para empezar otra.'}</p>
        </SettingsSection>
      )}
      <SettingsSection id="look" icon="palette" title="Apariencia" summary={`${st.theme === 'system' ? 'Tema del sistema' : st.theme === 'dark' ? 'Oscuro' : 'Claro'} · aprendizaje ${st.learningMode ? 'activado' : 'desactivado'}`} open={open === 'look'} onToggle={toggle}>
        <Seg items={[{ id: 'system', label: 'Sistema' }, { id: 'light', label: 'Claro' }, { id: 'dark', label: 'Oscuro' }]} value={st.theme} onChange={(v) => store.updateSettings({ theme: v })} />
        <Switch checked={st.learningMode} onChange={() => store.updateSettings({ learningMode: !st.learningMode })} label="Modo aprendizaje" sub="Explicaciones cortas en cada pantalla." />
        <Switch checked={st.sound} onChange={() => { store.updateSettings({ sound: !st.sound }); if (!st.sound) setTimeout(() => playTone('success'), 50); }} label="Sonidos" sub="Tonos cortos al festejar logros, metas y puestos en la lista." />
        <Switch checked={st.haptics} onChange={() => store.updateSettings({ haptics: !st.haptics })} label="Vibración" sub="Una vibración breve en los festejos (en teléfonos)." />
      </SettingsSection>
      <SettingsSection id="access" icon="access" title="Accesibilidad" summary={`Texto ${st.fontScale === 1 ? 'normal' : st.fontScale > 1 ? 'grande' : 'chico'} · densidad ${st.density}`} open={open === 'access'} onToggle={toggle}>
        <span className="small">Tamaño del texto <InfoButton term="accion_accesibilidad" /></span>
        <Seg items={[{ id: 0.9, label: 'A−' }, { id: 1, label: 'A' }, { id: 1.15, label: 'A+' }, { id: 1.3, label: 'A++' }]} value={st.fontScale} onChange={(v) => store.updateSettings({ fontScale: v })} />
        <span className="small">Densidad</span>
        <Seg items={[{ id: 'comoda', label: 'Cómoda' }, { id: 'compacta', label: 'Compacta' }]} value={st.density} onChange={(v) => store.updateSettings({ density: v })} />
        <Switch checked={st.highContrast} onChange={() => store.updateSettings({ highContrast: !st.highContrast })} label="Alto contraste" />
        <Switch checked={st.colorblind} onChange={() => store.updateSettings({ colorblind: !st.colorblind })} label="Colores para daltonismo" sub="Ganancias en azul, pérdidas en naranja." />
        <Switch checked={st.reduceMotion} onChange={() => store.updateSettings({ reduceMotion: !st.reduceMotion })} label="Reducir animaciones" />
      </SettingsSection>
      <SettingsSection id="time" icon="clock" title="Tiempo y avisos" summary={`${st.msPerDay / 1000} s por día · pausa automática ${st.autoPause ? 'activada' : 'desactivada'}`} open={open === 'time'} onToggle={toggle}>
        <span className="small">Velocidad base (a 1×) <InfoButton term="accion_velocidad" /></span>
        <Seg items={[{ id: 4000, label: 'Lenta · 4 s' }, { id: 2000, label: 'Normal · 2 s' }, { id: 1000, label: 'Rápida · 1 s' }]} value={st.msPerDay} onChange={(v) => store.updateSettings({ msPerDay: v })} />
        <Switch checked={st.autoPause} onChange={() => store.updateSettings({ autoPause: !st.autoPause })} label="Pausa automática ante eventos importantes" />
        {st.autoPause && (([['peligro', 'Peligros (impagos, quiebras, embargos)'], ['ofertas', 'Ofertas de empleo y de rivales'], ['logros', 'Logros y nuevas etapas'], ['legal', 'Investigaciones, juicios e inspecciones'], ['inversiones', 'Caídas fuertes de inversiones'], ['decisiones', 'Decisiones con plazo (dilemas)']] as Array<[PauseCategory, string]>).map(([id, label]) => (
          <Switch key={id} checked={st.pauseOn.includes(id)} onChange={() => store.updateSettings({ pauseOn: st.pauseOn.includes(id) ? st.pauseOn.filter((x) => x !== id) : [...st.pauseOn, id] })} label={label} />
        )))}
        <Switch checked={st.successToasts} onChange={() => store.updateSettings({ successToasts: !st.successToasts })} label="Confirmaciones de acciones exitosas" sub="Los errores siempre se muestran." />
        <span className="small">Progreso sin conexión (1 día cada 10 minutos reales, tope):</span>
        <Seg items={[{ id: 0, label: 'Nada' }, { id: 7, label: '7 días' }, { id: 30, label: '30 días' }, { id: 90, label: '90 días' }]} value={st.offlineMaxDays} onChange={(v) => store.updateSettings({ offlineMaxDays: v })} />
        <p className="tiny muted">Las alertas del Asesor se eligen en el Asesor → Categorías.</p>
      </SettingsSection>
      <SettingsSection id="save" icon="disk" title="Guardado y copias" summary={<>{ui.slots.length} {ui.slots.length === 1 ? 'partida' : 'partidas'} · <SavedAgo className="" /></>} open={open === 'save'} onToggle={toggle}>
        <p className="small muted">
          Se guarda solo cada 90 segundos, al pausar, al salir de la app y después de cada decisión. {ui.storageKind === 'native' ? 'Tu partida vive en los archivos privados de la app: las actualizaciones no la borran.' : ui.storageKind === 'local' ? 'Se guarda en el navegador: exportá un archivo como respaldo.' : 'Sin almacenamiento: exportá para no perder la partida.'}
          {ui.saveBytes && ` Tamaño: ${(ui.saveBytes / 1024).toFixed(0)} KB.`}
          {s?.ledger.archive && ` Libro mayor: ${s.ledger.entries.length} asientos detallados + ${s.ledger.archive.entries} resumidos.`}
        </p>
        {ui.saveError && <p className="small loss">{ui.saveError}</p>}
        <span className="eyebrow">Tus partidas</span>
        <SlotList />
        <div className="btn-row">
          <span className="act"><button className="btn sm dark" onClick={() => void store.exportFile()}><Icon name="upload" size={15} /> Exportar a archivo</button><InfoButton term="accion_exportar" /></span>
          <span className="act"><button className="btn sm" onClick={() => setAudit(store.audit())}>Auditar contabilidad</button><InfoButton term="accion_auditar" /></span>
        </div>
        <LastExport />
        {audit && (audit.length === 0 ? <p className="small gain"><Icon name="check" size={14} /> {s?.ledger.entries.length} asientos verificados: todo cuadra.</p> : <ul className="small loss">{audit.map((a) => <li key={a}>{a}</li>)}</ul>)}
        <span className="eyebrow">Copias de seguridad de esta partida</span>
        <p className="tiny muted">La copia 1 tiene como mucho 10 minutos; la 2, entre 10 y 70 minutos; la 3, de una hora a un día. Así un error reciente no alcanza a todas. Restaurar guarda antes la partida actual en «Antes de restaurar».</p>
        <div className="rows">
          {backups.filter((b) => b.header).map((b, i) => (
            <div className="row" key={b.key}>
              <div className="grow small">{b.kind === 'principal' ? 'Principal' : b.kind === 'copia' ? `Copia ${i}` : b.kind === 'antes de restaurar' ? 'Antes de restaurar' : 'Antes de actualizar'} · {formatDate(b.header!.day)} · {agoText(Math.max(0, now - b.header!.savedAt))}</div>
              {b.kind !== 'principal' && <ConfirmButton label="Restaurar" className="btn sm ghost" help="accion_restaurar" confirmLabel="Restaurar" detail={<>La partida vuelve al {formatDate(b.header!.day)}. La actual queda en «Antes de restaurar» por si querés deshacerlo.</>} onConfirm={async () => { const r = await store.restore(b.key); store.toast(r.ok ? r.message ?? 'OK' : r.error, r.ok ? 'ok' : 'error'); }} />}
            </div>
          ))}
        </div>
        <button className="btn sm" onClick={() => setExportText(store.exportText())}>Mostrar como texto</button>
        {exportText && (
          <>
            <textarea className="input" aria-label="Partida exportada como texto" readOnly value={exportText} style={{ minHeight: 90, padding: 8, fontSize: 11 }} onFocus={(e) => e.target.select()} />
            <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(exportText); store.toast('Copiado.', 'ok'); } catch { store.toast('Seleccioná el texto y copialo manualmente.', 'error'); } }}>Copiar</button>
          </>
        )}
        <span className="eyebrow">Importar una partida</span>
        <p className="tiny muted">{store.canCreateSlot() ? 'La partida importada se abre como una partida nueva: la actual queda guardada.' : 'Ya tenés el máximo de partidas: borrá una para importar otra.'}</p>
        <ImportControls disabled={!store.canCreateSlot()} />
      </SettingsSection>
      <SettingsSection id="updates" icon="update" title="Actualizaciones" summary={ota.check?.kind === 'available' ? `Versión ${ota.check.manifest.version} disponible` : `Versión ${APP_VERSION}`} open={open === 'updates'} onToggle={toggle}>
        <UpdatesPanel />
        <Switch checked={st.autoUpdate} onChange={() => store.updateSettings({ autoUpdate: !st.autoUpdate })} label="Buscar actualizaciones al abrir la app" sub="Solo consulta si hay una versión nueva; nunca instala sin que lo confirmes." term="actualizaciones" />
      </SettingsSection>
      <button className="btn sm ghost" onClick={() => navStore.open({ kind: 'legal' })}><Icon name="shield" size={15} /> Privacidad, términos y licencias</button>
      <p className="tiny faint" style={{ textAlign: 'center' }}>Ultimate Realistic Tycoon · versión {APP_VERSION} · simulación ficticia.</p>
    </Sheet>
  );
}

function ProgressView() {
  const s = useGame();
  const ev = useDerived(stageOf);
  const a = s.player.attributes;
  const attrs: Array<[string, number, string, string?]> = [
    ['Estrés', a.stress, 'Más de 60 reduce el desempeño; más de 50 desgasta la salud.', 'estres'],
    ['Salud', a.health, `Por debajo de 60 aumenta la probabilidad de imprevistos médicos. Desde los 50 años tiende a bajar; desde los 68, una salud baja aumenta el riesgo de fallecer. Tenés ${Math.floor(ageOf(s))} años.`],
    ['Reputación', a.reputation, 'Mejora la probabilidad de recibir ofertas. Sube con el nivel de tu puesto y certificados.'],
    ['Red de contactos', a.network, 'Mejora la probabilidad de ofertas. Sube con estudios formales y puestos de nivel alto.'],
  ];
  return (
    <Sheet title="Progreso">
      <div className="card">
        <div className="card-head"><h2>Atributos personales</h2></div>
        {attrs.map(([n, v, d, t]) => (
          <div className="stack" key={n} style={{ gap: 4 }}>
            <span className="small" style={{ display: 'flex', gap: 6 }}><strong style={{ flex: 1 }}>{n} {t && <InfoButton term={t} />}</strong><span className="num">{Math.round(v)}/100</span></span>
            <Bar value={v / 100} tone={n === 'Estrés' ? (v > 60 ? 'loss' : v > 45 ? 'warn' : 'gain') : v < 40 ? 'warn' : 'gain'} />
            <span className="tiny muted">{d}</span>
          </div>
        ))}
      </div>
      <span className="eyebrow">Etapas de magnate</span>
      <p className="tiny muted">Ninguna exige una ruta concreta. La etapa alcanzada no retrocede.</p>
      {ev.details.map((d) => {
        const reached = s.progression.stage >= d.stage.n;
        return (
          <div key={d.stage.n} className="card" style={{ gap: 6, opacity: reached || d.stage.n === s.progression.stage + 1 ? 1 : 0.7 }}>
            <div className="card-head">
              <span className="num faint">{d.stage.n}</span>
              <h2>{d.stage.name}</h2>
              {reached ? <Pill tone="gain">Alcanzada</Pill> : d.stage.n === s.progression.stage + 1 ? <Pill tone="accent">Siguiente</Pill> : null}
            </div>
            <p className="small muted">{d.stage.description}{sectionsFromStage(d.stage.n).length > 0 && <> Desde esta etapa se recomienda: {sectionsFromStage(d.stage.n).map((g) => g.name).join(', ')}.</>}</p>
            {d.criteria.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {d.criteria.map((c) => <li key={c.label} className={c.met ? 'gain' : ''}>{c.met ? '✓' : '○'} {c.label}{c.future && <span className="faint"> ({c.future})</span>}</li>)}
              </ul>
            )}
          </div>
        );
      })}
      <span className="eyebrow">Logros ({Object.keys(s.progression.achievements).length}/{ACHIEVEMENTS.length})</span>
      <div className="grid2">
        {ACHIEVEMENTS.map((x) => {
          const day = s.progression.achievements[x.id];
          return (
            <div key={x.id} className="stat" style={{ opacity: day === undefined ? 0.55 : 1 }}>
              <div className="label"><Icon name={day === undefined ? 'lock' : 'medal'} size={14} /> {x.name}</div>
              <div className="tiny muted">{x.description}</div>
              {day !== undefined && <div className="tiny gain">{formatDate(day)}</div>}
            </div>
          );
        })}
      </div>
      <p className="tiny faint">{STAGES.length} etapas en total.</p>
    </Sheet>
  );
}

function LogView() {
  const s = useGame();
  const [kind, setKind] = useState<'all' | 'money' | 'alerts'>('all');
  const list = s.log.filter((l) => kind === 'all' || (kind === 'money' ? l.kind === 'income' || l.kind === 'expense' : l.kind === 'danger' || l.kind === 'warning')).slice().reverse();
  return (
    <Sheet title="Actividad">
      <Seg items={[{ id: 'all', label: 'Todo' }, { id: 'money', label: 'Dinero' }, { id: 'alerts', label: 'Alertas' }]} value={kind} onChange={setKind} />
      <div className="rows">{list.map((l) => <LogRow key={l.id} l={l} />)}</div>
      {list.length === 0 && <Empty icon="log">Sin actividad.</Empty>}
    </Sheet>
  );
}

function TutorialView() {
  const s = useGame();
  useUI();
  const next = nextMission(s);
  const { done, total } = missionProgress(s);
  return (
    <Sheet title="Misiones">
      <div className="card">
        <div className="card-head"><h2>{done} de {total} cumplidas</h2><InfoButton term="misiones" /></div>
        <Bar value={done / total} />
        <p className="small muted">Misiones cortas que te enseñan cada sistema. Se marcan solas cuando lo hacés de verdad y dan experiencia en la habilidad relacionada. Ninguna bloquea nada: hacelas en el orden que quieras.</p>
      </div>
      {CHAPTERS.map((ch) => {
        const list = TUTORIAL.filter((t) => t.chapter === ch.n);
        const chDone = list.filter((t) => isMissionDone(s, t)).length;
        const early = s.progression.stage < ch.stage;
        return (
          <div key={ch.n} className="stack" style={{ gap: 6 }}>
            <div className="section-title"><h2><Icon name={CHAPTER_ICON[ch.n - 1] ?? 'missions'} size={18} /> {ch.name}</h2><span className="tiny muted">{chDone}/{list.length}{early ? ` · recomendado desde la etapa ${ch.stage}` : ''}</span></div>
            <div className="card" style={{ paddingBlock: 4 }}>
              <div className="rows">
                {list.map((t) => {
                  const ok = isMissionDone(s, t);
                  return (
                    <div key={t.id} className={`row mission ${ok ? 'done' : ''} ${next?.id === t.id ? 'next' : ''}`}>
                      <span className={`m-check ${ok ? 'on' : ''}`} aria-hidden>{ok ? <Icon name="check" size={14} /> : null}</span>
                      <div className="grow">
                        <div className="title small">{t.title} {next?.id === t.id && <Pill tone="accent">Siguiente</Pill>}</div>
                        {!ok && <div className="meta">{t.body}</div>}
                        {t.reward && <div className="tiny faint">+{t.reward.xp} XP en {SKILL_BY_ID[t.reward.skill].name}</div>}
                      </div>
                      {!ok && <button className="btn sm" onClick={() => navStore.go(t.tab, t.sub)}>Ir</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      <button className="btn ghost" onClick={() => { store.run((st) => { st.tutorial.dismissed = true; }, { toast: false }); navStore.close(); }}>Ocultar la tarjeta de misiones en Inicio</button>
    </Sheet>
  );
}

function UpdateSheet() {
  return (
    <Sheet title="Actualización disponible">
      <UpdatesPanel />
      <p className="tiny muted">Tu partida está en los archivos privados de la app: la actualización no la toca. Antes de cambiar de versión se guarda y se hace una copia extra.</p>
    </Sheet>
  );
}

function WhatsNewSheet() {
  const ota = useOta();
  const j = ota.justUpdated;
  const r = ota.rolledBack;
  const close = () => { void dismissUpdateNotes(); navStore.close(); };
  return (
    <Sheet title={j ? `Novedades de la versión ${j.to}` : 'Actualización no aplicada'} onClose={close}>
      {j && (
        <>
          <p className="small">Actualizaste de {j.from} a {j.to}. Tu partida se conservó.</p>
          {j.notes.length > 0 && <ul className="small whatsnew">{j.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </>
      )}
      {r && <p className="small warn">La versión {r.version} no se pudo usar ({r.reason}). Seguís con la versión {APP_VERSION} y tu partida está intacta.</p>}
      <button className="btn primary block" onClick={close}>Entendido</button>
    </Sheet>
  );
}

/** Recompensas opcionales por ver un anuncio (solo Android). */
function RewardsView() {
  const s = useGame();
  const [busy, setBusy] = useState<AdRewardKind | null>(null);
  const [courseId, setCourseId] = useState<string>('');
  const today = todayKey();
  const courses = skippableCourses(s);
  const loans = reducibleLoans(s);
  const progress = s.meta.ads?.debtProgress;
  const [loanPick, setLoanPick] = useState<number | null>(null);
  const loanId = loanPick ?? progress?.loanId ?? loans[0]?.id;
  const loan = loans.find((l) => l.id === loanId);
  const watch = async (kind: AdRewardKind) => {
    setBusy(kind);
    const outcome = await showRewardedAd();
    setBusy(null);
    if (outcome === 'rewarded') store.run((x) => grantAdReward(x, kind, todayKey(), { courseId: courseId || courses[0]?.courseId, loanId }));
    else if (outcome === 'closed') store.toast('Cerraste el anuncio antes de terminar: no hay recompensa.', 'info');
    else store.toast('No hay un anuncio disponible ahora. Probá en un rato (hace falta internet).', 'error');
  };
  const rows: Array<{ kind: AdRewardKind; detail: string; disabled?: string }> = [
    { kind: 'cash', detail: `Recibís ${fmtMoney(cashRewardAmount(s))} (una semana de tu sueldo, o $100 sin empleo). Tributa como otros ingresos.` },
    { kind: 'news', detail: 'Tu próximo análisis de una noticia tiene la mitad del error. Nunca da certeza.', disabled: s.meta.ads?.newsBoost ? 'Ya tenés uno pendiente' : undefined },
    { kind: 'study', detail: `Adelanta hasta ${STUDY_SKIP_DAYS / 30} meses un curso en curso. Las matrículas de esos meses se pagan igual.`, disabled: courses.length ? undefined : 'No tenés cursos en curso' },
    {
      kind: 'debt',
      detail: loan
        ? `Con ${DEBT_ADS_NEEDED} anuncios el saldo baja ${fmtMoney(debtCutAmount(s, loan.balance))} (la mitad, con tope). La cuota no cambia: terminás antes. Una vez por préstamo. Llevás ${progress?.loanId === loan.id ? progress.watched : 0} de ${DEBT_ADS_NEEDED}.`
        : 'Reduce a la mitad el saldo de un préstamo personal (con tope), una vez por préstamo.',
      disabled: loan ? undefined : 'No tenés préstamos para reducir',
    },
  ];
  return (
    <Sheet title="Recompensas">
      <p className="small muted">Opcional: mirá un anuncio corto y elegí una ayuda. El juego nunca te obliga a ver anuncios ni los muestra solo.</p>
      {rows.map((r) => {
        const left = adRewardsLeft(s, r.kind, today);
        return (
          <div className="card" key={r.kind}>
            <div className="card-head"><h2 style={{ flex: 1 }}>{AD_REWARDS[r.kind].title}</h2><span className="tiny muted">{left} de {AD_REWARDS[r.kind].perDay} hoy</span></div>
            <p className="small muted">{r.detail}</p>
            {r.kind === 'study' && courses.length > 1 && (
              <select className="input" aria-label="Curso a adelantar" value={courseId || courses[0].courseId} onChange={(e) => setCourseId(e.target.value)}>
                {courses.map((a) => <option key={a.courseId} value={a.courseId}>{COURSE_BY_ID[a.courseId].name}</option>)}
              </select>
            )}
            {r.kind === 'debt' && loans.length > 1 && (
              <select className="input" aria-label="Préstamo a reducir" value={loanId} onChange={(e) => setLoanPick(Number(e.target.value))}>
                {loans.map((l) => <option key={l.id} value={l.id}>{BANK_BY_ID[l.bankId]?.name ?? 'Préstamo'} · saldo {fmtMoney(l.balance)}</option>)}
              </select>
            )}
            <button className="btn primary" disabled={!!busy || left === 0 || !!r.disabled} onClick={() => void watch(r.kind)}>
              <Icon name="play" size={15} /> {busy === r.kind ? 'Cargando anuncio…' : r.disabled ?? (left === 0 ? 'Volvé mañana' : 'Ver anuncio')}
            </button>
          </div>
        );
      })}
      {!ADS_LIVE && <p className="tiny faint">Versión de prueba: se muestran anuncios de prueba de Google.</p>}
    </Sheet>
  );
}

/** Privacidad, términos y licencias (el mismo texto que las páginas públicas). */
function LegalView({ initial }: { initial: 'privacy' | 'terms' | 'licenses' }) {
  const [tab, setTab] = useState(initial);
  const sections = tab === 'privacy' ? PRIVACY : TERMS;
  return (
    <Sheet title="Privacidad y términos">
      <Seg items={[{ id: 'privacy', label: 'Privacidad' }, { id: 'terms', label: 'Términos' }, { id: 'licenses', label: 'Licencias' }]} value={tab} onChange={setTab} />
      <p className="tiny muted">Actualizado el {LEGAL.updated}.</p>
      {tab !== 'licenses' && sections.map((sec) => (
        <section key={sec.title} className="stack" style={{ gap: 4 }}>
          <h3 className="small" style={{ margin: 0 }}>{sec.title}</h3>
          {sec.paragraphs.map((p) => <p key={p} className="small" style={{ margin: 0 }}>{p}</p>)}
        </section>
      ))}
      {tab === 'licenses' && (
        <div className="rows">
          {LICENSES.map((l) => (
            <div className="row" key={l.name}>
              <div className="grow"><div className="title small">{l.name}</div><div className="meta">{l.license} · {l.url}</div></div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}


function render(spec: SheetSpec) {
  switch (spec.kind) {
    case 'term': return <TermView key={spec.id} id={spec.id} />;
    case 'glossary': return <GlossaryView />;
    case 'advisor': return <AdvisorView />;
    case 'settings': return <SettingsView />;
    case 'progress': return <ProgressView />;
    case 'log': return <LogView />;
    case 'tutorial': return <TutorialView />;
    case 'update': return <UpdateSheet />;
    case 'whatsnew': return <WhatsNewSheet />;
    case 'legal': return <LegalView initial={spec.tab ?? 'privacy'} />;
    case 'rewards': return <RewardsView />;
    case 'goals': return <GoalsView />;
    case 'dilemma': return <DilemmaSheet key={spec.id} id={spec.id} />;
    case 'agenda': return <AgendaSheet />;
    case 'chronicle': return <ChronicleView />;
    case 'challenges': return <ChallengesView />;
    case 'explain': return <ExplainView />;
    case 'life': return <LifeView />;
  }
}

/**
 * Pila de hojas: todas quedan montadas (al volver, la de abajo conserva su estado:
 * sección abierta, lo escrito…) y solo la de arriba se ve y recibe el foco.
 */
export function SheetHost() {
  const nav = useNav();
  const last = nav.sheets.length - 1;
  return (
    <>
      {nav.sheets.map((spec, i) => (
        <SheetLayer key={`${i}:${spec.kind}`} top={i === last}><ErrorBoundary scope="section">{render(spec)}</ErrorBoundary></SheetLayer>
      ))}
    </>
  );
}
