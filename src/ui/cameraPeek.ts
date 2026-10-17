// Camera peek: the person's own webcam view, shown by the link chip so they
// can see where they stand — while the pointer is on a chip, and on its own
// while the camera is on but nobody is being followed, to help them step
// back into view. The tracking lines are drawn over it, so they can see what
// the tracker sees: solid where it's sure, dashed where it's guessing, and
// nothing for parts it can't find. It looks like a 2005 webcam: 240×180, scaled up soft, under
// an olive-green colour layer — a glance, not a mirror. Full frame rate, so
// it stays easy to line yourself up with. Local only: the same stream the tracker already has.

import type { Link } from './link';
import type { LandmarkPoint } from '../pose/types';
import { CONNECTIONS, LM } from '../pose/indices';

export interface CameraPeek {
  /** the latest raw detection (video coordinates, unmirrored), or null */
  setPose(norm: LandmarkPoint[] | null): void;
}

// phosphor chartreuse from the olive picture's own palette (a camcorder
// viewfinder's OSD), with a dark olive outline so it reads on light and dark
const LINE = '214, 255, 92';
const HALO = 'rgba(10, 20, 4, 0.75)';
const SURE = 0.5; // visibility from which a part counts as seen
const GUESS = 0.2; // below this a part isn't drawn at all
const STALE_MS = 400;

