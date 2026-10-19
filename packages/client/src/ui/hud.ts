// Minimal HUD (DESIGN.md §14): compass strip and clock at the top, crosshair, plus a debug
// panel (F3), a controls card (H) and the click-to-play / loading overlays.

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Pixels per degree on the compass strip. */
const PX = 3;

export class Hud {
  private readonly compass: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly help: HTMLElement;
  readonly start: HTMLElement;
  private readonly loading: HTMLElement;
  showDebug = new URLSearchParams(location.search).has("debug");

  constructor(root: HTMLElement) {
    this.compass = div(root, "compass");
    this.strip = div(this.compass, "compass-strip");
    // Three laps so the strip can scroll seamlessly.
    for (let lap = -1; lap <= 1; lap++) {
      for (let d = 0; d < 360; d += 15) {
        const t = div(this.strip, d % 45 === 0 ? "tick major" : "tick");
        t.style.left = `${(lap * 360 + d) * PX}px`;
        if (d % 45 === 0) t.textContent = POINTS[d / 45]!;
      }
    }
    div(this.compass, "compass-mark");
    this.clock = div(root, "clock");
    div(root, "crosshair");
    this.debug = div(root, "debug");
    this.help = div(root, "help");
    this.help.innerHTML = HELP;
    this.start = div(root, "start");
    this.start.innerHTML = `<div class="card"><h1>ZOMBROS</h1><p class="go">Click to play</p>${HELP}</div>`;
    this.loading = div(root, "loading");
    this.loading.textContent = "Generating world…";
  }

  toggleHelp() {
    this.help.classList.toggle("on");
  }

  setLoading(on: boolean) {
    this.loading.classList.toggle("on", on);
  }

  setStart(on: boolean) {
    this.start.classList.toggle("on", on);
  }

  update(yaw: number, day: number, clock: string, debug: () => string) {
    const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
    this.strip.style.transform = `translateX(${-heading * PX}px)`;
    this.clock.textContent = `Day ${day} · ${clock}`;
    this.debug.classList.toggle("on", this.showDebug);
    if (this.showDebug) this.debug.textContent = debug();
  }
}

const HELP = `<table class="keys">
<tr><th></th><th>PC</th><th>Gamepad</th><th>Phone</th></tr>
<tr><td>Move</td><td>WASD</td><td>Left stick</td><td>Left thumb</td></tr>
<tr><td>Look</td><td>Mouse</td><td>Right stick</td><td>Drag right side</td></tr>
<tr><td>Sprint</td><td>Shift</td><td>L3</td><td>Push stick to edge</td></tr>
<tr><td>Jump</td><td>Space</td><td>A</td><td>Jump</td></tr>
<tr><td>Crouch</td><td>C</td><td>B</td><td>Crouch</td></tr>
<tr><td>First / third person</td><td>V</td><td>Y</td><td>FP/TP</td></tr>
</table>
<p class="small">H controls · F3 debug · T fast time · [ ] ±1 hour</p>`;

function div(parent: HTMLElement, cls: string) {
  const e = document.createElement("div");
  e.className = cls;
  parent.appendChild(e);
  return e;
}
