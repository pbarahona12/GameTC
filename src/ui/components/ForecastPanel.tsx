import { useEffect, useRef, useState } from 'react';
import { store, useGame } from '../store';
import { InfoButton, Pill, Bar } from './common';
import { BandChart } from './charts';
import {
  forecastSample, summarizeForecast, forecastRuns, forecastSkill, forecastError, recordForecastPractice,
  type BusinessForecast, type ForecastSample, type ForecastTarget, FORECAST_MONTHS,
} from '../../engine/advisor/businessForecast';
import { deepClone } from '../../engine/clone';
import { fmtMoney, fmtPct } from '../../engine/format';
import { Icon } from '../icons';

/**
 * Panel de "Proyección de negocios": simula varios futuros (sin congelar la
 * pantalla: un futuro por vez) y muestra el abanico de escenarios en lenguaje simple.
 */
export function ForecastPanel({ target, onResult, title = 'Proyección a 12 meses', compact = false }: { target: ForecastTarget; onResult?: (f: BusinessForecast) => void; title?: string; compact?: boolean }) {
  const s = useGame();
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  // El resultado (o error) pertenece a un objetivo: si el objetivo cambia, deja de mostrarse.
  const [outcome, setOutcome] = useState<{ key: string; result?: BusinessForecast; error?: string } | null>(null);
  const [view, setView] = useState<'net' | 'cash' | 'revenue'>('net');
  const cancel = useRef(false);
  const key = JSON.stringify(target);
  const result = outcome?.key === key ? outcome.result ?? null : null;
  const error = outcome?.key === key ? outcome.error ?? null : null;
  useEffect(() => () => {
    cancel.current = true;
  }, []);
  const skill = forecastSkill(s);
  const runs = forecastRuns(s);
  const run = async () => {
    cancel.current = false;
    const forKey = key;
    setOutcome(null);
    const base = deepClone(s);
    const samples: ForecastSample[] = [];
    setRunning({ done: 0, total: runs });
    for (let r = 0; r < runs; r++) {
      await new Promise((ok) => setTimeout(ok, 0));
      if (cancel.current) return;
      const x = forecastSample(base, target, FORECAST_MONTHS, r);
      if ('error' in x) {
        setOutcome({ key: forKey, error: x.error });
        setRunning(null);
        return;
      }
      samples.push(x);
      setRunning({ done: r + 1, total: runs });
    }
    const f = summarizeForecast(base, target, samples);
    setOutcome({ key: forKey, result: f });
    setRunning(null);
    store.run((st) => recordForecastPractice(st, f), { toast: false });
    onResult?.(f);
  };
  const tone = (p: number) => (p >= 0.8 ? 'gain' : p >= 0.6 ? 'warn' : 'loss') as 'gain' | 'warn' | 'loss';
  return (
    <div className="card flat forecast">
      <div className="card-head">
        <strong style={{ flex: 1 }}><Icon name="sparkles" size={15} /> {title}</strong>
        <InfoButton term="proyeccion_negocios" />
      </div>
      {!result && !running && (
        <>
          {!compact && <p className="small muted">Simula {runs} futuros posibles con las reglas reales del juego y te muestra qué puede pasar: el escenario malo, el central y el bueno. Tu nivel de Proyección de negocios es {skill}: tu lectura puede desviarse ±{Math.round(forecastError(skill) * 100)} %.</p>}
          <span className="act"><button className="btn sm dark" onClick={() => void run()}>Proyectar</button><InfoButton term="accion_proyectar" /></span>
        </>
      )}
      {running && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Simulando futuro {running.done + (running.done < running.total ? 1 : 0)} de {running.total}…</span>
          <Bar value={running.done / running.total} />
        </div>
      )}
      {error && <p className="small loss">{error}</p>}
      {result && (
        <>
          <div className="fc-grid">
            <div className="fc-tile">
              <span className="tiny muted">Sigue abierta al mes {result.months} <InfoButton term="probabilidad_supervivencia" /></span>
              <strong className={tone(result.survival)}>{Math.round(result.survival * 10)} de 10</strong>
            </div>
            <div className="fc-tile">
              <span className="tiny muted">Empieza a ganar</span>
              <strong>{result.breakEvenMonth ? `mes ${result.breakEvenMonth}` : 'no en 12 meses'}</strong>
            </div>
            <div className="fc-tile wide">
              <span className="tiny muted">Resultado del año <InfoButton term="escenarios_bandas" /></span>
              <span className="fc-range">
                <span className="loss">{fmtMoney(result.total.p10, { decimals: false })}</span>
                <strong className={result.total.p50 >= 0 ? 'gain' : 'loss'}>{fmtMoney(result.total.p50, { decimals: false })}</strong>
                <span className="gain">{fmtMoney(result.total.p90, { decimals: false })}</span>
              </span>
              <span className="tiny faint">malo · central · bueno</span>
            </div>
          </div>
          <div className="seg" role="tablist">
            {([['net', 'Ganancia'], ['cash', 'Caja'], ['revenue', 'Ventas']] as const).map(([id, l]) => (
              <button key={id} className={view === id ? 'on' : ''} aria-pressed={view === id} onClick={() => setView(id)}>{l}</button>
            ))}
          </div>
          <BandChart bands={result[view]} label={`Proyección de ${view}`} color={view === 'net' ? 'var(--accent)' : view === 'cash' ? 'var(--info)' : 'var(--gain)'} />
          <ul className="small fc-insights">{result.insights.map((i) => <li key={i}>{i}</li>)}</ul>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tone={result.confidence === 'alta' ? 'gain' : result.confidence === 'media' ? 'warn' : 'loss'}>Confianza {result.confidence}</Pill>
            <span className="tiny muted">{result.runs} futuros · lectura ±{fmtPct(result.errorPct, 0)}</span>
          </div>
          <p className="tiny muted">{result.note}</p>
          <button className="btn sm ghost" onClick={() => void run()}>Volver a proyectar</button>
        </>
      )}
    </div>
  );
}
