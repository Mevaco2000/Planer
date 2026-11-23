// Klawiatura ekranowa: okna (Sheet) mają się mieścić w widocznej części ekranu – nad klawiaturą.
// Android (Chrome) dzięki `interactive-widget=resizes-content` w index.html sam zmniejsza układ strony.
// iOS Safari tego nie robi, więc wysokość i przesunięcie widocznego obszaru (visualViewport)
// trafiają do zmiennych CSS --vvh i --vvt, a okno ustawia się według nich.

/** Przewija treść okna tak, żeby aktywne pole nie chowało się pod klawiaturą ani pod przyciskami u dołu. */
function revealInSheet(el: Element | null) {
  if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select')) return;
  const body = el.closest<HTMLElement>('.sheet-body');
  if (!body) return;
  const r = el.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  const footer = body.querySelector<HTMLElement>('.sticky-actions');
  const bottom = b.bottom - (footer && !footer.contains(el) ? footer.offsetHeight : 0);
  if (r.bottom > bottom - 8) body.scrollTop += r.bottom - bottom + 16;
  else if (r.top < b.top + 8) body.scrollTop -= b.top - r.top + 16;
}

export function installViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  let raf = 0;
  let lastH = 0;
  const update = () => {
    raf = 0;
    // przy powiększeniu dwoma palcami zostaje zwykły układ
    if (vv.scale > 1.01) {
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvt');
      return;
    }
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
    // klawiatura właśnie się wysunęła – pokaż pole, w którym piszesz
    if (lastH && vv.height < lastH - 80) revealInSheet(document.activeElement);
    lastH = vv.height;
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  update();

  document.addEventListener('focusin', (e) => {
    // klawiatura wysuwa się z animacją – sprawdź po jej zakończeniu
    window.setTimeout(() => revealInSheet(e.target as Element), 320);
  });
}
