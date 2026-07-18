# ProxView — Brand Guidelines

**ProxView** is a free, self-hosted web app for viewing and monitoring multiple
Proxmox nodes — clustered or not.

---

## 1. The mark

**"The Watchpoint"** — a lens/eye outline with a rack-stack pupil.

- The **lens** is the operator's view: observation, oversight, one pane of glass.
- The **two rack units** are the nodes — plural, deliberately. ProxView exists to
  watch more than one, and they sit precisely at the centre of attention.
- **Five lashes** on the upper lid. They soften the mark and make the eye read
  as an eye immediately rather than as an abstract lozenge. They also make it
  read a little more character than infrastructure — that's the trade, and it's
  a deliberate one. A lashless version is kept in `logo/alt/`.
- The vent slots and drive LEDs are **true knockouts** (`fill-rule="evenodd"`),
  not lighter-coloured shapes, so the mark is correct on any background.

### Construction
Built on a 512×512 grid. Lens: half-width 200, half-height 118, stroke 34, drawn
as two quadratic arcs. Rack pupil: two units 204 × 46 with a 28 gap (120 overall),
which is the largest block that clears the lens interior with margin.

The 28 gap is deliberately generous — anything tighter and the two units merge
into a single blob below ~48px. Don't tighten it to "balance" the pupil.

Lashes sit at t = 0.25, 0.375, 0.5, 0.625, 0.75 along the upper lid, each drawn
along the **outward normal** at that point rather than fanned from the centre —
lashes struck at the wrong angle off a curve look wrong immediately. Lengths run
0.26–0.33 of the lens half-height, shortest at the outer pair so they don't crowd
the lens tips. Stroke is 0.76 × the lid stroke, round caps.

Because lashes add height, the badge sets the eye at 0.70 scale (not 0.76) and
nudges it 10 units down, keeping the whole mark optically centred on the plate.

Never redraw by eye; regenerate from `build_proxview_brand.py`.

### Optical sizing
Three fidelities. Pick one; never just scale the detailed art down.

| Render size | Variant | What's in it |
|---|---|---|
| > 128 px | `mark-amber.svg` on squircle plate | Everything: lashes, slots, LEDs |
| 97–128 px | `badge-icon-rounded.svg` | Same art, squarer plate |
| 33–96 px | `mark-amber-simple.svg` | Slots and LEDs dropped, lashes kept |
| ≤ 32 px | `mark-amber-micro.svg` | Lashes dropped too |

Lashes go first because below ~48px they blur into a thick smudge sitting on top
of the lid, which reads worse than no lashes at all.

Below ~32px the pupil is under 3px tall and the two units necessarily merge into
a single bar. That is expected and still reads as a pupil; don't try to fix it
with a thinner gap.

### Clear space
Minimum clear space on all sides = half the rack height (0.25 × mark height).
Nothing — text, edges, UI chrome — enters that zone.

### Minimum sizes
| Use | Minimum |
|---|---|
| Mark alone | 16 px (simple variant) |
| Mark, full detail | 128 px |
| Horizontal lockup | 160 px wide |
| Stacked lockup | 120 px wide |

### Don'ts
- Don't rotate, skew, or squash the mark.
- Don't recolour the rack anything other than Prox Amber (or full mono).
- Don't fill the vent slots or LEDs with a colour — they are holes, not shapes.
- Don't tighten the gap between the two rack units. See Construction.
- Don't add lashes to the lower lid, and don't keep them below 32px.
- Don't add a third rack unit. Two reads as "more than one"; three reads as a
  cluster, which is exactly what ProxView doesn't require.
- Don't use the lens outline on its own, or the rack on its own, as the logo.
- Don't re-typeset the wordmark in another face — use the supplied SVGs.

### Alternates
`logo/alt/` holds three things, all regenerable, none of them the logo:

- **the lashless mark** — if the lashes ever feel too playful for a context
  (an enterprise deck, a partner listing), this is the sober version;
- **the standalone server stack** — a full glyph with connector, stem, bus bar
  and network node, useful as an in-app node/host icon where the lens would be
  redundant;
- **the hexagon-pupil lens** — the original pupil treatment.

## 2. Colour

