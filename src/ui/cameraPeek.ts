// Camera peek: the person's own webcam view, shown by the link chip so they
// can see where they stand — while the pointer is on a chip, and on its own
// whenever tracking says Disconnected (no one to follow), to help them step
// back into view. It looks like a 2005 webcam: 240×180, scaled up soft, under
// an olive-green colour layer — a glance, not a mirror. Full frame rate, so
// it stays easy to line yourself up with. Local only: the same stream the tracker already has.

import type { Link } from './link';

export function createCameraPeek(link: Link, source: HTMLVideoElement): void {
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
    g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, LOW_W, LOW_H);
  }
  const tint = document.createElement('span');
  tint.className = 'camera-peek-tint';
  const tag = document.createElement('span');
  tag.className = 'camera-peek-tag';
  frame.append(screen, tint);
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
    const chip = hovered ?? (link.state === 'disconnected' ? visibleChip() : null);
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
    const text = link.state === 'disconnected' ? 'step into view · only you see this' : 'your camera · only you see this';
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
}
