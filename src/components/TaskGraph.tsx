// Graf zadań – projekty, etapy, zadania i podzadania jako węzły; przerywane linie = zadanie wpływa na kilka większych.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useData } from '../data';
import { useToday } from '../hooks';
import { fmtDue } from '../lib/dates';
import { buildGraph, edgePath, type GraphNode } from '../lib/graph';
import { Icon } from './Icon';
import { Empty } from './ui';
import { useUI } from './UIContext';

const ZOOMS = [0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3];
const OPTS_KEY = 'planer.graph.opts';

function readOpts(): { showDone: boolean; showSubtasks: boolean } {
  try {
    const o = JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') as { showDone?: boolean; showSubtasks?: boolean };
    return { showDone: o.showDone === true, showSubtasks: o.showSubtasks !== false };
  } catch {
    return { showDone: false, showSubtasks: true };
  }
}

const KIND_LABEL = { project: 'Projekt', inbox: 'Skrzynka', stage: 'Etap', task: 'Zadanie', sub: 'Podzadanie' } as const;

function NodeBox({ n, hot, dim, onEnter, onLeave, onOpen }: { n: GraphNode; hot: boolean; dim: boolean; onEnter: () => void; onLeave: () => void; onOpen: () => void }) {
  const today = useToday();
  const cls = [
    'gnode',
    `gnode-${n.kind}`,
    n.done && 'is-done',
    n.overdue && 'is-overdue',
    n.doing && 'is-doing',
    n.shared && 'is-shared',
    n.external && 'is-external',
    hot && 'is-hot',
    dim && 'is-dim',
  ]
    .filter(Boolean)
    .join(' ');
  const pct = n.progress && n.progress.total ? Math.round((n.progress.done / n.progress.total) * 100) : null;
  return (
    <button
      type="button"
      className={cls}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h, ['--gc' as string]: n.color }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={onOpen}
      title={`${KIND_LABEL[n.kind]}: ${n.label}${n.shared ? ' · wpływa na kilka większych zadań' : ''}`}
    >
      {n.kind === 'sub' || n.kind === 'task' ? (
        <span className={`gnode-check ${n.done ? 'on' : ''}`} aria-hidden="true">
          {n.done ? <Icon name="check" size={11} /> : n.step ?? ''}
        </span>
      ) : (
        <span className="gnode-icon" aria-hidden="true">
          <Icon name={n.kind === 'stage' ? 'milestone' : n.kind === 'inbox' ? 'inbox' : 'folder'} size={14} />
        </span>
      )}
      <span className="gnode-text">
        <span className="gnode-label">{n.label}</span>
        {n.kind !== 'sub' && (
          <span className="gnode-meta">
            {n.shared && (
              <span className="gnode-shared">
                <Icon name="link" size={10} /> wspólne
              </span>
            )}
            {n.due && <span className={n.overdue ? 'danger-text' : ''}>{fmtDue(n.due, today)}</span>}
            {n.progress && n.progress.total > 0 && (
              <span>
                {n.progress.done}/{n.progress.total}
              </span>
            )}
            {n.doing && <span className="gnode-doing">w trakcie</span>}
          </span>
        )}
      </span>
      {pct !== null && n.kind !== 'task' && <span className="gnode-bar" style={{ width: `${pct}%` }} aria-hidden="true" />}
    </button>
  );
}