### Accent — Prox Amber
| Token | Hex | Use |
|---|---|---|
| `--pv-amber-300` | `#FFC66E` | Gradient highlight |
| `--pv-amber-400` | `#FFA742` | Hover / focus ring |
| `--pv-amber-500` | `#FF8A1F` | **Primary accent** (dark UI) |
| `--pv-amber-600` | `#E5720A` | Primary accent on light UI, pressed state |

Prox Amber is deliberately adjacent to Proxmox orange — familiar to the audience —
but warmer and brighter so ProxView never reads as an official Proxmox product.

### Neutrals
| Token | Hex |
|---|---|
| `--pv-cloud` | `#E9EEF5` |
| `--pv-slate-200` | `#C3CCD8` |
| `--pv-slate-400` | `#8A97A8` |
| `--pv-graphite-600` | `#2B3440` |
| `--pv-graphite-700` | `#1F2630` |
| `--pv-graphite-800` | `#161B22` |
| `--pv-graphite-900` | `#0E1116` |

### Status (node / VM state)
| State | Token | Hex |
|---|---|---|
| Running / healthy | `--pv-running` | `#3FD68C` |
| Warning / degraded | `--pv-warning` | `#FFB020` |
| Stopped / error | `--pv-stopped` | `#FF5C5C` |
| Offline / unknown | `--pv-offline` | `#6B7688` |

Status colours are **never** used as decoration. If it's coloured green, something
is genuinely running. Always pair colour with a label or icon for accessibility.

---

## 3. Typography

- **IBM Plex Sans** — UI and headings. SemiBold for the wordmark and headings,
  Medium for labels, Regular for body.
- **IBM Plex Mono** — everything numeric or machine-derived: node names, IPs,
  uptimes, CPU %, VMIDs, log lines.

Wordmark: IBM Plex Sans SemiBold, tracking −0.7 at 96px (roughly −0.007em).
"Prox" in text colour, "View" in Prox Amber. A full-monotone version is supplied
for single-colour contexts.

Scale: 12 / 14 / 16 / 20 / 24 / 32 / 44 / 64 px.

---

## 4. Voice

Plain, technical, unhurried. ProxView is a free tool made for people who run their
own hardware, so it never oversells.

- Say: "Watch every node. One pane of glass."
- Say: "No cluster required. No agent. Read-only by default."
- Avoid: "revolutionary", "AI-powered", "enterprise-grade".

**Required disclaimer** wherever ProxView is presented publicly:

> ProxView is an independent project and is not affiliated with, endorsed by, or
> sponsored by Proxmox Server Solutions GmbH. Proxmox® is a registered trademark
> of Proxmox Server Solutions GmbH.

Do not use the Proxmox logo, the Proxmox wordmark, or Proxmox orange as a primary
brand colour in ProxView materials.

---

## 5. Files

```
logo/    mark-amber.svg          primary mark: lens + amber rack pupil
         mark-graphite.svg       for light backgrounds
         mark-mono-white.svg     single colour, knockout
         mark-mono-black.svg     single colour
         mark-*-simple.svg       33-96px fidelity (no slots or LEDs)
         mark-*-micro.svg        <= 32px fidelity (no lashes either)
         badge-icon.svg          dark squircle app icon (master)
         badge-icon-rounded.svg  rounded-rect variant (web/Android)
         badge-icon-small.svg    rounded-rect, simple fidelity
         badge-icon-micro.svg    rounded-rect, micro fidelity
         alt/                    lashless mark, standalone server stack,
                                 hexagon-pupil lens
         logo-horizontal-dark.svg / -light.svg
         logo-stacked-dark.svg   / -light.svg
         wordmark-dark.svg       / wordmark-light.svg / wordmark-mono-*.svg

icon/    icon-16 … icon-1024.png     dark badge, PNG
         favicon.ico                 16/32/48 multi-resolution
         apple-touch-icon-180.png
         maskable-192.png, maskable-512.png

social/  og-card-1200x630.png        Open Graph / Twitter card
         github-header-1280x640.png  repo social preview
         avatar-512.png              round avatar (GitHub/Discord/X)
         palette-1400x900.png        colour reference sheet

web/     site.webmanifest
         tokens.css
         head-snippet.html
```

Regenerate everything with:

```bash
python3 build_proxview_brand.py
```
