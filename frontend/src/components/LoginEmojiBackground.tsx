import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

// Curated homelab / server / monitoring emojis — servers, containers, gauges,
// power, network — so the soup reads as "datacenter" without leaning on one icon.
const EMOJIS = [
  '🖥️', '🗄️', '📦', '🧊', '⚙️', '🔧', '🛠️', '🌡️',
  '⚡', '🔌', '🔋', '📊', '📈', '🛰️', '📡', '☁️',
  '🔒', '🐧', '🧰', '💾', '🕸️', '🔥', '❄️', '🖥️',
] as const;

// Deterministic PRNG so positions are stable across renders — no flicker.
function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Speck {
  id: number;
  emoji: string;
  left: number;
  top: number;
  size: number;
  peakOpacity: number;
  blur: number;
  driftDur: number;
  driftDelay: number;
  fadeDur: number;
  fadeDelay: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  rotate: number;
  spin: number;
  driftIdx: number;
  reverse: boolean;
  depth: number;
}

function build(count: number, seed: number): Speck[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, id) => {
    const bucket = rand();
    // Three size tiers — most small motes, a few large slow giants.
    const size = bucket < 0.55 ? 22 + rand() * 18 : bucket < 0.88 ? 44 + rand() * 28 : 78 + rand() * 46;

    // Larger specks read as nearer atmosphere — fainter, blurrier, parallax further.
    const sizeT = (size - 22) / (124 - 22);
    const peakOpacity = 0.3 - sizeT * 0.14 + rand() * 0.05;
    const blur = 0.4 + sizeT * 3.2 + rand() * 1.2;
    const depth = 0.35 + sizeT * 1.4 + (rand() - 0.5) * 0.4;

    return {
      id,
      emoji: EMOJIS[Math.floor(rand() * EMOJIS.length)] ?? '🖥️',
      left: rand() * 108 - 4,
      top: rand() * 110 - 5,
      size,
      peakOpacity,
      blur,
      driftDur: 38 + rand() * 64,
      driftDelay: -rand() * 80,
      fadeDur: 11 + rand() * 18,
      fadeDelay: -rand() * 30,
      ax: (rand() - 0.5) * 48,
      ay: (rand() - 0.5) * 38,
      bx: (rand() - 0.5) * 42,
      by: (rand() - 0.5) * 36,
      rotate: -18 + rand() * 36,
      spin: -10 + rand() * 20,
      driftIdx: Math.floor(rand() * 4),
      reverse: rand() > 0.5,
      depth,
    };
  });
}

// Pointer parallax in px — scaled per-speck by depth; horizontal a bit wider.
const PARALLAX_X_PX = 70;
const PARALLAX_Y_PX = 55;

const STYLES = `
.soup-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  --soup-px: 0;
  --soup-py: 0;
}
.soup-orbit {
  position: absolute;
  will-change: transform;
  transform: translate3d(
    calc(var(--soup-px) * var(--soup-depth, 1) * ${PARALLAX_X_PX}px),
    calc(var(--soup-py) * var(--soup-depth, 1) * ${PARALLAX_Y_PX}px),
    0
  );
}
.soup-speck {
  display: block;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  line-height: 1;
  will-change: transform, opacity;
  user-select: none;
  -webkit-user-select: none;
  filter: blur(var(--soup-blur));
  animation:
    var(--soup-drift) var(--soup-drift-dur) ease-in-out var(--soup-drift-delay) infinite alternate,
    soup-breathe var(--soup-fade-dur) ease-in-out var(--soup-fade-delay) infinite;
}
@keyframes soup-drift-a {
  0%   { transform: translate3d(0, 0, 0) rotate(var(--soup-rot)); }
  33%  { transform: translate3d(var(--soup-ax), var(--soup-ay), 0) rotate(calc(var(--soup-rot) + var(--soup-spin))); }
  66%  { transform: translate3d(var(--soup-bx), var(--soup-by), 0) rotate(calc(var(--soup-rot) - var(--soup-spin))); }
  100% { transform: translate3d(calc(var(--soup-ax) * 0.3), calc(var(--soup-by) * 0.7), 0) rotate(var(--soup-rot)); }
}
@keyframes soup-drift-b {
  0%   { transform: translate3d(0, 0, 0) rotate(var(--soup-rot)); }
  50%  { transform: translate3d(calc(var(--soup-ax) * -0.8), var(--soup-ay), 0) rotate(calc(var(--soup-rot) + var(--soup-spin))); }
  100% { transform: translate3d(var(--soup-bx), calc(var(--soup-by) * -1), 0) rotate(calc(var(--soup-rot) - var(--soup-spin))); }
}
@keyframes soup-drift-c {
  0%   { transform: translate3d(0, 0, 0) rotate(var(--soup-rot)); }
  25%  { transform: translate3d(var(--soup-ax), calc(var(--soup-ay) * 0.4), 0) rotate(calc(var(--soup-rot) - var(--soup-spin))); }
  75%  { transform: translate3d(calc(var(--soup-bx) * 0.6), var(--soup-by), 0) rotate(calc(var(--soup-rot) + var(--soup-spin))); }
  100% { transform: translate3d(calc(var(--soup-ax) * 0.2), calc(var(--soup-by) * 0.5), 0) rotate(var(--soup-rot)); }
}
@keyframes soup-drift-d {
  0%   { transform: translate3d(0, 0, 0) rotate(var(--soup-rot)); }
  40%  { transform: translate3d(calc(var(--soup-bx) * 1.1), calc(var(--soup-ay) * -0.5), 0) rotate(calc(var(--soup-rot) + var(--soup-spin))); }
  80%  { transform: translate3d(calc(var(--soup-ax) * -0.6), var(--soup-by), 0) rotate(calc(var(--soup-rot) - var(--soup-spin))); }
  100% { transform: translate3d(var(--soup-bx), calc(var(--soup-ay) * 0.3), 0) rotate(var(--soup-rot)); }
}
@keyframes soup-breathe {
  0%, 100% { opacity: calc(var(--soup-opacity) * 0.25); }
  25%      { opacity: var(--soup-opacity); }
  55%      { opacity: calc(var(--soup-opacity) * 0.5); }
  80%      { opacity: calc(var(--soup-opacity) * 0.9); }
}
@media (prefers-reduced-motion: reduce) {
  .soup-orbit { transform: none; }
  .soup-speck {
    animation: soup-breathe var(--soup-fade-dur) ease-in-out var(--soup-fade-delay) infinite;
    transform: translate3d(0, 0, 0) rotate(var(--soup-rot));
  }
}
`;

