// Проигрыватель персонажа: грузит картинки и model.json, крутит кадры, когда окно видно,
// даёт play/setShow/setMouth/setFlip и масштабирует холст под контейнер с учётом плотности.

import { drawCharacter, type RenderState } from './rig-draw';
import { RigPoseAnimator } from './rig-pose';
import { RigPhysics } from './rig-physics';
import { RigEmotionState, resolveMood } from './rig-emotion';
import { emptyShow, parseModel, type RigClip, type RigModel, type RigShow } from './rig-data';
import { fitMatrix, RigCanvasSizer } from './rig-size';
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
  private emotion: RigEmotionState | null = null;
  private baseShow: RigShow = emptyShow();
  private mouthOverride: string | null = null;
  private pendingMood: string | null = null;
  private flipped = false;
  private readonly blinker = new Blinker();
  private nextBlinkAt = 0;
  private raf = 0;
  private running = false;
  private readonly sizer = new RigCanvasSizer();
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
    this.emotion = new RigEmotionState({
      emotions: model.emotions ?? {},
      emotes: model.emotes ?? {},
      emotionFx: model.emotionFx ?? []
    });
    this.physics.reset();
    this.baseShow = cloneShow(model.show);
    if (this.pendingMood !== null) {
      this.setMood(this.pendingMood);
      this.pendingMood = null;
    }
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
    this.sizer.attach(container, canvas);
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

  // Эмоция или сценка из данных модели: меняет лицо, уши и наклон головы, не трогая клип и речь.
  setMood(name: string): void {
    const model = this.model;
    if (model === null) {
      this.pendingMood = name;
      return;
    }
    const action = resolveMood(model, name);
    if (action.kind === 'reset') {
      this.emotion?.setEmotion(null);
      this.emotion?.stopEmote();
    } else if (action.kind === 'emote') {
      this.emotion?.playEmote(action.name, performance.now());
    } else if (action.kind === 'emotion') {
      this.emotion?.setEmotion(action.name);
      this.emotion?.stopLoopingEmote();
    } else if (model.moods[name] !== undefined) {
      this.setShow(model.moods[name]);
    }
  }

  playEmote(name: string): void {
    this.emotion?.playEmote(name, performance.now());
  }

  setFlip(flipped: boolean): void {
    this.flipped = flipped;
  }

  dispose(): void {
    this.stopLoop();
    this.sizer.detach();
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

  // Кадр: размер холста, клип, физика и отрисовка под текущую обстановку.
  private frame = (now: number): void => {
    if (!this.running) {
      return;
    }
    this.sizer.tick();
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
      let pose = animator.current;
      if (this.emotion !== null) {
        this.emotion.step(now);
        show = this.emotion.face(show);
        pose = this.emotion.pose(pose);
      }
      if (this.mouthOverride !== null) {
        show = { ...show, mouth: this.mouthOverride };
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.physics.step(model, pose, now);
      const state: RenderState = {
        pose,
        show,
        clip,
        blinkK: this.blinkValue(now, show, clip),
        physR: this.physics.rot,
        physS: this.physics.scale,
        image: (src: string) => this.image(src)
      };
      drawCharacter(ctx, model, fitMatrix(this.container, canvas, this.flipped), state);
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
