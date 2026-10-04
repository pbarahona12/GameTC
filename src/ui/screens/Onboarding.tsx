import { useState } from 'react';
import { BACKGROUNDS, BackgroundId, PLAY_STYLES, PlayStyle } from '../../content/backgrounds';
import { EDUCATION_NAMES } from '../../content/jobs';
import { LIFESTYLE_BY_ID } from '../../content/lifestyle';
import { store, useUI } from '../store';
import { SlotList } from '../components/Slots';
import { fmtMoney } from '../../engine/format';
import { usd } from '../../engine/money';
import { DIFFICULTIES, type Difficulty } from '../../engine/economy/difficulty';
import { SKIN_TONES, HAIR_COLORS, HAIR_STYLES, HAIR_STYLE_NAMES } from '../../content/shops';
import type { Look } from '../../engine/lifestyle/types';
import { Avatar } from '../components/Avatar';
import { Switch } from '../components/common';
import { Icon } from '../icons';
import { CHALLENGES, CHALLENGE_BY_ID } from '../../engine/saga/challenges';
import { BACKGROUND_BY_ID } from '../../content/backgrounds';
import { iconOf } from './saga/SagaCards';

const COLORS = ['#d2a94f', '#4cc093', '#7fb2e0', '#ee7a66', '#b59be0', '#e6d27a'];

/** Una promesa de historia por origen (1.4): qué partida te espera, no solo sus números. */
const HOOK: Record<BackgroundId, string> = {
  egresado: 'Tenés $2,000 y un título secundario. En 20 años, ¿quién vas a ser?',
  tecnico: 'Sabés vender. ¿Te quedás detrás del mostrador o terminás siendo el dueño de la cadena?',
  autodidacta: 'Casi sin dinero, pero con una habilidad que vale. El camino más difícil… y el más épico.',
  herencia: '$15,000 de una tía y ninguna experiencia. La mayoría lo gasta en tres años. ¿Y vos?',
};

