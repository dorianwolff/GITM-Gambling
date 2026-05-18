/**
 * pinball-maps.js
 * Five themed pinball tables with emoji-heavy decorations.
 * Each map defines bumpers, pegs, slingshots, and visual theming.
 * All coordinates are normalized 0-1 inside the playfield rectangle.
 *
 * Playfield coordinate system (shared by all maps):
 *   x 0..1  left wall to right wall (excluding shooter lane)
 *   y 0..1  top wall to bottom drain
 *
 * The shooter lane lives at x > 1.0 and is handled by the engine.
 */

export const PINBALL_BALL_OPTIONS = [1, 3, 5];

// ---------------------------------------------------------------------------
// Peg field builder
// ---------------------------------------------------------------------------
function pegGrid({ rows, cols, top, bottom, left, right, r = 0.012, stagger = true }) {
  const pegs = [];
  for (let row = 0; row < rows; row++) {
    const y = rows > 1 ? top + (bottom - top) * row / (rows - 1) : (top + bottom) / 2;
    const odd = row % 2 === 1;
    const c = odd && stagger ? cols - 1 : cols;
    const offset = odd && stagger ? (right - left) / (cols - 1) / 2 : 0;
    for (let col = 0; col < c; col++) {
      const x = c > 1 ? left + offset + (right - left - offset * 2) * col / (c - 1) : (left + right) / 2;
      pegs.push({ x, y, r, pts: 8 + row * 2 });
    }
  }
  return pegs;
}

// ---------------------------------------------------------------------------
// Map builder
// ---------------------------------------------------------------------------
function buildMap(key, d) { return Object.freeze({ key, ...d }); }

// ---------------------------------------------------------------------------
// 1. ENCHANTED FOREST  🌲🍄🦌🌿🦊
// ---------------------------------------------------------------------------
const forest = buildMap('enchanted_forest', {
  name: 'Enchanted Forest',
  emoji: '🌲',
  accent: '#4ade80',
  accent2: '#a3e635',
  baseColor: '#0a1a0f',
  bg: 'radial-gradient(ellipse at 50% 20%, rgba(74,222,128,0.18), transparent 55%), linear-gradient(180deg, #0a1a0f 0%, #071208 100%)',
  description: 'Mystical woodland with mushroom bumpers, fox slingshots, and firefly pegs.',
  gravity: 1.0,
  drag: 0.997,
  scoreMultiplier: 1.0,
  pegs: pegGrid({ rows: 1, cols: 3, top: 0.22, bottom: 0.22, left: 0.24, right: 0.76, r: 0.008 }),
  bumpers: [
    { x: 0.50, y: 0.24, r: 0.040, pts: 75, power: 1.10, color: '#f87171', emoji: '🍄', label: 'Giant Mushroom' },
    { x: 0.38, y: 0.38, r: 0.030, pts: 50, power: 1.08, color: '#4ade80', emoji: '🌿', label: 'Fern Bounce' },
    { x: 0.62, y: 0.38, r: 0.030, pts: 50, power: 1.08, color: '#4ade80', emoji: '🌿', label: 'Fern Bounce' },
  ],
  slingshots: [
    { x: 0.18, y: 0.64, r: 0.030, angle: -30, power: 1.2, emoji: '🦊', label: 'Fox Sling', color: '#fb923c' },
    { x: 0.82, y: 0.64, r: 0.030, angle: 30, power: 1.2, emoji: '🦊', label: 'Fox Sling', color: '#fb923c' },
  ],
  targets: [
    { x: 0.12, y: 0.18, r: 0.020, pts: 125, emoji: '🌸', label: 'Blossom Gate', color: '#f9a8d4' },
    { x: 0.88, y: 0.18, r: 0.020, pts: 125, emoji: '🍃', label: 'Leaf Gate', color: '#a3e635' },
    { x: 0.50, y: 0.54, r: 0.024, pts: 60, emoji: '✨', label: 'Fairy Ring', color: '#fbbf24' },
  ],
});