/** Graf zadań projektu (albo wszystkich, gdy bez `projectId`). */
export function TaskGraph({ projectId, stageId }: { projectId?: string; stageId?: string | null }) {
  const { projects, stages, tasks } = useData();
  const { openTask } = useUI();
  const nav = useNavigate();
  const today = useToday();
  const [opts, setOpts] = useState(readOpts);
  const [zoom, setZoom] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const graph = useMemo(
    () => buildGraph({ projects, stages, tasks, today, projectId, stageId, showDone: opts.showDone, showSubtasks: opts.showSubtasks }),
    [projects, stages, tasks, today, projectId, stageId, opts],
  );
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // na start: cały graf na szerokość (ale nie mniejszy niż 60%)
  const fit = () => {
    const w = scroller.current?.clientWidth ?? 800;
    return Math.max(0.6, Math.min(1, (w - 8) / graph.width));
  };
  useLayoutEffect(() => {
    if (zoom === null) setZoom(fit());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, graph.width]);
  const z = zoom ?? 1;

  // Ctrl + kółko myszy = przybliżanie
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((cur) => {
        const c = cur ?? 1;
        return Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], +(c * (e.deltaY < 0 ? 1.1 : 0.9)).toFixed(2)));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const setOpt = (k: 'showDone' | 'showSubtasks', v: boolean) => {
    const next = { ...opts, [k]: v };
    setOpts(next);
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify(next));
    } catch {
      /* tryb prywatny */
    }
  };
  const step = (dir: 1 | -1) => setZoom((cur) => {
    const c = cur ?? 1;
    const next = dir > 0 ? ZOOMS.find((x) => x > c + 0.001) : [...ZOOMS].reverse().find((x) => x < c - 0.001);
    return next ?? c;
  });

  // podświetlenie: najechany węzeł, jego linie i sąsiedzi
  const related = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of graph.edges) {
      if (e.from === hover) s.add(e.to);
      if (e.to === hover) s.add(e.from);
    }
    return s;
  }, [hover, graph]);

  const open = (n: GraphNode) => {
    if ((n.kind === 'task' || n.kind === 'sub') && n.taskId) openTask(n.taskId);
    else if (n.kind === 'project' && n.projectId) nav(`/projekty/${n.projectId}`);
    else if (n.kind === 'stage' && n.projectId) nav(`/projekty/${n.projectId}?etap=${n.stageId}`);
    else if (n.kind === 'inbox') nav('/skrzynka');
  };

  const hasTasks = graph.nodes.some((n) => n.kind === 'task');
  const shared = graph.nodes.filter((n) => n.shared).length;

  return (
    <section className="card graph-card">
      <div className="graph-tools">
        <label className="check-inline">
          <input type="checkbox" checked={opts.showSubtasks} onChange={(e) => setOpt('showSubtasks', e.target.checked)} /> Podzadania
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={opts.showDone} onChange={(e) => setOpt('showDone', e.target.checked)} /> Zrobione
        </label>
        <span className="graph-zoombar">
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => step(-1)} aria-label="Oddal" title="Oddal (Ctrl + kółko)">
            <Icon name="minus" size={16} />
          </button>
          <span className="muted small graph-zoom">{Math.round(z * 100)}%</span>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => step(1)} aria-label="Przybliż" title="Przybliż (Ctrl + kółko)">
            <Icon name="plus" size={16} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => setZoom(fit())} aria-label="Dopasuj" title="Dopasuj do szerokości">
            <Icon name="fit" size={16} />
          </button>
        </span>
      </div>

      {!hasTasks ? (
        <Empty title="Graf jest pusty" icon={<Icon name="graph" size={28} />}>
          {opts.showDone ? 'Nie ma tu jeszcze zadań.' : 'Nie ma otwartych zadań – zaznacz „Zrobione”, żeby zobaczyć zrobione.'}
        </Empty>
      ) : (
        <div className="graph-scroll" ref={scroller}>
          <div className="graph-size" style={{ width: graph.width * z, height: graph.height * z }}>
            <div className="graph-canvas" style={{ width: graph.width, height: graph.height, transform: `scale(${z})` }}>
              <svg className="graph-edges" width={graph.width} height={graph.height} aria-hidden="true">
                <defs>
                  <marker id="garrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" className="garrow" />
                  </marker>
                </defs>
                {graph.edges.map((e) => {
                  const a = byId.get(e.from)!;
                  const b = byId.get(e.to)!;
                  const hot = related !== null && related.has(e.from) && related.has(e.to) && (e.from === hover || e.to === hover);
                  return (
                    <path
                      key={`${e.from}>${e.to}`}
                      d={edgePath(a, b)}
                      className={`gedge gedge-${e.kind} ${hot ? 'is-hot' : ''} ${related && !hot ? 'is-dim' : ''} ${b.done ? 'is-done' : ''}`}
                      markerEnd={e.kind === 'link' ? 'url(#garrow)' : undefined}
                    />
                  );
                })}
              </svg>
              {graph.nodes.map((n) => (
                <NodeBox
                  key={n.id}
                  n={n}
                  hot={hover === n.id}
                  dim={related !== null && !related.has(n.id)}
                  onEnter={() => setHover(n.id)}
                  onLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onOpen={() => open(n)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="hint graph-legend">
        <span className="legend-item">
          <span className="legend-line" /> należy do
        </span>
        <span className="legend-item">
          <span className="legend-line legend-link" /> wpływa też na{shared > 0 ? ` (wspólnych: ${shared})` : ''}
        </span>
        <span>Kliknij węzeł, żeby otworzyć zadanie, etap albo projekt.</span>
      </p>
    </section>
  );
}
