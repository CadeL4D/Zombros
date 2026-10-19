// PC: WASD + mouse (pointer lock). Shift sprint, C crouch, Space jump, V first/third person.
import type { InputFrame, InputSource } from "./input";

export class KeyboardMouse implements InputSource {
  sensitivity = 0.0022;
  lastUsed = 0;
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private dx = 0;
  private dy = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    addEventListener("keydown", (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.lastUsed = performance.now();
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.down.delete(e.code));
    addEventListener("blur", () => this.down.clear());
    addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
      this.lastUsed = performance.now();
    });
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  lock() {
    // Some browsers reject unadjustedMovement; fall back to a plain lock.
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
    p?.catch(() => this.canvas.requestPointerLock());
  }

  /** Was `code` pressed since the last poll? (For UI keys outside InputFrame.) */
  consume(code: string) {
    return this.pressed.delete(code);
  }

  poll(_dt: number, f: InputFrame) {
    const k = (c: string) => (this.down.has(c) ? 1 : 0);
    f.moveX += k("KeyD") - k("KeyA");
    f.moveY += k("KeyW") - k("KeyS");
    f.lookX += this.dx * this.sensitivity;
    f.lookY += this.dy * this.sensitivity;
    this.dx = this.dy = 0;
    f.sprint ||= this.down.has("ShiftLeft") || this.down.has("ShiftRight");
    f.jump ||= this.pressed.has("Space");
    f.crouch ||= this.pressed.has("KeyC");
    f.toggleView ||= this.pressed.has("KeyV");
    for (const c of ["Space", "KeyC", "KeyV"]) this.pressed.delete(c);
  }
}
