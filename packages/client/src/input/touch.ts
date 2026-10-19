// Phone (landscape): floating left stick (push past the edge to sprint), drag the right side to
// look, context buttons on the right. The overlay only appears once the screen is touched.
import type { InputFrame, InputSource } from "./input";

const RADIUS = 56;

export class TouchControls implements InputSource {
  sensitivity = 0.0055;
  lastUsed = 0;
  enabled = false;
  private movePointer = -1;
  private lookPointer = -1;
  private origin = { x: 0, y: 0 };
  private vec = { x: 0, y: 0, sprint: false };
  private look = { x: 0, y: 0, dx: 0, dy: 0 };
  private readonly pressed = new Set<string>();
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.base = el("div", "stick-base");
    this.knob = el("div", "stick-knob");
    this.base.appendChild(this.knob);
    root.appendChild(this.base);

    const buttons = el("div", "touch-buttons");
    for (const [id, label] of [
      ["view", "FP/TP"],
      ["crouch", "Crouch"],
      ["jump", "Jump"],
    ] as const) {
      const b = el("button", `touch-btn touch-${id}`);
      b.textContent = label;
      b.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.pressed.add(id);
        this.lastUsed = performance.now();
      });
      buttons.appendChild(b);
    }
    root.appendChild(buttons);

    root.addEventListener("pointerdown", (e) => this.onDown(e));
    root.addEventListener("pointermove", (e) => this.onMove(e));
    root.addEventListener("pointerup", (e) => this.onUp(e));
    root.addEventListener("pointercancel", (e) => this.onUp(e));
    addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") this.enable();
    }, { capture: true });
  }

  private enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.lastUsed = performance.now();
    document.body.classList.add("touch");
    document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
  }

  private onDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    this.enable();
    this.lastUsed = performance.now();
    if (e.clientX < innerWidth * 0.45 && this.movePointer < 0) {
      this.movePointer = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.vec = { x: 0, y: 0, sprint: false };
      this.base.style.transform = `translate(${e.clientX - RADIUS}px, ${e.clientY - RADIUS}px)`;
      this.base.classList.add("on");
      this.knob.style.transform = "translate(0px, 0px)";
    } else if (this.lookPointer < 0) {
      this.lookPointer = e.pointerId;
      this.look = { x: e.clientX, y: e.clientY, dx: this.look.dx, dy: this.look.dy };
    }
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId === this.movePointer) {
      const dx = e.clientX - this.origin.x;
      const dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      const k = len > RADIUS ? RADIUS / len : 1;
      this.vec = { x: (dx * k) / RADIUS, y: (-dy * k) / RADIUS, sprint: len > RADIUS * 1.25 };
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.knob.classList.toggle("sprint", this.vec.sprint);
    } else if (e.pointerId === this.lookPointer) {
      this.look.dx += e.clientX - this.look.x;
      this.look.dy += e.clientY - this.look.y;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId === this.movePointer) {
      this.movePointer = -1;
      this.vec = { x: 0, y: 0, sprint: false };
      this.base.classList.remove("on");
    } else if (e.pointerId === this.lookPointer) {
      this.lookPointer = -1;
    }
  }

  poll(_dt: number, f: InputFrame) {
    f.moveX += this.vec.x;
    f.moveY += this.vec.y;
    f.sprint ||= this.vec.sprint;
    f.lookX += this.look.dx * this.sensitivity;
    f.lookY += this.look.dy * this.sensitivity;
    this.look.dx = this.look.dy = 0;
    f.jump ||= this.pressed.has("jump");
    f.crouch ||= this.pressed.has("crouch");
    f.toggleView ||= this.pressed.has("view");
    this.pressed.clear();
  }
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
