import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';

// Curated homelab line icons — servers, network, storage, compute — drawn on a
// 24x24 grid with round caps so the field reads as "datacenter" at any size.
// Stroked with currentColor; each speck is tinted from the Prox Amber ramp.
const ICONS: readonly ReactNode[] = [
  // Server rack — two units, echoing the brand mark's pupil
  <>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M6.4 7.5h.01M6.4 16.5h.01M15 7.5h3M15 16.5h3" />
  </>,
  // Tower server
  <>
    <rect x="7" y="3" width="10" height="18" rx="1.5" />
    <path d="M10 7h4M10 10.5h4M10.5 17h.01" />
  </>,
  // Monitor
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
    <path d="M9.5 20.5h5M12 16.5v4" />
  </>,
  // Terminal
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <path d="M7 9.5l3 2.5-3 2.5M12.5 14.5H17" />
  </>,
  // Router with antennas
  <>
    <rect x="4" y="13" width="16" height="7" rx="1.5" />
    <path d="M8 13V6M16 13V8.5M8 16.5h.01M11.5 16.5h.01" />
  </>,
  // Wi-Fi
  <>
    <path d="M4 9.5a12 12 0 0 1 16 0M7 13a8 8 0 0 1 10 0M9.8 16.2a4 4 0 0 1 4.4 0" />
    <path d="M12 19.5h.01" />
  </>,
  // Network topology — one hub, two leaves
  <>
    <circle cx="12" cy="6" r="2.5" />
    <circle cx="5.5" cy="18" r="2.5" />
    <circle cx="18.5" cy="18" r="2.5" />
    <path d="M10.8 8.2 6.8 16M13.2 8.2l4 7.8M8 18h8" />
  </>,
  // Ethernet port
  <>
    <path d="M5 9h14v10H5zM9 5h6v4M9 19v-2.5M12 19v-2.5M15 19v-2.5" />
  </>,
  // Hard drive
  <>
    <rect x="3" y="8" width="18" height="8" rx="1.5" />
    <path d="M17.4 12h.01M6.5 12h4" />
  </>,
  // Database cylinder
  <>
    <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
    <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
  </>,
  // CPU chip
  <>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" />
  </>,
  // Cloud
  <>
    <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.1 8.6 4.2 4.2 0 0 1 16.8 18Z" />
  </>,
  // Globe
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c-4.7 4.8-4.7 12.2 0 17M12 3.5c4.7 4.8 4.7 12.2 0 17" />
  </>,
  // Gauge
  <>
    <path d="M5 17.5a8.5 8.5 0 1 1 14 0" />
    <path d="M12 14.5 15.5 9M12 14.5h.01" />
  </>,
  // Container stack
  <>
    <rect x="4" y="12" width="7.5" height="7.5" rx="1" />
    <rect x="12.5" y="12" width="7.5" height="7.5" rx="1" />
    <rect x="8.25" y="4" width="7.5" height="7.5" rx="1" />
  </>,
  // Power plug
  <>
    <path d="M9 3.5V8M15 3.5V8M6.5 8h11l-1 5a4.5 4.5 0 0 1-9 0ZM12 17.5v3" />
  </>,
];

// Prox Amber ramp (BRAND.md) — highlight → pressed. Weighted toward the middle
// so the field reads warm without going muddy or neon.
const TINTS = ['#FFC66E', '#FFA742', '#FF8A1F', '#FF8A1F', '#E5720A'] as const;

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
  iconIdx: number;
  tint: string;
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
    // Line icons carry less ink than emoji glyphs, so they run a touch more opaque.
    const peakOpacity = 0.36 - sizeT * 0.15 + rand() * 0.06;
    const blur = 0.4 + sizeT * 3.2 + rand() * 1.2;
    const depth = 0.35 + sizeT * 1.4 + (rand() - 0.5) * 0.4;

    return {
      id,
      iconIdx: Math.floor(rand() * ICONS.length),
      tint: TINTS[Math.floor(rand() * TINTS.length)] ?? '#FF8A1F',
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
  line-height: 1;
  will-change: transform, opacity;
  user-select: none;
  -webkit-user-select: none;
  filter: blur(var(--soup-blur));
  animation:
    var(--soup-drift) var(--soup-drift-dur) ease-in-out var(--soup-drift-delay) infinite alternate,
    soup-breathe var(--soup-fade-dur) ease-in-out var(--soup-fade-delay) infinite;
}
.soup-speck svg {
  display: block;
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
 * Reactive login backdrop — drifting, breathing homelab line icons in Prox
 * Amber that parallax toward the pointer. Successor to the emoji soup.
 */
export function LoginIconBackground({ count = 44, seed = 7 }: { count?: number; seed?: number }) {
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
                color: s.tint,
                animationDirection: s.reverse ? 'alternate-reverse' : 'alternate',
                ...speckVars,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width={s.size}
                height={s.size}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[s.iconIdx]}
              </svg>
            </span>
          </span>
        );
      })}
    </div>
  );
}
