// Przeciąganie zadań: mysz – przeciągnij; dotyk – przytrzymaj i przeciągnij (zwykłe przesunięcie palcem przewija stronę).
// Celem jest najbliższy element z `data-drop="…"`. Przy krawędzi ekranu strona przewija się sama.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';

/** Położenie celu na ekranie – np. do wyliczenia godziny w planie dnia albo „przed/za” na liście kroków. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DragState<T> {
  item: T;
  x: number;
  y: number;
  over: string | null;
  box: Box | null;
  touch: boolean;
}

export interface DropInfo {
  x: number;
  y: number;
  box: Box | null;
}

const LONG_PRESS_MS = 350;
const MOUSE_SLOP = 6;
const TOUCH_SLOP = 10;
const SCROLL_ZONE = 64;

function dropAt(x: number, y: number): { over: string | null; box: Box | null } {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return { over: null, box: null };
  const r = el.getBoundingClientRect();
  return { over: el.dataset.drop ?? null, box: { top: r.top, left: r.left, width: r.width, height: r.height } };
}

/** Czy punkt `y` jest w dolnej połowie celu (wstawienie „za”, a nie „przed”). */
export const isAfter = (y: number, box: Box | null): boolean => (box ? y > box.top + box.height / 2 : true);

export function useDrag<T>(onDrop: (item: T, target: string, info: DropInfo) => void) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const cb = useRef(onDrop);
  useEffect(() => {
    cb.current = onDrop;
  });
  const suppressUntil = useRef(0);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const start = (e: ReactPointerEvent<HTMLElement>, item: T) => {
    if (stop.current || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const touch = e.pointerType !== 'mouse';
    const s = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, over: null as string | null, box: null as Box | null, timer: 0, raf: 0, top: 0, bottom: 0 };

    const refresh = () => {
      const hit = dropAt(s.x, s.y);
      s.over = hit.over;
      s.box = hit.box;
      setDrag({ item, x: s.x, y: s.y, over: s.over, box: s.box, touch });
    };
    const autoScroll = () => {
      let v = 0;
      if (s.y < s.top + SCROLL_ZONE) v = -Math.ceil(((s.top + SCROLL_ZONE - s.y) / SCROLL_ZONE) * 14);
      else if (s.y > s.bottom - SCROLL_ZONE) v = Math.ceil(((s.y - s.bottom + SCROLL_ZONE) / SCROLL_ZONE) * 14);
      if (v) {
        const before = window.scrollY;
        window.scrollBy(0, v);
        if (window.scrollY !== before) refresh();
      }
      s.raf = requestAnimationFrame(autoScroll);
    };
    const activate = () => {
      s.on = true;
      s.top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      s.bottom = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? window.innerHeight;
      if (!touch) {
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* element mógł zniknąć */
        }
      }
      window.getSelection()?.removeAllRanges();
      document.body.classList.add('is-dragging');
      navigator.vibrate?.(15);
      refresh();
      s.raf = requestAnimationFrame(autoScroll);
    };
    const finish = (drop: boolean) => {
      clearTimeout(s.timer);
      cancelAnimationFrame(s.raf);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
      el.removeEventListener('touchmove', touchMove);
      document.body.classList.remove('is-dragging');
      stop.current = null;
      if (!s.on) return;
      suppressUntil.current = Date.now() + 400;
      setDrag(null);
      if (drop && s.over) cb.current(item, s.over, { x: s.x, y: s.y, box: s.box });
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      s.x = ev.clientX;
      s.y = ev.clientY;
      if (!s.on) {
        const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
        if (!touch && dist > MOUSE_SLOP) activate();
        else if (touch && dist > TOUCH_SLOP) finish(false);
        return;
      }
      refresh();
    };
    const touchMove = (ev: TouchEvent) => {
      if (s.on && ev.cancelable) ev.preventDefault();
    };
    const up = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
    const cancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false);
    const blur = () => finish(false);

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    el.addEventListener('touchmove', touchMove, { passive: false });
    if (touch) s.timer = window.setTimeout(activate, LONG_PRESS_MS);
    stop.current = () => finish(false);
  };

  const bind = (item: T) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => start(e, item),
    onClickCapture: (e: SyntheticEvent) => {
      if (Date.now() < suppressUntil.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e: SyntheticEvent) => {
      if (stop.current) e.preventDefault();
    },
    onDragStart: (e: SyntheticEvent) => e.preventDefault(),
  });

  return { drag, bind };
}

export type DragBind = ReturnType<ReturnType<typeof useDrag>['bind']>;

/** Podgląd przeciąganego elementu – przy kursorze albo nad palcem, zawsze w całości na ekranie. */
export function DragGhost({ x, y, touch, children }: { x: number; y: number; touch: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const left = Math.max(8, Math.min(vw - w - 8, touch ? x - w / 2 : x + 14));
    const top = Math.max(8, touch ? y - h - 30 : y + 12);
    card.style.transform = `translate(${left}px, ${top}px) rotate(-1.5deg)`;
  });
  return createPortal(
    <div className="drag-ghost" aria-hidden="true">
      <div ref={ref} className="drag-ghost-card">
        {children}
      </div>
    </div>,
    document.body,
  );
}
