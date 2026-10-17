// Sketchfab renders only the background. The avatar, webcam and pose landmarks
// never enter this frame or its API.
//
// Crop: the free embed keeps a "click & hold to rotate" hint and the Sketchfab
// logo in the bottom ~140 px of the viewer. The viewer renders CROP_PX larger
// than the stage on every side (same aspect, centred) with a matching wider
// field of view, so the visible framing is unchanged and that strip falls
// outside the stage. Sketchfab and each model's author are credited in the
// stage's credit line instead. Lekan has permission for this (2026-10-17);
// Sketchfab's terms otherwise reserve hiding the logo to Premium/Enterprise.
import type { BackgroundDef } from './backgrounds';
import type { BackgroundQuality } from './backgroundQuality';
import { BackgroundMotionClock, backgroundViewAt, type BackgroundView } from './backgroundMotion';
import { NO_TURN, turnBetween, turnView, type ViewTurn } from './viewTurn';

const SDK_URL = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js';
type Callback = (error?: unknown) => void;
interface ViewerApi {
  start(callback?: Callback): void;
  stop(callback?: Callback): void;
  addEventListener(event: string, callback: () => void): void;
  setUserInteraction(enabled: boolean, callback?: Callback): void;
  setTextureQuality(quality: 'hd' | 'sd' | 'ld', callback?: Callback): void;
  setCameraEasing(easing: string): void;
  setEnableCameraConstraints(enabled: boolean, options: { preventCameraConstraintsFocus: boolean }): void;
  getCameraLookAt(callback: (error: unknown, camera: BackgroundView) => void): void;
  getFov(callback: (error: unknown, fov: number) => void): void;
  setFov?(fov: number, callback?: Callback): void;
  setCameraLookAt(position: number[], target: number[], seconds: number, callback?: Callback): void;
  getScreenShot(width: number, height: number, mime: string, callback: (error: unknown, data: string) => void): void;
}
interface ViewerOptions { success(api: ViewerApi): void; error(error?: unknown): void; [key: string]: unknown }
type SketchfabConstructor = new (version: string, frame: HTMLIFrameElement) => { init(uid: string, options: ViewerOptions): void };
type SdkWindow = Window & { Sketchfab?: SketchfabConstructor };

/** how far the viewer reaches past the stage on each side, in CSS px (covers the hint and logo) */
const CROP_PX = 160;

/** Some UI/branding switches depend on the model owner's Sketchfab plan; the
 * rest is cropped (see the note at the top). */
export const SKETCHFAB_BACKGROUND_OPTIONS = {
  autostart: 1, preload: 1, camera: 0, autospin: 0, animation_autoplay: 1,
  annotations_visible: 0, annotation_tooltip_visible: 0, dnt: 1,
  ui_hint: 0, ui_controls: 0, ui_infos: 0, ui_stop: 0, ui_watermark: 0,
  ui_annotations: 0, ui_animations: 0, ui_general_controls: 0, ui_help: 0,
  ui_settings: 0, ui_inspector: 0, ui_vr: 0, ui_ar: 0, ui_fullscreen: 0,
  ui_loading: 0, ui_start: 0,
  double_click: 0, prevent_user_light_rotation: 1,
};

export function sketchfabModelId(def: BackgroundDef): string {
  const id = new URL(def.credits[0].source).pathname.match(/([a-f0-9]{32})\/?$/)?.[1];
  if (!id) throw new Error(`No Sketchfab model ID for ${def.id}`);
  return id;
}

function loadSdk(frame: HTMLIFrameElement, signal: AbortSignal): Promise<SketchfabConstructor> {
  const owner = frame.contentWindow as SdkWindow;
  const document = frame.contentDocument!;
  const existing = owner.Sketchfab;
  if (existing) return Promise.resolve(existing);
  return new Promise<SketchfabConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), 15000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', fail); };
    const fail = () => { cleanup(); script.remove(); reject(new Error('Sketchfab API could not load')); };
    script.src = SDK_URL; script.async = true; script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onerror = fail;
    script.onload = () => {
      cleanup();
      const Constructor = owner.Sketchfab;
      if (Constructor) resolve(Constructor); else fail();
    };
    signal.addEventListener('abort', fail, {once: true});
    if (signal.aborted) { fail(); return; }
    document.head.append(script);
  });
}

interface Viewer {
  frame: HTMLIFrameElement;
  api?: ViewerApi;
  def: BackgroundDef;
  camera?: BackgroundView;
  clock: BackgroundMotionClock;
  commands: number;
  acknowledgements: number;
  requestedCamera?: BackgroundView;
  observedCamera?: BackgroundView;
  cameraError: string | null;
  screenshotPending?: Promise<HTMLImageElement | null>;
  screenshot?: HTMLImageElement;
  cancel(): void;
}