// ---------------------------------------------------------------------------
// 2. GALAXY DRIFT  🌌🪐⭐🚀🛸
// ---------------------------------------------------------------------------
const galaxy = buildMap('galaxy_drift', {
  name: 'Galaxy Drift',
  emoji: '🌌',
  accent: '#818cf8',
  accent2: '#c084fc',
  baseColor: '#0c0a1e',
  bg: 'radial-gradient(ellipse at 50% 30%, rgba(129,140,248,0.20), transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(192,132,252,0.12), transparent 40%), linear-gradient(180deg, #0c0a1e 0%, #06051a 100%)',
  description: 'Drift through asteroid bumpers, warp-gate targets, and a black hole at the center.',
  gravity: 0.92,
  drag: 0.998,
  scoreMultiplier: 1.05,
  pegs: pegGrid({ rows: 1, cols: 3, top: 0.18, bottom: 0.18, left: 0.24, right: 0.76, r: 0.007 }),
  bumpers: [
    { x: 0.50, y: 0.22, r: 0.042, pts: 60, power: 1.12, color: '#6366f1', emoji: '🕳️', label: 'Black Hole' },
    { x: 0.35, y: 0.36, r: 0.030, pts: 50, power: 1.08, color: '#818cf8', emoji: '🪐', label: 'Saturn Ring' },
    { x: 0.65, y: 0.36, r: 0.030, pts: 50, power: 1.08, color: '#818cf8', emoji: '🪐', label: 'Jupiter Ring' },
  ],
  slingshots: [
    { x: 0.16, y: 0.64, r: 0.030, angle: -32, power: 1.3, emoji: '🚀', label: 'Booster', color: '#f97316' },
    { x: 0.84, y: 0.64, r: 0.030, angle: 32, power: 1.3, emoji: '🛸', label: 'UFO Sling', color: '#22d3ee' },
  ],
  targets: [
    { x: 0.10, y: 0.16, r: 0.020, pts: 150, emoji: '🛸', label: 'Warp Gate A', color: '#22d3ee' },
    { x: 0.90, y: 0.16, r: 0.020, pts: 150, emoji: '🛸', label: 'Warp Gate B', color: '#22d3ee' },
    { x: 0.50, y: 0.52, r: 0.024, pts: 50, emoji: '💫', label: 'Supernova', color: '#fbbf24' },
  ],
});

// ---------------------------------------------------------------------------
// 3. DEEP SEA  🌊🦈🐙🐚🫧
// ---------------------------------------------------------------------------
const deepsea = buildMap('deep_sea', {
  name: 'Deep Sea',
  emoji: '🌊',
  accent: '#22d3ee',
  accent2: '#3b82f6',
  baseColor: '#061420',
  bg: 'radial-gradient(ellipse at 50% 25%, rgba(34,211,238,0.16), transparent 50%), radial-gradient(ellipse at 50% 85%, rgba(59,130,246,0.12), transparent 40%), linear-gradient(180deg, #061420 0%, #040e1a 100%)',
  description: 'Dive into coral bumpers, jellyfish pegs, and the hungry shark lurking in the depths.',
  gravity: 0.95,
  drag: 0.996,
  scoreMultiplier: 0.95,
  pegs: pegGrid({ rows: 1, cols: 2, top: 0.19, bottom: 0.19, left: 0.30, right: 0.70, r: 0.008 }),
  bumpers: [
    { x: 0.50, y: 0.24, r: 0.040, pts: 65, power: 1.10, color: '#ef4444', emoji: '🦈', label: 'Shark Jaw' },
    { x: 0.36, y: 0.40, r: 0.028, pts: 50, power: 1.08, color: '#22d3ee', emoji: '🐙', label: 'Octopus' },
    { x: 0.64, y: 0.40, r: 0.028, pts: 50, power: 1.08, color: '#22d3ee', emoji: '🐙', label: 'Kraken Arm' },
  ],
  slingshots: [
    { x: 0.17, y: 0.64, r: 0.030, angle: -28, power: 1.2, emoji: '🫧', label: 'Bubble Jet', color: '#67e8f9' },
    { x: 0.83, y: 0.64, r: 0.030, angle: 28, power: 1.2, emoji: '🫧', label: 'Bubble Jet', color: '#67e8f9' },
  ],
  targets: [
    { x: 0.10, y: 0.17, r: 0.020, pts: 140, emoji: '🌊', label: 'Tide Gate', color: '#22d3ee' },
    { x: 0.90, y: 0.17, r: 0.020, pts: 140, emoji: '🌊', label: 'Wave Gate', color: '#3b82f6' },
    { x: 0.50, y: 0.54, r: 0.024, pts: 50, emoji: '🧜', label: 'Mermaid Bonus', color: '#a78bfa' },
  ],
});

