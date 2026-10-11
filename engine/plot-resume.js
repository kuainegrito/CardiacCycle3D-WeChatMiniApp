// A plot-induced pause is temporary; explicit transport actions cancel it.
export class PlotResume {
  constructor(resume, timers = globalThis) {
    this.resume = resume;
    this.timers = timers;
    this.pending = false;
    this.held = false;
  }
  clear() {
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
  begin() {
    this.held = true;
    this.clear();
  }
  pause(wasPlaying) {
    this.pending ||= wasPlaying;
    this.schedule();
  }
  end() {
    this.held = false;
    this.schedule();
  }
  schedule() {
    this.clear();
    if (!this.pending || this.held) return;
    this.timer = this.timers.setTimeout(() => {
      this.pending = false;
      this.timer = null;
      this.resume();
    }, 7000);
  }
  cancel() {
    this.clear();
    this.pending = false;
    this.held = false;
  }
}