export class SketchfabBackground {
  private host: HTMLDivElement;
  private current?: Viewer;
  private pending?: Viewer;
  private token = 0;
  private visible = true;
  private playing = false;
  private cameraTimer?: number;
  private quality: BackgroundQuality = 'maximum';
  /** the visitor's drag/zoom, shared with the avatar camera (./viewTurn.ts) */
  private turn: ViewTurn = NO_TURN;
  private sentTurn: ViewTurn | null = null;
  private sentAt = 0;
  /** the field of view the scene should show (before the crop's widening) */
  private sentFov = NaN;
  /** the viewer's size over the stage's */
  private scale = 1;
  private resize = new ResizeObserver(() => this.layout());
  private visibility = () => this.updateVisibility();

  constructor(parent: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'sketchfab-background';
    this.host.setAttribute('aria-hidden', 'true');
    this.host.inert = true;
    parent.prepend(this.host);
    document.addEventListener('visibilitychange', this.visibility);
    this.resize.observe(this.host);
  }

  /** size every viewer frame past the stage (see the crop note at the top) */
  private layout(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    const scale = (height + 2 * CROP_PX) / height;
    this.scale = scale;
    for (const frame of this.host.querySelectorAll<HTMLIFrameElement>(':scope > iframe')) this.sizeFrame(frame);
    const viewer = this.current;
    if (viewer?.api?.setFov && Number.isFinite(this.sentFov)) viewer.api.setFov(this.viewerFov(this.sentFov));
  }

