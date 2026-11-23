// Przesuwanie w bok: palcem (treść jedzie za palcem), poziomym gestem na touchpadzie albo strzałkami ← → –
// poprzedni / następny dzień, tydzień albo miesiąc. Pionowe przewijanie i przeciąganie zadań działają jak dotąd.
import { useEffect, useRef, useState } from 'react';

const DECIDE = 10;
const WHEEL_STEP = 90;

function animate(el: HTMLElement, dir: 1 | -1, go: () => void) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.style.transform = '';
    el.style.opacity = '';
    go();
    return;
  }
  const w = el.offsetWidth || window.innerWidth;
  // stara treść wyjeżdża w stronę gestu…
  el.style.transition = 'transform 0.16s ease-in, opacity 0.16s ease-in';
  el.style.transform = `translateX(${-dir * w * 0.5}px)`;
  el.style.opacity = '0';
  window.setTimeout(() => {
    go();
    // …a nowa wjeżdża z drugiej strony
    el.style.transition = 'none';
    el.style.transform = `translateX(${dir * w * 0.3}px)`;
    void el.offsetWidth;
    el.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
    el.style.transform = '';
    el.style.opacity = '';
  }, 160);
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * `onStep(-1)` = wstecz, `onStep(1)` = dalej. Zwraca ref (callback) na element, który ma się przesuwać.
 * `keys` – także strzałki ← → (gdy nie piszesz i nie ma otwartego okna).
 */
export function useSwipe<T extends HTMLElement>(onStep: (dir: 1 | -1) => void, { keys = true }: { keys?: boolean } = {}) {
  const [el, setEl] = useState<T | null>(null);
  const cb = useRef(onStep);
  useEffect(() => {
    cb.current = onStep;
  });

  useEffect(() => {
    if (!el) return;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let dx = 0;
    let mode: 'idle' | 'wait' | 'h' | 'v' = 'idle';
    let busy = false;

    const step = (dir: 1 | -1) => {
      if (busy) return;
      busy = true;
      animate(el, dir, () => cb.current(dir));
      window.setTimeout(() => (busy = false), 420);
    };
    const reset = (smooth: boolean) => {
      el.style.transition = smooth ? 'transform 0.2s ease-out, opacity 0.2s ease-out' : 'none';
      el.style.transform = '';
      el.style.opacity = '';
    };

    const start = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.touches.length !== 1 || busy || target?.closest('input, textarea, select, .plan-resize, [data-noswipe]')) {
        mode = 'idle';
        return;
      }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
      dx = 0;
      mode = 'wait';
    };
    const move = (e: TouchEvent) => {
      if (mode === 'idle' || mode === 'v') return;
      // trwa przeciąganie zadania – to nie jest przesuwanie dni
      if (document.body.classList.contains('is-dragging') || e.touches.length !== 1) {
        if (mode === 'h') reset(true);
        mode = 'idle';
        return;
      }
      dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (mode === 'wait') {
        if (Math.abs(dx) < DECIDE && Math.abs(dy) < DECIDE) return;
        mode = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
        if (mode === 'v') return;
      }
      if (e.cancelable) e.preventDefault();
      const w = el.offsetWidth || window.innerWidth;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx * 0.85}px)`;
      el.style.opacity = String(1 - Math.min(0.4, (Math.abs(dx) / w) * 0.6));
    };
    const end = () => {
      if (mode !== 'h') {
        mode = 'idle';
        return;
      }
      mode = 'idle';
      const w = el.offsetWidth || window.innerWidth;
      const speed = Math.abs(dx) / Math.max(1, Date.now() - t0);
      if (Math.abs(dx) > w * 0.2 || (Math.abs(dx) > 40 && speed > 0.45)) step(dx < 0 ? 1 : -1);
      else reset(true);
    };

    // touchpad: poziomy gest dwoma palcami
    let acc = 0;
    let accTimer = 0;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || document.body.classList.contains('is-dragging')) return;
      acc += e.deltaX;
      clearTimeout(accTimer);
      accTimer = window.setTimeout(() => (acc = 0), 250);
      if (Math.abs(acc) >= WHEEL_STEP && !busy) {
        const dir = acc > 0 ? 1 : -1;
        acc = 0;
        step(dir);
      }
    };

    const key = (e: KeyboardEvent) => {
      if (!keys || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTyping(e.target) || document.querySelector('.sheet') || document.body.classList.contains('is-dragging')) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('wheel', wheel, { passive: true });
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(accTimer);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', key);
    };
  }, [el, keys]);

  return setEl;
}
