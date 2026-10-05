// Проигрыватель персонажа: грузит картинки и model.json, крутит кадры, когда окно видно,
// даёт play/setShow/setMouth/setFlip и масштабирует холст под контейнер с учётом плотности.

import { drawCharacter, type RenderState } from './rig-draw';
import { IDENTITY, scale, translate, type Mat } from './rig-matrix';
import { RigPoseAnimator } from './rig-pose';
import { RigPhysics } from './rig-physics';
import { emptyShow, parseModel, type RigClip, type RigModel, type RigShow } from './rig-data';
import { Blinker, nextBlinkDelay, shouldAutoBlink, showAt } from './rig-show';

export interface RigPlayerOptions {
  basePath?: string;
  modelFile?: string;
  loadModel?: (url: string) => Promise<string>;
}

function cloneShow(show: RigShow): RigShow {
  return { ...show, fx: [...show.fx] };
}

function defaultLoader(url: string): Promise<string> {
  return fetch(url).then((response) => response.text());
}

export class RigPlayer {
  private readonly basePath: string;
  private readonly modelFile: string;
  private readonly loader: (url: string) => Promise<string>;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private model: RigModel | null = null;
  private readonly images = new Map<string, HTMLImageElement>();
  private animator: RigPoseAnimator | null = null;
  private readonly physics = new RigPhysics();
  private baseShow: RigShow = emptyShow();
  private mouthOverride: string | null = null;
  private flipped = false;
  private readonly blinker = new Blinker();
  private nextBlinkAt = 0;
  private raf = 0;
  private running = false;
  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.stopLoop();
    } else {
      this.startLoop();
    }
  };

  constructor(options: RigPlayerOptions = {}) {
    this.basePath = options.basePath ?? '../model';
    this.modelFile = options.modelFile ?? 'model.json';
    this.loader = options.loadModel ?? defaultLoader;
  }

  get data(): RigModel | null {
    return this.model;
  }

  async load(): Promise<void> {
    const model = parseModel(await this.loader(`${this.basePath}/${this.modelFile}`));
    this.model = model;
    this.animator = new RigPoseAnimator(model.clips);
    this.physics.reset();
    this.baseShow = cloneShow(model.show);
    for (const layer of model.layers) {
      this.image(layer.src);
    }
  }

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    const canvas = document.createElement('canvas');
    canvas.className = 'rig-canvas';
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    container.replaceChildren(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    document.addEventListener('visibilitychange', this.onVisibility);
    this.startLoop();
  }

  clips(): string[] {
    return this.model === null ? [] : Object.keys(this.model.clips);
  }

  play(name: string): void {
    this.animator?.playClip(name, performance.now());
  }

  setShow(patch: Partial<RigShow>): void {
    this.baseShow = { ...this.baseShow, ...patch, fx: patch.fx !== undefined ? [...patch.fx] : this.baseShow.fx };
  }

  setMouth(shape: string | null): void {
    this.mouthOverride = shape;
  }

  setFlip(flipped: boolean): void {
    this.flipped = flipped;
  }

  dispose(): void {
    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.container?.replaceChildren();
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  }

  private image(src: string): HTMLImageElement | undefined {
    let img = this.images.get(src);
    if (img === undefined && typeof Image !== 'undefined') {
      img = new Image();
      img.src = `${this.basePath}/${src}`;
      this.images.set(src, img);
    }
    return img;
  }

  // Масштаб под контейнер с учётом плотности пикселей; повторяется на смену размера окна.
  private baseMatrix(): Mat {
    const canvas = this.canvas;
    if (canvas === null) {
      return IDENTITY;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = this.container?.clientWidth ?? canvas.clientWidth;
    const height = this.container?.clientHeight ?? canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    canvas.style.transform = this.flipped ? 'scaleX(-1)' : '';
    const s = Math.min(width / 520, height / 1220);
    let base = scale(IDENTITY, dpr, dpr);
    base = translate(base, width / 2 - 400 * s, height / 2 - 605 * s);
    return scale(base, s, s);
  }

  private frame = (now: number): void => {
    if (!this.running) {
      return;
    }
    const model = this.model;
    const animator = this.animator;
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (model !== null && animator !== null && ctx !== null && canvas !== null) {
      const phase = animator.update(now);
      if (phase.ended && phase.next !== undefined) {
        animator.playClip(phase.next, now);
      }
      const clip: RigClip | null = animator.clip;
      let show = showAt(this.baseShow, clip, phase.time);
      if (this.mouthOverride !== null) {
        show = { ...show, mouth: this.mouthOverride };
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.physics.step(model, animator.current, now);
      const state: RenderState = {
        pose: animator.current,
        show,
        clip,
        blinkK: this.blinkValue(now, show, clip),
        physR: this.physics.rot,
        physS: this.physics.scale,
        image: (src: string) => this.image(src)
      };
      drawCharacter(ctx, model, this.baseMatrix(), state);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private blinkValue(now: number, show: RigShow, clip: RigClip | null): number {
    if (!this.blinker.active && now >= this.nextBlinkAt) {
      if (shouldAutoBlink(show, clip)) {
        this.blinker.begin(now);
      }
      this.nextBlinkAt = now + nextBlinkDelay();
    }
    return this.blinker.value(now) ?? 1;
  }

  private startLoop(): void {
    if (!this.running) {
      this.running = true;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private stopLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