const DRIFT_NAMES = ['soup-drift-a', 'soup-drift-b', 'soup-drift-c', 'soup-drift-d'] as const;

/**
 * Reactive "emoji soup" login backdrop — drifting, breathing homelab emojis
 * that parallax toward the pointer. Ported from the Spectre auth screens.
 */
export function LoginEmojiBackground({ count = 44, seed = 7 }: { count?: number; seed?: number }) {
  const specks = useMemo(() => build(count, seed), [count, seed]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let lastT = 0;
    let raf = 0;
    let active = false;

    const setTarget = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((clientY - rect.top) / rect.height) * 2 - 1;
      targetX = Math.max(-1, Math.min(1, nx));
      targetY = Math.max(-1, Math.min(1, ny));
      if (!active) {
        active = true;
        lastT = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    const tick = (t: number) => {
      const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
      lastT = t;
      // Time-based damped lerp — lively but never twitchy, framerate-independent.
      const k = 1 - Math.exp(-dt * 4);
      currentX += (targetX - currentX) * k;
      currentY += (targetY - currentY) * k;
      el.style.setProperty('--soup-px', currentX.toFixed(4));
      el.style.setProperty('--soup-py', currentY.toFixed(4));
      if (Math.abs(targetX - currentX) < 0.0015 && Math.abs(targetY - currentY) < 0.0015) {
        active = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const onPointer = (e: PointerEvent) => setTarget(e.clientX, e.clientY);
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!active) {
        active = true;
        lastT = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div ref={rootRef} className="soup-root" aria-hidden="true">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {specks.map((s) => {
        const drift = DRIFT_NAMES[s.driftIdx] ?? DRIFT_NAMES[0];
        const orbitVars = { '--soup-depth': s.depth.toFixed(3) } as CSSProperties;
        const speckVars = {
          '--soup-ax': `${s.ax}vmin`,
          '--soup-ay': `${s.ay}vmin`,
          '--soup-bx': `${s.bx}vmin`,
          '--soup-by': `${s.by}vmin`,
          '--soup-rot': `${s.rotate}deg`,
          '--soup-spin': `${s.spin}deg`,
          '--soup-opacity': s.peakOpacity.toFixed(3),
          '--soup-blur': `${s.blur.toFixed(2)}px`,
          '--soup-drift': drift,
          '--soup-drift-dur': `${s.driftDur.toFixed(1)}s`,
          '--soup-drift-delay': `${s.driftDelay.toFixed(1)}s`,
          '--soup-fade-dur': `${s.fadeDur.toFixed(1)}s`,
          '--soup-fade-delay': `${s.fadeDelay.toFixed(1)}s`,
        } as CSSProperties;
        return (
          <span key={s.id} className="soup-orbit" style={{ left: `${s.left}%`, top: `${s.top}%`, ...orbitVars }}>
            <span
              className="soup-speck"
              style={{
                fontSize: `${s.size}px`,
                animationDirection: s.reverse ? 'alternate-reverse' : 'alternate',
                ...speckVars,
              }}
            >
              {s.emoji}
            </span>
          </span>
        );
      })}
    </div>
  );
}