function ImportCard() {
  const [text, setText] = useState('');
  return (
    <div className="card import-card">
      <div className="card-head"><span className="ss-icon" aria-hidden><Icon name="upload" size={18} /></span><h2>Importar una partida</h2></div>
      <p className="small muted">Elegí el archivo .json que exportaste desde Ajustes → Guardado y copias (por ejemplo, desde Descargas o Drive). Se verifica la contabilidad antes de cargarla y se actualiza a esta versión.</p>
      <label className="btn dark block file-btn">
        <Icon name="upload" size={16} /> Elegir archivo de partida
        <input type="file" accept=".json,application/json,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; await store.importText(await f.text()); e.target.value = ''; }} />
      </label>
      <details>
        <summary className="small muted">O pegar el texto exportado</summary>
        <textarea id="imp" className="input" style={{ minHeight: 100, padding: 10, marginTop: 8 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pegá acá el texto de la partida" />
        <button className="btn sm" style={{ marginTop: 8 }} disabled={!text.trim()} onClick={() => void store.importText(text)}>Importar y verificar</button>
      </details>
    </div>
  );
}

/** Partidas ya guardadas en el dispositivo (al volver desde "Nueva partida" o tras un error). */
function SavedGames() {
  const ui = useUI();
  if (!ui.slots.length) return null;
  const back = ui.returnSlot ? ui.slots.find((x) => x.id === ui.returnSlot) : null;
  return (
    <div className="card">
      <div className="card-head"><h2>Tus partidas guardadas</h2></div>
      {back && <button className="btn primary block" onClick={() => void store.openSlot(back.id)}><Icon name="undo" size={16} /> Volver a la partida de {back.name}</button>}
      <SlotList />
    </div>
  );
}

export function Onboarding() {
  const [name, setName] = useState('');
  const [bg, setBg] = useState<BackgroundId>('egresado');
  const [style, setStyle] = useState<PlayStyle>('libre');
  const [color] = useState(COLORS[0]);
  const [look, setLook] = useState<Look>({ skin: 1, hair: 'corto', hairColor: 1 });
  const [seed, setSeed] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  // Las actividades ilegales ficticias son opcionales: arrancan desactivadas y se
  // pueden activar acá (opciones avanzadas), en Ajustes → Partida o en Más → Legal.
  const [illegal, setIllegal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<'libre' | 'desafio'>('libre');
  const [challenge, setChallenge] = useState(CHALLENGES[0].id);
  const ch = mode === 'desafio' ? CHALLENGE_BY_ID[challenge] : null;

  return (
    <div className="onboard">
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Simulador financiero y empresarial</span>
        <h1 className="brand">Ultimate <em>Realistic</em> Tycoon</h1>
        <p className="muted">Empezás con poco dinero. Cada peso entra y sale por un libro contable real: nada aparece por arte de magia. Tu fortuna depende de tus decisiones.</p>
      </div>

      <SavedGames />

      <div className="section-title"><h2>1 · Tu personaje</h2></div>
      <div className="card onboard-char">
        <div className="oc-avatar"><Avatar data={{ look, items: [], outfit: {} }} size={92} /></div>
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <div className="field">
            <label htmlFor="pname">Nombre</label>
            <input id="pname" className="input" value={name} maxLength={24} placeholder="Ej.: Adriana Paz" autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </div>
          <span className="tiny muted" id="skin-label">Tono de piel</span>
          <div className="swatches" role="group" aria-labelledby="skin-label">{SKIN_TONES.map((c, i) => <button key={c} type="button" className={`swatch ${look.skin === i ? 'on' : ''}`} style={{ background: c }} aria-label={`Tono ${i + 1}`} aria-pressed={look.skin === i} onClick={() => setLook({ ...look, skin: i })} />)}</div>
          <span className="tiny muted" id="hair-label">Peinado y color</span>
          <div className="chips" role="group" aria-labelledby="hair-label">{HAIR_STYLES.map((h) => <button key={h} type="button" className={look.hair === h ? 'on' : ''} aria-pressed={look.hair === h} onClick={() => setLook({ ...look, hair: h })}>{HAIR_STYLE_NAMES[h]}</button>)}</div>
          <div className="swatches" role="group" aria-label="Color de pelo">{HAIR_COLORS.map((c, i) => <button key={c} type="button" className={`swatch ${look.hairColor === i ? 'on' : ''}`} style={{ background: c }} aria-label={`Color de pelo ${i + 1}`} aria-pressed={look.hairColor === i} onClick={() => setLook({ ...look, hairColor: i })} />)}</div>
        </div>
      </div>

      <div className="section-title"><h2>2 · ¿Cómo querés jugar?</h2></div>
      <div className="choice-grid two" role="radiogroup" aria-label="Modo de juego">
        <button type="button" role="radio" aria-checked={mode === 'libre'} className={`choice ${mode === 'libre' ? 'on' : ''}`} onClick={() => setMode('libre')}>
          <strong><Icon name="sparkles" size={15} /> Partida libre</strong>
          <span className="small muted">Elegís tu origen y tus metas. Un mundo nuevo, solo tuyo.</span>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'desafio'} className={`choice ${mode === 'desafio' ? 'on' : ''}`} onClick={() => setMode('desafio')}>
          <strong><Icon name="rocket" size={15} /> Desafío con semilla</strong>
          <span className="small muted">Un mundo fijo con un objetivo y un plazo. Al cumplirlo, un código para comparar.</span>
        </button>
      </div>
      {mode === 'desafio' && (
        <div className="stack" role="radiogroup" aria-label="Desafío">
          {CHALLENGES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={challenge === c.id} className={`choice ${challenge === c.id ? 'on' : ''}`} onClick={() => setChallenge(c.id)}>
              <strong><Icon name={iconOf(c.icon, 'rocket')} size={15} /> {c.title}</strong>
              <span className="small muted">{c.description}</span>
              <span className="tiny">Objetivo: {c.goal} · origen: {BACKGROUND_BY_ID[c.background].name} · plazo {Math.round(c.limitDays / 365)} años</span>
            </button>
          ))}
        </div>
      )}

      {mode === 'libre' && <div className="section-title"><h2>3 · Tu origen</h2></div>}
      {mode === 'libre' && <div className="stack" role="radiogroup" aria-label="Origen">
        {BACKGROUNDS.map((b) => (
          <button key={b.id} type="button" role="radio" className={`choice ${bg === b.id ? 'on' : ''}`} onClick={() => setBg(b.id)} aria-checked={bg === b.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{b.name}</strong>
              <span className="num">{fmtMoney(usd(b.startingCash + b.startingChecking), { decimals: false })}</span>
            </div>
            <span className="small hook">{HOOK[b.id]}</span>
            <span className="small muted">{b.summary}</span>
            <span className="tiny"><span className="gain">+ {b.pros}</span> · <span className="loss">− {b.cons}</span></span>
            <span className="tiny faint">Educación: {EDUCATION_NAMES[b.education]} · Estilo de vida: {LIFESTYLE_BY_ID[b.lifestyle].name} · Límite de tarjeta {fmtMoney(usd(b.cardLimit), { decimals: false })}</span>
          </button>
        ))}
      </div>}

      <details className="card advanced">
        <summary><strong>Opciones avanzadas</strong> <span className="tiny muted">dificultad, objetivo, actividades ilegales, semilla</span></summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <span className="eyebrow">Dificultad económica</span>
          <div className="stack" role="radiogroup" aria-label="Dificultad económica">
            {DIFFICULTIES.map((d) => (
              <button key={d.id} type="button" role="radio" className={`choice ${difficulty === d.id ? 'on' : ''}`} onClick={() => setDifficulty(d.id)} aria-checked={difficulty === d.id}>
                <strong>{d.name}</strong>
                <span className="small muted">{d.description}</span>
              </button>
            ))}
          </div>

          <span className="eyebrow">Objetivo sugerido</span>
          <p className="small muted">No bloquea nada: podés combinar todas las rutas cuando quieras. Solo orienta las sugerencias.</p>
          <div className="chips" role="radiogroup" aria-label="Objetivo sugerido">
            {PLAY_STYLES.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={style === p.id} className={style === p.id ? 'on' : ''} onClick={() => setStyle(p.id)}>{p.name}</button>
            ))}
          </div>
          <p className="small">{PLAY_STYLES.find((p) => p.id === style)!.hint}</p>

          <Switch checked={illegal} onChange={() => setIllegal(!illegal)} label={<strong>Actividades ilegales ficticias: {illegal ? 'activadas' : 'desactivadas'}</strong>} sub="Opcionales. Si las activás aparecen sobornos, evasión y negocios clandestinos con riesgos probabilísticos (investigaciones, multas, prisión). Se pueden cambiar en cualquier momento en Ajustes → Partida o en Más → Legal." />

          <div className="field">
            <label htmlFor="seed">Semilla del mundo</label>
            <input id="seed" className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Aleatoria" autoComplete="off" />
            <span className="tiny muted">Misma semilla y mismas decisiones = mismos acontecimientos.</span>
          </div>
        </div>
      </details>

      <button className="btn primary block" style={{ minHeight: 52, fontSize: 16 }} onClick={() => void store.startNewGame({ name: name.trim() || 'Jugador', background: bg, style, color, seed: seed.trim() || undefined, difficulty, illegalEnabled: illegal, look, challenge: ch?.id })}>
        {ch ? `Empezar el desafío: ${ch.title}` : 'Comenzar partida'}
      </button>

      {importing ? <ImportCard /> : (
        <button type="button" className="btn ghost block" onClick={() => setImporting(true)}>
          <Icon name="upload" size={16} /> ¿Ya tenés una partida? Importar
        </button>
      )}
    </div>
  );
}