  private sizeFrame(frame: HTMLIFrameElement): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    Object.assign(frame.style, {
      width: `${width * this.scale}px`, height: `${height * this.scale}px`,
      left: `${(width - width * this.scale) / 2}px`, top: `${-CROP_PX}px`, right: 'auto', bottom: 'auto',
    });
  }

  /** the wider field of view that shows `fov` across the visible stage */
  private viewerFov(fov: number): number {
    return Math.min(170, 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * this.scale) * 180 / Math.PI);
  }

  get active(): boolean { return !!this.current; }

  get motionStatus(): unknown {
    const viewer = this.current;
    return viewer ? {
      id: viewer.def.id, running: this.playing,
      seconds: viewer.clock.seconds(performance.now()),
      commands: viewer.commands, acknowledgements: viewer.acknowledgements,
      lastError: viewer.cameraError, requested: viewer.requestedCamera, observed: viewer.observedCamera,
    } : null;
  }

  async load(def: BackgroundDef): Promise<boolean> {
    const token = ++this.token;
    this.release(this.pending); this.pending = undefined;
    window.dispatchEvent(new CustomEvent('bodyarcade-external-background', { detail: { active: true } }));
    const frame = document.createElement('iframe');
    frame.title = `${def.label} background`;
    frame.tabIndex = -1; frame.inert = true;
    frame.allow = 'autoplay'; // deliberately no camera or microphone permission
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.style.opacity = '0'; // keep the previous scene while this loads
    frame.setAttribute('execution-while-not-rendered', '');
    this.host.append(frame);
    this.sizeFrame(frame);
    // The published SDK has global message listeners and no public dispose.
    // Its own small, same-origin realm is destroyed with the background, so
    // switches release SDK listeners/requests without relying on private APIs.
    const controller = frame.contentDocument!;
    controller.documentElement.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden';
    controller.body.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden';
    const embed = controller.createElement('iframe');
    embed.title = frame.title; embed.tabIndex = -1; embed.inert = true; embed.allow = 'autoplay';
    embed.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none';
    embed.referrerPolicy = frame.referrerPolicy;
    controller.body.append(embed);
    const abort = new AbortController();
    const viewer: Viewer = {
      frame, def, clock: new BackgroundMotionClock(), commands: 0, acknowledgements: 0,
      cameraError: null, cancel: () => abort.abort(),
    };
    this.pending = viewer;
    try {
      const Constructor = await loadSdk(frame, abort.signal);
      if (token !== this.token) { this.release(viewer); return false; }
      const ready = await new Promise<boolean>((resolve, reject) => {
        let finished = false;
        const finish = (error?: unknown, cancelled = false) => {
          if (finished) return;
          finished = true; clearTimeout(timer);
          if (error) reject(error); else resolve(!cancelled);
        };
        const timer = setTimeout(() => finish(new Error(`Sketchfab ${def.id} did not become ready`)), 60000);
        viewer.cancel = () => { abort.abort(); finish(undefined, true); };
        new Constructor('1.12.1', embed).init(sketchfabModelId(def), {
          ...SKETCHFAB_BACKGROUND_OPTIONS,
          success: (api) => {
            if (token !== this.token) { api.stop(); finish(undefined, true); return; }
            viewer.api = api;
            api.addEventListener('viewerready', () => {
              if (finished) return;
              if (token !== this.token) { finish(undefined, true); return; }
              try {
                api.setUserInteraction(false);
                api.setTextureQuality(this.textureQuality());
                api.setCameraEasing('easeLinear');
                api.setEnableCameraConstraints(false, { preventCameraConstraintsFocus: true });
                api.getCameraLookAt((error, camera) => {
                  if (error) { finish(error); return; }
                  if (!camera || ![camera.position, camera.target].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) {
                    finish(new Error('Sketchfab returned an invalid camera')); return;
                  }
                  api.getFov((error, fov) => {
                    if (error || !Number.isFinite(fov) || fov <= 0 || fov >= 180) { finish(error || new Error('Invalid Sketchfab field of view')); return; }
                    viewer.camera = { position: [...camera.position], target: [...camera.target], fov };
                    // widen for the crop before the scene shows
                    if (api.setFov) api.setFov(this.viewerFov(fov), () => finish()); else finish();
                  });
                });
              } catch (error) { finish(error); }
            });
            api.start();
          },
          error: (error) => finish(error || new Error('Sketchfab viewer initialization failed')),
        });
      });
      if (!ready || token !== this.token) { this.release(viewer); return false; }
      this.pauseCamera();
      this.release(this.current);
      this.current = viewer; this.pending = undefined;
      this.sentTurn = null; this.sentFov = viewer.camera?.fov ?? NaN;
      frame.style.opacity = '1';
      this.updateVisibility();
      return true;
    } catch (error) {
      this.release(viewer);
      if (this.pending === viewer) this.pending = undefined;
      throw error;
    }
  }

  setQuality(quality: BackgroundQuality): void {
    this.quality = quality;
    this.current?.api?.setTextureQuality(this.textureQuality());
  }

  private textureQuality(): 'hd' | 'sd' | 'ld' {
    return this.quality === 'maximum' ? 'hd' : this.quality === 'balanced' ? 'sd' : 'ld';
  }

  /** where the camera should be `ahead` seconds from now: the drift, then the visitor's turn */
  private cameraAt(viewer: Viewer, ahead: number): BackgroundView {
    const sky = viewer.def.parts.some((part) => part.sky);
    const drifted = viewer.def.drift
      ? backgroundViewAt(viewer.camera!, viewer.def.drift, viewer.clock.seconds(performance.now()) + ahead, [0, 0, 1], sky)
      : viewer.camera!;
    return turnView(drifted, this.turn, [0, 0, 1], sky);
  }

  /** how far the drift has carried the view now, for the avatar to follow */
  driftTurn(now: number): ViewTurn {
    const viewer = this.current;
    if (!viewer?.camera || !viewer.def.drift) return NO_TURN;
    const sky = viewer.def.parts.some((part) => part.sky);
    return turnBetween(viewer.camera, backgroundViewAt(viewer.camera, viewer.def.drift, viewer.clock.seconds(now), [0, 0, 1], sky), [0, 0, 1], sky);
  }

  /** The visitor's drag/zoom, every avatar frame. Changes go to the viewer at
   * most 20×/s with a short glide, so the scene keeps pace with the avatar. */
  setTurn(turn: ViewTurn): void {
    this.turn = { ...turn };
    const viewer = this.current;
    if (!viewer?.api || !viewer.camera || !this.playing) return;
    const last = this.sentTurn;
    const changed = !last || Math.abs(last.yaw - turn.yaw) > 1e-4 || Math.abs(last.pitch - turn.pitch) > 1e-4 || Math.abs(last.zoom - turn.zoom) > 1e-4;
    const now = performance.now();
    if (!changed || now - this.sentAt < 50) return;
    this.sendCamera(viewer, 0.08);
  }

  private sendCamera(viewer: Viewer, duration: number): void {
    const camera = this.cameraAt(viewer, duration);
    this.sentTurn = { ...this.turn };
    this.sentAt = performance.now();
    viewer.requestedCamera = camera;
    viewer.commands++;
    try {
      viewer.api!.setCameraLookAt(camera.position, camera.target, duration, (error) => {
        if (this.current !== viewer) return;
        viewer.acknowledgements++;
        viewer.cameraError = error ? String(error) : null;
      });
      if (camera.fov !== undefined && camera.fov !== this.sentFov && viewer.api!.setFov) {
        this.sentFov = camera.fov;
        viewer.api!.setFov(this.viewerFov(camera.fov));
      }
    } catch (error) {
      viewer.cameraError = String(error);
      console.warn('Background camera update failed', error);
    }
  }

  private driveCamera = (): void => {
    const viewer = this.current;
    if (!viewer?.api || !viewer.camera || !viewer.def.drift || !this.playing) return;
    // Let the viewer interpolate on its own animation loop. Sending an update
    // once per second avoids tying camera motion to expensive avatar frames.
    // Schedule before calling the API: a missing reply must never stop motion.
    // (a drag sends its own quick updates in between: setTurn)
    const duration = 1.4;
    const camera = this.cameraAt(viewer, duration);
    this.sentTurn = { ...this.turn };
    if (camera.fov !== undefined && camera.fov !== this.sentFov && viewer.api.setFov) {
      this.sentFov = camera.fov;
      viewer.api.setFov(this.viewerFov(camera.fov));
    }
    viewer.requestedCamera = camera;
    viewer.commands++;
    this.cameraTimer = window.setTimeout(this.driveCamera, 1000);
    try {
      viewer.api.setCameraLookAt(camera.position, camera.target, duration, (error) => {
        if (this.current !== viewer) return;
        viewer.acknowledgements++;
        viewer.cameraError = error ? String(error) : null;
        if (error) console.warn('Background camera update failed', error);
      });
      if (viewer.commands % 2 === 0) viewer.api.getCameraLookAt((error, observed) => {
        if (!error && this.current === viewer) viewer.observedCamera = observed;
      });
    } catch (error) {
      viewer.cameraError = String(error);
      console.warn('Background camera update failed', error);
    }
  };

  private pauseCamera(): void {
    window.clearTimeout(this.cameraTimer);
    this.cameraTimer = undefined;
    this.current?.clock.pause(performance.now());
    this.playing = false;
  }

  setVisible(visible: boolean): void { this.visible = visible; this.updateVisibility(); }

  private updateVisibility(): void {
    const show = this.visible && !document.hidden;
    this.host.hidden = !show;
    if (show && this.current?.api && !this.playing) {
      this.current.api.start();
      this.playing = true;
      this.current.clock.resume(performance.now());
      this.driveCamera();
      if (!this.current.def.drift && this.current.camera) this.sendCamera(this.current, 0);
    } else if (!show) {
      this.pauseCamera();
      this.current?.api?.stop();
    }
  }

  /** Official screenshot API keeps cross-origin frames out of canvas drawing.
   * Only requested background pixels travel back; body data is never sent. */
  async capture(width: number, height: number): Promise<HTMLImageElement | null> {
    const viewer = this.current;
    if (!viewer?.api) return null;
    if (viewer.screenshotPending) return viewer.screenshotPending;
    viewer.screenshotPending = new Promise<HTMLImageElement | null>((resolve) => {
      let finished = false;
      const finish = (image: HTMLImageElement | null) => { if (finished) return; finished = true; clearTimeout(timer); resolve(image); };
      const timer = setTimeout(() => finish(null), 8000);
      viewer.api!.getScreenShot(width, height, 'image/png', (error, data) => {
        if (finished || error || this.current !== viewer || !data?.startsWith('data:image/')) { finish(null); return; }
        const image = new Image();
        image.onload = () => { if (!finished && this.current === viewer) viewer.screenshot = image; finish(image); };
        image.onerror = () => finish(null);
        image.src = data;
      });
    }).catch(() => null).finally(() => { viewer.screenshotPending = undefined; });
    return viewer.screenshotPending;
  }

  drawCaptured(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    const shot = this.current?.screenshot;
    if (shot) {
      // the stage's part of the wider render: its centre 1/scale
      const sw = shot.naturalWidth / this.scale;
      const sh = shot.naturalHeight / this.scale;
      context.drawImage(shot, (shot.naturalWidth - sw) / 2, (shot.naturalHeight - sh) / 2, sw, sh, x, y, width, height);
    }
    void this.capture(Math.round(width), Math.round(height));
  }

  private release(viewer?: Viewer): void {
    if (!viewer) return;
    viewer.cancel();
    try { viewer.api?.stop(); } catch { /* frame may already have navigated */ }
    viewer.frame.remove();
    viewer.screenshot = undefined;
  }

  clear(): void {
    ++this.token;
    this.pauseCamera();
    this.release(this.pending); this.release(this.current);
    this.pending = this.current = undefined;
    window.dispatchEvent(new CustomEvent('bodyarcade-external-background', { detail: { active: false } }));
  }

  dispose(): void {
    this.clear(); this.host.remove();
    document.removeEventListener('visibilitychange', this.visibility);
    this.resize.disconnect();
  }
}
