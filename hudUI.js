export class HUDRenderer {
  constructor(containerEl, statusEl, onCardClick) {
    this.container = containerEl;
    this.status = statusEl;
    this.onCardClick = typeof onCardClick === "function" ? onCardClick : () => {};
  }

  showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "fixed bottom-0 right-0 left-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-end gap-2 pointer-events-none";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const styles = type === "warning" 
      ? "bg-amber-950/95 text-amber-200 border-amber-800"
      : "bg-cyan-950/95 text-cyan-200 border-cyan-800";

    toast.className = `pointer-events-auto max-w-[350px] w-full px-4 py-2.5 rounded-lg border shadow-xl text-xs font-mono font-bold transition-all duration-300 transform translate-y-2 opacity-0 flex items-center justify-between gap-2 ${styles}`;
    toast.innerText = String(message || "");
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove("translate-y-2", "opacity-0"));

    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-y-2");
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (toast.parentNode) toast.remove();
      };
      toast.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 350);
    }, 3000);
  }

  updateScoreboard(state) {
    const elToday = document.getElementById("score-today");
    const elLifetime = document.getElementById("score-lifetime");
    
    const todayPoints = state?.today?.points ?? 0;
    const lifetimePoints = state?.lifetime?.points ?? 0;

    if (elToday && elToday.innerText !== String(todayPoints)) {
      elToday.innerText = todayPoints;
    }
    if (elLifetime && elLifetime.innerText !== String(lifetimePoints)) {
      elLifetime.innerText = lifetimePoints;
    }
  }

  showRareAlertBanner(ac) {
    if (!this.container || !this.container.parentNode || !ac) return;

    let banner = document.getElementById("rare-alert-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "rare-alert-banner";
      this.container.parentNode.insertBefore(banner, this.container);
    }

    const tier = ac.scoreMeta?.tier || "ALERT";
    const elevation = ac.elevation ?? 0;
    const distNM = ac.distNM ?? 0;
    const bearing = ac.bearing ?? 0;

    banner.className = "w-full mb-4 p-3.5 rounded-xl bg-gradient-to-r from-amber-950/90 via-slate-900 to-amber-950/90 border-2 border-amber-500/80 shadow-[0_0_25px_rgba(245,158,11,0.35)] backdrop-blur-md flex items-center justify-between text-amber-200 font-mono transition-all duration-500";

    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="px-2.5 py-1 text-xs font-black bg-amber-500 text-slate-950 rounded uppercase tracking-widest shadow-sm">
          🚨 ${tier} AIRCRAFT
        </span>
        <div>
          <div class="font-black text-white text-sm tracking-wide">${ac.callsign} <span class="text-amber-400 font-normal">(${ac.type})</span></div>
          <div class="text-[11px] text-slate-400">${ac.operator} · TAIL: ${ac.tail}</div>
        </div>
      </div>
      <div class="text-right">
        <div class="text-sm font-bold text-amber-300">${elevation}° ELEV</div>
        <div class="text-[10px] text-slate-400 uppercase tracking-wider">${distNM} NM @ ${bearing}°</div>
      </div>
    `;
  }

  clearRareAlertBanner() {
    const banner = document.getElementById("rare-alert-banner");
    if (banner) banner.remove();
  }

  renderBoard(activeFlights) {
    if (!this.container) return;

    const flights = Array.isArray(activeFlights) ? activeFlights : [];

    if (flights.length === 0) {
      if (this.status) this.status.style.display = "block";
      this.container.innerHTML = "";
      return;
    }
    if (this.status) this.status.style.display = "none";

    const activeCards = Array.from(this.container.children).filter(
      c => c.dataset && c.dataset.hex && !c.classList.contains("card-exit")
    );
    const firstPositions = new Map();
    activeCards.forEach(card => {
      firstPositions.set(card.dataset.hex, card.getBoundingClientRect().top);
    });

    const currentHexes = new Set(flights.map(ac => ac.hex));

    activeCards.forEach(card => {
      if (!currentHexes.has(card.dataset.hex)) {
        card.classList.add("card-exit");
        let removed = false;
        const removeCard = () => {
          if (removed) return;
          removed = true;
          if (card.parentNode) card.remove();
        };
        card.addEventListener("animationend", removeCard, { once: true });
        setTimeout(removeCard, 350);
      }
    });

    flights.forEach((ac, index) => {
      let card = this.container.querySelector(`[data-hex="${ac.hex}"]`);
      if (!card) {
        card = this.createCardElement(ac);
      } else {
        this.updateCardTelemetry(card, ac);
      }

      const currentNodes = Array.from(this.container.children).filter(el => !el.classList.contains("card-exit"));
      if (currentNodes[index] !== card) {
        this.container.insertBefore(card, currentNodes[index] || null);
      }
    });

    const updatedCards = Array.from(this.container.children).filter(
      c => c.dataset && c.dataset.hex && !c.classList.contains("card-exit")
    );

    const transformsToApply = [];
    updatedCards.forEach(card => {
      const firstTop = firstPositions.get(card.dataset.hex);
      if (firstTop !== undefined) {
        const lastTop = card.getBoundingClientRect().top;
        const deltaY = firstTop - lastTop;
        if (deltaY !== 0) {
          transformsToApply.push({ card, deltaY });
        }
      }
    });

    if (transformsToApply.length > 0) {
      transformsToApply.forEach(({ card, deltaY }) => {
        card.style.transition = "none";
        card.style.transform = `translateY(${deltaY}px)`;
      });

      void this.container.offsetHeight;

      transformsToApply.forEach(({ card }) => {
        card.style.transition = "transform 350ms cubic-bezier(0.2, 0, 0, 1)";
        card.style.transform = "translateY(0)";
      });
    }
  }

  createCardElement(ac) {
    const card = document.createElement("div");
    card.dataset.hex = ac.hex;
    card.className = "relative w-full p-3.5 sm:p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-lg font-mono card-enter transition-all duration-300 cursor-pointer active:scale-[0.99] touch-manipulation select-none";
    card.style.webkitTapHighlightColor = "transparent";
    card.onclick = () => this.onCardClick(ac);

    const badgeStyle = ac.scoreMeta?.badge || "bg-slate-800 text-slate-300 border-slate-700";
    const tier = ac.scoreMeta?.tier || "COMMON";
    const points = ac.scoreMeta?.points ?? 10;

    card.innerHTML = `
      <div class="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs">
        <span class="px-2 py-0.5 text-[10px] sm:text-xs font-bold uppercase rounded border ${badgeStyle}">${tier} · +${points} PT</span>
        <span class="text-emerald-400 font-bold text-[10px] flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> IN RANGE</span>
      </div>
      <div class="flex justify-between items-start mb-2.5">
        <div class="min-w-0 pr-2">
          <div class="text-lg sm:text-xl font-black text-cyan-300 flex items-center gap-1.5 truncate">
            ${ac.callsign} 
            <span class="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-normal shrink-0">${ac.type}</span>
          </div>
          <div class="text-xs text-slate-300 truncate">${ac.operator}</div>
          <div class="text-[10px] text-slate-500">TAIL: ${ac.tail}</div>
        </div>
        <div class="text-right bg-slate-950 px-2 py-1 rounded border border-slate-800 shrink-0">
          <div data-field="elevation" class="text-sm sm:text-base font-bold text-amber-400 leading-none">${ac.elevation}° ↑</div>
          <div class="text-[8px] text-slate-500 uppercase mt-0.5">ELEVATION</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-1 p-2 bg-slate-950 rounded text-center text-[10px] sm:text-[11px] text-slate-300">
        <div><span class="block text-[8px] text-slate-500">ALTITUDE</span><span data-field="alt">${ac.alt}</span> FT</div>
        <div><span class="block text-[8px] text-slate-500">SPEED</span><span data-field="speed">${ac.speed}</span> KTS</div>
        <div><span class="block text-[8px] text-slate-500">RANGE</span><span data-field="range">${ac.distNM}M @ ${ac.bearing}°</span></div>
      </div>
    `;
    return card;
  }

  updateCardTelemetry(card, ac) {
    this.updateField(card.querySelector('[data-field="elevation"]'), `${ac.elevation}° ↑`);
    this.updateField(card.querySelector('[data-field="alt"]'), ac.alt);
    this.updateField(card.querySelector('[data-field="speed"]'), ac.speed);
    this.updateField(card.querySelector('[data-field="range"]'), `${ac.distNM}M @ ${ac.bearing}°`);
    card.onclick = () => this.onCardClick(ac);
  }

  updateField(el, val) {
    if (el && el.innerText !== String(val)) {
      el.innerText = String(val);
    }
  }
}