// ---------------------------------------------------------------------------
// 4. INFERNO VOLCANO  🌋🔥💎🐉☄️
// ---------------------------------------------------------------------------
const volcano = buildMap('inferno_volcano', {
  name: 'Inferno Volcano',
  emoji: '🌋',
  accent: '#f97316',
  accent2: '#ef4444',
  baseColor: '#1a0a04',
  bg: 'radial-gradient(ellipse at 50% 30%, rgba(249,115,22,0.20), transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(239,68,68,0.14), transparent 45%), linear-gradient(180deg, #1a0a04 0%, #120602 100%)',
  description: 'Lava bumpers, dragon slingshots, and erupting bonus targets in a scorching caldera.',
  gravity: 1.06,
  drag: 0.995,
  scoreMultiplier: 1.08,
  pegs: pegGrid({ rows: 1, cols: 2, top: 0.22, bottom: 0.22, left: 0.32, right: 0.68, r: 0.009 }),
  bumpers: [
    { x: 0.50, y: 0.22, r: 0.042, pts: 70, power: 1.14, color: '#ef4444', emoji: '🌋', label: 'Crater Core' },
    { x: 0.36, y: 0.38, r: 0.030, pts: 50, power: 1.10, color: '#f97316', emoji: '🔥', label: 'Lava Pool' },
    { x: 0.64, y: 0.38, r: 0.030, pts: 50, power: 1.10, color: '#f97316', emoji: '🔥', label: 'Magma Vent' },
  ],
  slingshots: [
    { x: 0.16, y: 0.64, r: 0.030, angle: -32, power: 1.35, emoji: '🐉', label: 'Dragon Wing', color: '#dc2626' },
    { x: 0.84, y: 0.64, r: 0.030, angle: 32, power: 1.35, emoji: '🐉', label: 'Dragon Claw', color: '#dc2626' },
  ],
  targets: [
    { x: 0.10, y: 0.16, r: 0.020, pts: 160, emoji: '☄️', label: 'Meteor Gate', color: '#fbbf24' },
    { x: 0.90, y: 0.16, r: 0.020, pts: 160, emoji: '☄️', label: 'Comet Gate', color: '#fbbf24' },
    { x: 0.50, y: 0.54, r: 0.024, pts: 55, emoji: '💎', label: 'Gem Vault', color: '#a78bfa' },
  ],
});

// ---------------------------------------------------------------------------
// 5. CYBER CIRCUIT  🤖⚡💾🔮🎮
// ---------------------------------------------------------------------------
const cyber = buildMap('cyber_circuit', {
  name: 'Cyber Circuit',
  emoji: '🤖',
  accent: '#22e1ff',
  accent2: '#ff2bd6',
  baseColor: '#0b0f1a',
  bg: 'radial-gradient(ellipse at 40% 20%, rgba(34,225,255,0.16), transparent 50%), radial-gradient(ellipse at 60% 75%, rgba(255,43,214,0.12), transparent 45%), linear-gradient(180deg, #0b0f1a 0%, #080c18 100%)',
  description: 'Neon circuits, glitch bumpers, and a data-core bonus for maximum voltage combos.',
  gravity: 1.0,
  drag: 0.996,
  scoreMultiplier: 1.0,
  pegs: pegGrid({ rows: 1, cols: 3, top: 0.17, bottom: 0.17, left: 0.24, right: 0.76, r: 0.007 }),
  bumpers: [
    { x: 0.50, y: 0.22, r: 0.040, pts: 60, power: 1.12, color: '#ff2bd6', emoji: '🔮', label: 'Glitch Core' },
    { x: 0.34, y: 0.36, r: 0.028, pts: 50, power: 1.08, color: '#22e1ff', emoji: '⚡', label: 'Volt Node' },
    { x: 0.66, y: 0.36, r: 0.028, pts: 50, power: 1.08, color: '#22e1ff', emoji: '⚡', label: 'Arc Node' },
  ],
  slingshots: [
    { x: 0.17, y: 0.64, r: 0.030, angle: -30, power: 1.25, emoji: '🎮', label: 'Joystick L', color: '#22e1ff' },
    { x: 0.83, y: 0.64, r: 0.030, angle: 30, power: 1.25, emoji: '🎮', label: 'Joystick R', color: '#ff2bd6' },
  ],
  targets: [
    { x: 0.10, y: 0.15, r: 0.020, pts: 140, emoji: '🤖', label: 'Bot Gate A', color: '#22e1ff' },
    { x: 0.90, y: 0.15, r: 0.020, pts: 140, emoji: '🤖', label: 'Bot Gate B', color: '#ff2bd6' },
    { x: 0.50, y: 0.52, r: 0.024, pts: 50, emoji: '⚡', label: 'Overclock', color: '#fbbf24' },
  ],
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const PINBALL_MAPS = Object.freeze([forest, galaxy, deepsea, volcano, cyber]);

export function pinballMapByKey(key) {
  return PINBALL_MAPS.find((m) => m.key === key) ?? PINBALL_MAPS[0];
}

export function randomPinballMap() {
  return PINBALL_MAPS[Math.floor(Math.random() * PINBALL_MAPS.length)];
}

export const COMBO_WORDS = Object.freeze([
  { min: 3, text: 'NICE',        color: '#4ade80' },
  { min: 5, text: 'GREAT',       color: '#22d3ee' },
  { min: 7, text: 'FANTASTIC',   color: '#818cf8' },
  { min: 10, text: 'INSANE',     color: '#fbbf24' },
  { min: 13, text: 'UNSTOPPABLE', color: '#f97316' },
  { min: 16, text: 'GODLIKE',    color: '#ff2bd6' },
]);

export function comboPopupFor(combo) {
  const eligible = COMBO_WORDS.filter((w) => combo >= w.min);
  return eligible.length ? eligible[eligible.length - 1] : null;
}
