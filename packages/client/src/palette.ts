// Palette contract at runtime: a canvas copy of palette.png whose swatches can be recoloured
// per character (skin tone, clothing colours) without touching UVs or meshes.
import { palette } from "@zombros/shared";
import * as THREE from "three/webgpu";

export class PaletteTexture {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;

  private constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.flipY = false; // glTF UV convention
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
  }

  static async fromImage(image: CanvasImageSource): Promise<PaletteTexture> {
    const canvas = document.createElement("canvas");
    canvas.width = palette.columns * palette.cellSize;
    canvas.height = palette.rows * palette.cellSize;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new PaletteTexture(canvas);
  }

  /** Paint the cell of swatch `name` with a new colour. */
  recolor(name: string, color: string) {
    const sw = palette.swatches[name];
    if (!sw) throw new Error(`unknown swatch ${name}`);
    const s = palette.cellSize;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(sw.cell[0] * s, sw.cell[1] * s, s, s);
    this.texture.needsUpdate = true;
  }
}
