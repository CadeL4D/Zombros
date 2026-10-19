// One input frame per tick, merged from keyboard + mouse, gamepad and touch (DESIGN.md §14).
// Game code only ever sees InputFrame, never devices.
import { GamepadInput } from "./gamepad";
import { KeyboardMouse } from "./keyboardMouse";
import { TouchControls } from "./touch";

export interface InputFrame {
  /** Strafe, -1 (left) .. 1 (right). */
  moveX: number;
  /** Forward, -1 (back) .. 1 (forward). */
  moveY: number;
  /** Look deltas this frame, radians (positive = right / down). */
  lookX: number;
  lookY: number;
  sprint: boolean;
  /** Pressed this frame. */
  jump: boolean;
  crouch: boolean;
  toggleView: boolean;
}

export interface InputSource {
  poll(dt: number, out: InputFrame): void;
}

export const emptyFrame = (): InputFrame => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, sprint: false, jump: false, crouch: false, toggleView: false });

export class Input {
  readonly keyboard: KeyboardMouse;
  readonly gamepad = new GamepadInput();
  readonly touch: TouchControls;
  private readonly frame = emptyFrame();

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.keyboard = new KeyboardMouse(canvas);
    this.touch = new TouchControls(overlay);
  }

  /** "keyboard" | "gamepad" | "touch": whichever was used last. */
  get active() {
    if (this.touch.lastUsed >= Math.max(this.keyboard.lastUsed, this.gamepad.lastUsed)) return this.touch.lastUsed ? "touch" : "keyboard";
    return this.gamepad.lastUsed > this.keyboard.lastUsed ? "gamepad" : "keyboard";
  }

  poll(dt: number): InputFrame {
    const f = Object.assign(this.frame, emptyFrame());
    this.keyboard.poll(dt, f);
    this.gamepad.poll(dt, f);
    this.touch.poll(dt, f);
    const len = Math.hypot(f.moveX, f.moveY);
    if (len > 1) {
      f.moveX /= len;
      f.moveY /= len;
    }
    return f;
  }
}
