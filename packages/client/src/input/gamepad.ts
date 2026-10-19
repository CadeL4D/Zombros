// Gamepad (standard mapping): left stick move, right stick look, A jump, B crouch,
// L3 sprint (stays on until you stop), Y first/third person.
import type { InputFrame, InputSource } from "./input";

const A = 0, B = 1, Y = 3, L3 = 10;

/** Radial deadzone, rescaled so output starts at 0 just past the deadzone. */
function stick(x: number, y: number, dead = 0.15): [number, number] {
  const len = Math.hypot(x, y);
  if (len < dead) return [0, 0];
  const s = Math.min(1, (len - dead) / (1 - dead)) / len;
  return [x * s, y * s];
}

export class GamepadInput implements InputSource {
  /** Look speed at full deflection, radians/second. */
  yawRate = 3.2;
  pitchRate = 2.2;
  lastUsed = 0;
  name = "";
  private prev: boolean[] = [];
  private sprintLatched = false;

  poll(dt: number, f: InputFrame) {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected && p.mapping === "standard") ?? null;
    if (!pad) {
      this.name = "";
      return;
    }
    this.name = pad.id;
    const btn = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => !!btn[i] && !this.prev[i];

    const [mx, my] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const [lx, ly] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    // Squared response curve: precise small aims, fast big turns.
    const curve = (v: number) => Math.sign(v) * v * v;
    f.moveX += mx;
    f.moveY -= my;
    f.lookX += curve(lx) * this.yawRate * dt;
    f.lookY += curve(ly) * this.pitchRate * dt;

    if (edge(L3)) this.sprintLatched = true;
    if (Math.hypot(mx, my) < 0.2) this.sprintLatched = false;
    f.sprint ||= this.sprintLatched;
    f.jump ||= edge(A);
    f.crouch ||= edge(B);
    f.toggleView ||= edge(Y);

    if (mx || my || lx || ly || btn.some(Boolean)) this.lastUsed = performance.now();
    this.prev = btn;
  }
}
