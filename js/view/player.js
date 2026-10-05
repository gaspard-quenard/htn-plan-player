// Playback controls. The player only knows a number of steps and the current
// step index (an index into schedule.timePoints); the app maps it to time.
(function (root) {
  'use strict';
  const HTNV = root.HTNV = root.HTNV || {};
  const { el, clear } = HTNV.dom;

  const SPEEDS = [0.5, 1, 2, 4, 8, 16];

  class Player {
    // els: { first, prev, play, next, last, slider, marks, label, speed }
    // api: { count(), step(), setStep(k) }
    constructor(els, api) {
      this.els = els;
      this.api = api;
      this.timer = null;
      this.speed = 2;
      SPEEDS.forEach(s => els.speed.appendChild(el('option', { value: s, text: s + '×', selected: s === this.speed })));
      els.speed.addEventListener('change', () => { this.speed = Number(els.speed.value); if (this.timer) this.play(); });
      els.first.addEventListener('click', () => this.go(0));
      els.prev.addEventListener('click', () => this.go(this.api.step() - 1));
      els.next.addEventListener('click', () => this.go(this.api.step() + 1));
      els.last.addEventListener('click', () => this.go(this.api.count()));
      els.play.addEventListener('click', () => this.toggle());
      els.slider.addEventListener('input', () => { this.pause(); this.api.setStep(Number(els.slider.value)); });
    }

    go(k) {
      this.pause();
      this.api.setStep(Math.max(0, Math.min(this.api.count(), k)));
    }

    play() {
      clearInterval(this.timer);
      if (this.api.step() >= this.api.count()) this.api.setStep(0);
      this.timer = setInterval(() => {
        const k = this.api.step() + 1;
        if (k >= this.api.count()) this.pause();
        this.api.setStep(Math.min(k, this.api.count()));
      }, 1000 / this.speed);
      this.sync();
    }

    pause() { clearInterval(this.timer); this.timer = null; this.sync(); }
    toggle() { if (this.timer) this.pause(); else this.play(); }
    get playing() { return Boolean(this.timer); }

    // Red ticks on the scrubber for steps with a problem.
    setMarks(stepsWithIssues) {
      clear(this.els.marks);
      const n = Math.max(1, this.api.count());
      stepsWithIssues.forEach(k => this.els.marks.appendChild(el('span', { class: 'mark', style: `left:${((k + 0.5) / n) * 100}%` })));
    }

    sync(label) {
      const { slider, play } = this.els;
      slider.max = this.api.count();
      slider.value = this.api.step();
      play.textContent = this.timer ? '⏸' : '▶';
      play.title = this.timer ? 'Pause (Space)' : 'Play (Space)';
      if (label !== undefined) this.els.label.textContent = label;
    }
  }

  HTNV.Player = Player;
})(typeof window !== 'undefined' ? window : globalThis);