export function createCameraPeek(link: Link, source: HTMLVideoElement): CameraPeek {
  const panel = document.createElement('div');
  panel.className = 'camera-peek';
  panel.dataset.glass = 'panel';
  panel.setAttribute('aria-hidden', 'true');
  // hidden by opacity, not display:none, so the glass keeps its measured size
  const frame = document.createElement('div');
  frame.className = 'camera-peek-frame';
  // the stream plays in a detached video; a tiny canvas shows it
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // picked by Lekan from rendered comparisons (160×120 to 480×360, 10–25 fps)
  const LOW_W = 240;
  const LOW_H = 180;
  const screen = document.createElement('canvas');
  screen.className = 'camera-peek-picture';
  screen.width = LOW_W;
  screen.height = LOW_H;
  const g = screen.getContext('2d')!;
  g.imageSmoothingQuality = 'high'; // an averaged downscale, as in the comparisons
  let drawing = false;
  /** every new camera frame while the peek is open */
  function loop(): void {
    if (!drawing) return;
    draw();
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
    else requestAnimationFrame(loop);
  }
  function draw(): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    // cover-crop to 4:3
    const scale = Math.max(LOW_W / vw, LOW_H / vh);
    const sw = LOW_W / scale;
    const sh = LOW_H / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    g.drawImage(video, sx, sy, sw, sh, 0, 0, LOW_W, LOW_H);
    drawLines(vw, vh, sx, sy, sw, sh);
  }

  function drawLines(vw: number, vh: number, sx: number, sy: number, sw: number, sh: number): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.round(frame.clientWidth * dpr);
    const H = Math.round(frame.clientHeight * dpr);
    if (lines.width !== W || lines.height !== H) {
      lines.width = W;
      lines.height = H;
    }
    lg.clearRect(0, 0, W, H);
    if (!pose || performance.now() - poseAt > STALE_MS) return;
    // video-normalized → the cover-cropped peek
    const px = (p: LandmarkPoint) => ((p.x * vw - sx) / sw) * W;
    const py = (p: LandmarkPoint) => ((p.y * vh - sy) / sh) * H;
    const lw = 2 * dpr;
    lg.lineCap = 'round';
    lg.lineJoin = 'round';
    for (const [a, b] of CONNECTIONS) {
      if (a <= 10 || b <= 10) continue; // the face mesh crowds a small view: shoulders down
      const pa = pose[a];
      const pb = pose[b];
      const vis = Math.min(pa.visibility, pb.visibility);
      if (vis < GUESS) continue;
      const sure = vis >= SURE;
      lg.setLineDash(sure ? [] : [4 * dpr, 4 * dpr]);
      lg.beginPath();
      lg.moveTo(px(pa), py(pa));
      lg.lineTo(px(pb), py(pb));
      lg.strokeStyle = HALO;
      lg.lineWidth = (sure ? lw : lw * 0.8) + 2 * dpr;
      lg.stroke();
      lg.strokeStyle = `rgba(${LINE}, ${sure ? 1 : 0.6})`;
      lg.lineWidth = sure ? lw : lw * 0.8;
      lg.stroke();
    }
    lg.setLineDash([]);
    for (let i = 11; i < pose.length; i++) {
      const p = pose[i];
      if (p.visibility < GUESS) continue;
      const sure = p.visibility >= SURE;
      const hand = i === LM.leftWrist || i === LM.rightWrist;
      lg.beginPath();
      lg.arc(px(p), py(p), (hand ? 3.4 : 2.2) * dpr, 0, Math.PI * 2);
      if (sure) {
        lg.strokeStyle = HALO;
        lg.lineWidth = 2 * dpr;
        lg.stroke();
        lg.fillStyle = hand ? '#f3fcda' : `rgb(${LINE})`;
        lg.fill();
      } else {
        lg.strokeStyle = `rgba(${LINE}, 0.6)`;
        lg.lineWidth = lw * 0.7;
        lg.stroke();
      }
    }
    // the head: a ring at the nose, sized to the shoulders
    const nose = pose[LM.nose];
    const ls = pose[LM.leftShoulder];
    const rs = pose[LM.rightShoulder];
    if (nose && nose.visibility >= GUESS) {
      const r = Math.max(6 * dpr, Math.hypot(px(ls) - px(rs), py(ls) - py(rs)) * 0.32);
      lg.setLineDash(nose.visibility >= SURE ? [] : [4 * dpr, 4 * dpr]);
      lg.beginPath();
      lg.arc(px(nose), py(nose), r, 0, Math.PI * 2);
      lg.strokeStyle = HALO;
      lg.lineWidth = lw + 2 * dpr;
      lg.stroke();
      lg.strokeStyle = `rgba(${LINE}, ${nose.visibility >= SURE ? 1 : 0.6})`;
      lg.lineWidth = lw;
      lg.stroke();
      lg.setLineDash([]);
    }
  }
  const tint = document.createElement('span');
  tint.className = 'camera-peek-tint';
  const tag = document.createElement('span');
  tag.className = 'camera-peek-tag';
  // the lines sit above the colour layer (they keep their own colour) and at
  // full resolution, crisp over the lo-fi picture
  const lines = document.createElement('canvas');
  lines.className = 'camera-peek-lines';
  const lg = lines.getContext('2d')!;
  let pose: LandmarkPoint[] | null = null;
  let poseAt = 0;
  frame.append(screen, tint, lines);
  panel.append(frame, tag);
  document.body.append(panel);

  let hovered: HTMLElement | null = null;

  /** the chip on screen right now: the in-game one while a game is open */
  function visibleChip(): HTMLElement | null {
    const chips = [...document.querySelectorAll<HTMLElement>('.link-chip')].filter((c) => c.offsetParent !== null && c.getClientRects().length);
    return chips.find((c) => c.closest('.ba-pip')) ?? chips[0] ?? null;
  }

  function place(chip: HTMLElement): void {
    const r = chip.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const gap = 10;
    const left = Math.min(Math.max(gap, r.left), innerWidth - w - gap);
    // above the chip when it sits low on the screen, below it otherwise
    const top = r.top > innerHeight / 2 ? r.top - h - gap : r.bottom + gap;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.min(Math.max(gap, top), innerHeight - h - gap)}px`;
  }

  function update(): void {
    const stream = source.srcObject instanceof MediaStream && source.srcObject.active ? source.srcObject : null;
    const chip = hovered ?? (link.state === 'searching' || link.state === 'disconnected' ? visibleChip() : null);
    const show = !!chip && !!stream;
    if (!show) {
      if (panel.classList.contains('on')) {
        panel.classList.remove('on');
        drawing = false;
        video.srcObject = null; // no second decode while nobody is looking
      }
      return;
    }
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
    if (!drawing) {
      drawing = true;
      loop();
    }
    panel.dataset.state = link.state;
    const text = link.state === 'connected' ? 'your camera · only you see this' : 'finding you · only you see this';
    if (tag.textContent !== text) tag.textContent = text;
    place(chip);
    panel.classList.add('on');
  }

  const chipOf = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('.link-chip') : null);
  document.addEventListener('pointerover', (e) => {
    const chip = chipOf(e);
    if (chip && chip !== hovered) {
      hovered = chip;
      update();
    }
  });
  document.addEventListener('pointerout', (e) => {
    const chip = chipOf(e);
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('.link-chip') : null;
    if (chip && chip === hovered && to !== chip) {
      hovered = null;
      update();
    }
  });
  document.addEventListener('focusin', (e) => {
    const chip = chipOf(e);
    if (chip) {
      hovered = chip;
      update();
    }
  });
  document.addEventListener('focusout', (e) => {
    if (chipOf(e) === hovered) {
      hovered = null;
      update();
    }
  });
  link.onChange(update);
  // the camera can start after the state changes; chips move with layout
  source.addEventListener('loadeddata', update);
  addEventListener('resize', update);
  setInterval(() => {
    if (panel.classList.contains('on')) update();
  }, 1000);

  return {
    setPose(norm) {
      pose = norm;
      if (norm) poseAt = performance.now();
    },
  };
}
