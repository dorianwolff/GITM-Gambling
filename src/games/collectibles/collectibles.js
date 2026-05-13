/**
 * collectibles.js
 * Shared collectible catalog + visual helpers for gacha, market and profile
 * screens. This keeps the item metadata, category labels and effect visuals
 * in one place so the UI can stay in sync with the SQL seeds.
 */

import { h } from '../../utils/dom.js';
import { buildBubbleBackdrop } from './profile-effects/bubble-effect.js';
import { buildEmberBackdrop } from './profile-effects/ember-effect.js';
import { buildDragonBackdrop } from './profile-effects/dragon-effect.js';
import { buildCosmicBackdrop } from './profile-effects/cosmic-effect.js';
import { buildPrismBackdrop } from './profile-effects/prism-effect.js';
import { buildSparkBackdrop } from './profile-effects/spark-effect.js';

export const CATEGORIES = Object.freeze(['badge', 'frame', 'title', 'effect', 'trophy']);

export const CATEGORY_LABEL = Object.freeze({
  badge: 'Badge',
  frame: 'Frame',
  title: 'Title',
  effect: 'Effect',
  trophy: 'Trophy',
});

export const CATEGORY_ICON = Object.freeze({
  badge: '🏅',
  frame: '🖼️',
  title: '📜',
  effect: '✨',
  trophy: '🏆',
});

export const RARITY_ORDER = Object.freeze([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'jackpot',
  'ultra',
  'one_of_one',
]);

export const ITEM_RARITY = Object.freeze({
  common:     { label: 'Common',     color: '#8a8f99', glow: 'rgba(138,143,153,0.4)',  tier: 0 },
  uncommon:   { label: 'Uncommon',   color: '#3ddc7e', glow: 'rgba(61,220,126,0.5)',   tier: 1 },
  rare:       { label: 'Rare',       color: '#22c2ff', glow: 'rgba(34,194,255,0.55)',  tier: 2 },
  epic:       { label: 'Epic',       color: '#b06bff', glow: 'rgba(176,107,255,0.65)', tier: 3 },
  legendary:  { label: 'Legendary',  color: '#ff9a2e', glow: 'rgba(255,154,46,0.75)',  tier: 4 },
  mythic:     { label: 'Mythic',     color: '#ff5dc8', glow: 'rgba(255,93,200,0.85)',  tier: 5 },
  jackpot:    { label: 'Jackpot',    color: '#ffd96b', glow: 'rgba(255,217,107,0.95)', tier: 6 },
  ultra:      { label: 'ULTRA',      color: '#ff4cf2', glow: 'rgba(255,76,242,1)',     tier: 7 },
  one_of_one: { label: 'ONE OF ONE', color: '#ffea00', glow: 'rgba(255,234,0,0.95)',   tier: 8 },
});

export const GACHA_RARITY_ORDER = Object.freeze([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'one_of_one',
]);

export const GACHA_RARITY_META = Object.freeze({
  common:    { label: 'Common',     color: '#9aa3b2', glow: 'rgba(154,163,178,0.55)', tier: 0 },
  uncommon:  { label: 'Uncommon',   color: '#5ad17e', glow: 'rgba(90,209,126,0.55)',  tier: 1 },
  rare:      { label: 'Rare',       color: '#5aa9ff', glow: 'rgba(90,169,255,0.65)',  tier: 2 },
  epic:      { label: 'Epic',       color: '#c779ff', glow: 'rgba(199,121,255,0.7)',  tier: 3 },
  legendary: { label: 'Legendary',  color: '#ffb347', glow: 'rgba(255,179,71,0.8)',   tier: 4 },
  mythic:    { label: 'Mythic',     color: '#ff5dc8', glow: 'rgba(255,93,200,0.85)',  tier: 5 },
  one_of_one:{ label: 'ONE OF ONE', color: '#ffea00', glow: 'rgba(255,234,0,0.95)',   tier: 6 },
});

export const GACHA_POOL_SPECS = Object.freeze([
  // (slug, name, category, rarity, emoji, weight, unique)
  // Common (~52% combined)
  { slug: 'gacha_glitter_dust',     name: 'Glitter Dust',     category: 'effect', rarity: 'common',    emoji: '✨',  weight: 347, unique: false },
  { slug: 'gacha_neon_sticker',     name: 'Neon Sticker',     category: 'badge',  rarity: 'common',    emoji: '🟢',  weight: 347, unique: false },
  { slug: 'gacha_bubble_pop',       name: 'Bubble Pop',       category: 'effect', rarity: 'common',    emoji: '🫧',  weight: 346, unique: false },
  // Uncommon (~24%)
  { slug: 'gacha_pixel_frame',      name: 'Pixel Frame',      category: 'frame',  rarity: 'uncommon',  emoji: '🟦',  weight: 160, unique: false },
  { slug: 'gacha_lucky_clover',     name: 'Lucky Clover',     category: 'badge',  rarity: 'uncommon',  emoji: '🍀',  weight: 160, unique: false },
  { slug: 'gacha_meteor_shard',     name: 'Meteor Shard',     category: 'badge',  rarity: 'uncommon',  emoji: '☄️',  weight: 160, unique: false },
  // Rare (~13%)
  { slug: 'gacha_holo_frame',       name: 'Holo Frame',       category: 'frame',  rarity: 'rare',      emoji: '💠',  weight: 87,  unique: false },
  { slug: 'gacha_lightning_title',  name: '“Lightning”',      category: 'title',  rarity: 'rare',      emoji: '⚡',  weight: 87,  unique: false },
  { slug: 'gacha_orbit_token',      name: 'Orbit Token',      category: 'frame',  rarity: 'rare',      emoji: '🪐',  weight: 86,  unique: false },
  // Epic (~6%)
  { slug: 'gacha_chrome_frame',     name: 'Chrome Frame',     category: 'frame',  rarity: 'epic',      emoji: '🪞',  weight: 40,  unique: false },
  { slug: 'gacha_voidwalker_title', name: '“Voidwalker”',     category: 'title',  rarity: 'epic',      emoji: '🌀',  weight: 40,  unique: false },
  { slug: 'gacha_prism_veil',       name: 'Prism Veil',       category: 'effect', rarity: 'epic',      emoji: '🌈',  weight: 40,  unique: false },
  // Legendary (~3%)
  { slug: 'gacha_solar_aura',       name: 'Solar Aura',       category: 'effect', rarity: 'legendary', emoji: '🌞',  weight: 20,  unique: false },
  { slug: 'gacha_cosmic_frame',     name: 'Cosmic Frame',     category: 'frame',  rarity: 'legendary', emoji: '🌌',  weight: 20,  unique: false },
  { slug: 'gacha_lunar_crown',      name: 'Lunar Crown',      category: 'title',  rarity: 'legendary', emoji: '🌙',  weight: 20,  unique: false },
  // Mythic (~1.5%) — extremely rare but repeatable
  { slug: 'gacha_phoenix_title',    name: '“Phoenix”',        category: 'title',  rarity: 'mythic',    emoji: '🔥',  weight: 15,  unique: false },
  { slug: 'gacha_dragonfire_aura',  name: 'Dragonfire Aura',  category: 'effect', rarity: 'mythic',    emoji: '🐉',  weight: 15,  unique: false },
  // One-of-one (each weight=1, total ~0.5% combined; consumed forever once pulled)
  { slug: 'gacha_001_singularity',     name: '#001 Singularity',     category: 'trophy', rarity: 'one_of_one', emoji: '🕳️', weight: 1, unique: true },
  { slug: 'gacha_002_kingmaker',       name: '#002 Kingmaker',       category: 'trophy', rarity: 'one_of_one', emoji: '👑', weight: 1, unique: true },
  { slug: 'gacha_003_chronos',         name: '#003 Chronos',         category: 'trophy', rarity: 'one_of_one', emoji: '⏳', weight: 1, unique: true },
  { slug: 'gacha_004_aurora',          name: '#004 Aurora',          category: 'trophy', rarity: 'one_of_one', emoji: '🌈', weight: 1, unique: true },
  { slug: 'gacha_005_obsidian_throne', name: '#005 Obsidian Throne', category: 'trophy', rarity: 'one_of_one', emoji: '♟️', weight: 1, unique: true },
  { slug: 'gacha_006_phoenix_heart',   name: '#006 Phoenix Heart',   category: 'trophy', rarity: 'one_of_one', emoji: '❤️‍🔥', weight: 1, unique: true },
  { slug: 'gacha_007_void_crown',      name: '#007 Void Crown',      category: 'trophy', rarity: 'one_of_one', emoji: '🜲', weight: 1, unique: true },
  { slug: 'gacha_008_starforged',      name: '#008 Starforged',      category: 'trophy', rarity: 'one_of_one', emoji: '🌟', weight: 1, unique: true },
  { slug: 'gacha_009_glass_serpent',   name: '#009 Glass Serpent',   category: 'trophy', rarity: 'one_of_one', emoji: '🐍', weight: 1, unique: true },
  { slug: 'gacha_010_eternity',        name: '#010 Eternity',        category: 'trophy', rarity: 'one_of_one', emoji: '∞',  weight: 1, unique: true },
  { slug: 'gacha_011_omega',           name: '#011 Omega',           category: 'trophy', rarity: 'one_of_one', emoji: 'Ω',  weight: 1, unique: true },
  { slug: 'gacha_012_genesis',         name: '#012 Genesis',         category: 'trophy', rarity: 'one_of_one', emoji: '🜂',  weight: 1, unique: true },
]);

const EFFECT_THEME_RULES = Object.freeze([
  {
    name: 'dragon',
    match: ['dragon', 'drake', 'wyrm', 'serpent'],
    accent: '#ff7b1a',
    accent2: '#ffd166',
    particle: '🐉',
    aura: 'collectible-dragon-aura',
    float: 'collectible-dragon-float',
    ring: 'collectible-dragon-ring',
    sparkle: 'collectible-dragon-sparkle',
  },
  {
    name: 'ember',
    match: ['fire', 'ember', 'phoenix', 'lava', 'solar'],
    accent: '#ff6d8a',
    accent2: '#ffb347',
    particle: '🔥',
    aura: 'collectible-ember-aura',
    float: 'collectible-ember-float',
    ring: 'collectible-ember-ring',
    sparkle: 'collectible-ember-sparkle',
  },
  {
    name: 'cosmic',
    match: ['cosmic', 'orbit', 'moon', 'lunar', 'void', 'galaxy', 'aurora', 'singularity', 'chronos', 'starforged'],
    accent: '#b06bff',
    accent2: '#22e1ff',
    particle: '✧',
    aura: 'collectible-cosmic-aura',
    float: 'collectible-cosmic-float',
    ring: 'collectible-cosmic-ring',
    sparkle: 'collectible-cosmic-sparkle',
  },
  {
    name: 'prism',
    match: ['rainbow', 'prism', 'glass', 'aether', 'celestial', 'holo', 'chrome'],
    accent: '#ffd96b',
    accent2: '#ff2bd6',
    particle: '❋',
    aura: 'collectible-prism-aura',
    float: 'collectible-prism-float',
    ring: 'collectible-prism-ring',
    sparkle: 'collectible-prism-sparkle',
  },
  {
    name: 'bubble',
    match: ['bubble', 'foam', 'splash', 'pop'],
    accent: '#7ad9ff',
    accent2: '#b06bff',
    particle: '🫧',
    aura: 'collectible-bubble-aura',
    float: 'collectible-bubble-float',
    ring: 'collectible-bubble-ring',
    sparkle: 'collectible-bubble-sparkle',
  },
  {
    name: 'spark',
    match: ['spark', 'glitter', 'star', 'twinkle', 'shine', 'shimmer', 'meteor', 'lightning', 'orb', 'shard', 'clover'],
    accent: '#22e1ff',
    accent2: '#8b5cf6',
    particle: '✦',
    aura: 'collectible-spark-aura',
    float: 'collectible-spark-float',
    ring: 'collectible-spark-ring',
    sparkle: 'collectible-spark-sparkle',
  },
]);

const EFFECT_RARITY_BOOST = Object.freeze({
  common: 0.40,
  uncommon: 0.55,
  rare: 0.72,
  epic: 0.88,
  legendary: 1.05,
  mythic: 1.22,
  jackpot: 1.30,
  ultra: 1.38,
  one_of_one: 1.52,
});

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

function themeForCollectible(item) {
  const source = `${item?.slug ?? ''} ${item?.name ?? ''}`.toLowerCase();
  const found = EFFECT_THEME_RULES.find((rule) =>
    rule.match.some((part) => source.includes(part))
  );
  if (found) return found;

  const rarity = item?.rarity ?? 'common';
  const byName = (name) => EFFECT_THEME_RULES.find((rule) => rule.name === name);
  if (rarity === 'legendary' || rarity === 'mythic' || rarity === 'one_of_one') return byName('dragon') ?? byName('ember') ?? EFFECT_THEME_RULES[0];
  if (rarity === 'epic') return byName('prism') ?? byName('spark') ?? EFFECT_THEME_RULES[0];
  if (rarity === 'rare') return byName('spark') ?? EFFECT_THEME_RULES[0];
  return byName('bubble') ?? EFFECT_THEME_RULES[0];
}

export function getCollectibleVisual(item) {
  const rarity = ITEM_RARITY[item?.rarity] ?? ITEM_RARITY.common;
  const theme = item?.category === 'effect' ? themeForCollectible(item) : null;
  const intensity = EFFECT_RARITY_BOOST[item?.rarity] ?? 0.4;
  const categoryIcon = CATEGORY_ICON[item?.category] ?? '❔';

  return {
    rarity,
    categoryIcon,
    intensity,
    isEffect: item?.category === 'effect',
    theme,
    color: rarity.color,
    glow: rarity.glow,
    border: `1px solid ${rarity.color}55`,
    shadow: `inset 0 0 12px ${rarity.glow}22`,
    titleShadow: `0 0 6px ${rarity.glow}`,
    background: theme
      ? `radial-gradient(circle at top, ${theme.accent}22 0%, transparent 46%), linear-gradient(165deg, rgba(0,0,0,0.56), rgba(0,0,0,0.22) 58%, ${theme.accent2}10)`
      : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
    accent: theme?.accent ?? rarity.color,
    accent2: theme?.accent2 ?? rarity.color,
    particle: theme?.particle ?? '•',
    auraAnimation: 'collectible-aura',
    floatAnimation: 'collectible-float',
    ringAnimation: 'collectible-ring',
    sparkleAnimation: 'collectible-sparkle',
    particleCount: item?.category === 'effect' ? clamp(2, Math.round(2 + intensity * 4), 8) : 0,
    seed: hashString(`${item?.slug ?? ''}:${item?.name ?? ''}:${item?.rarity ?? ''}`),
  };
}

export function buildCollectibleParticles(item) {
  const visual = getCollectibleVisual(item);
  if (!visual.isEffect || visual.particleCount <= 0) return [];

  const particles = [];
  for (let i = 0; i < visual.particleCount; i++) {
    const shift = (visual.seed >>> (i % 8)) ^ (visual.seed << ((i + 3) % 7));
    const left = 8 + (shift % 76);
    const top = 10 + ((shift >>> 5) % 68);
    const size = 4 + ((shift >>> 10) % 3) + (visual.intensity > 1 ? 1 : 0);
    const delay = ((shift >>> 15) % 10) / 10;
    const duration = (2.8 - Math.min(1.1, visual.intensity * 0.35)).toFixed(2);
    particles.push({
      left: `${left}%`,
      top: `${top}%`,
      size,
      delay,
      duration,
      glyph: visual.particle,
      accent: visual.accent,
    });
  }
  return particles;
}

export function buildCollectibleRings(item) {
  const visual = getCollectibleVisual(item);
  if (!visual.isEffect) return [];

  const ringCount = clamp(1, Math.round(1 + visual.intensity * 1.5), 3);
  return Array.from({ length: ringCount }, (_, i) => ({
    delay: (i * 0.18).toFixed(2),
    duration: (3.4 - Math.min(1.5, visual.intensity * 0.5) - i * 0.08).toFixed(2),
    size: 1 - i * 0.12,
    opacity: clamp(0.35, 0.55 + visual.intensity * 0.18 - i * 0.08, 0.95),
    accent: i % 2 === 0 ? visual.accent : visual.accent2,
  }));
}

export function summarizeCollectibleEffects(inventory = []) {
  const effectRows = (inventory ?? []).filter((r) => r?.item?.category === 'effect' && r.item);
  if (!effectRows.length) return null;

  const strongestRow = effectRows.slice().sort((a, b) => raritySortIndex(b.item?.rarity) - raritySortIndex(a.item?.rarity))[0];
  if (!strongestRow?.item) return null;

  const visual = getCollectibleVisual(strongestRow.item);
  return {
    strongest: strongestRow.item,
    visual,
    count: effectRows.length,
    seed: visual.seed,
    intensity: visual.intensity,
  };
}

export function buildCollectibleBackdrop(inventory = []) {
  const summary = summarizeCollectibleEffects(inventory);
  if (!summary) return null;

  const theme = summary.visual?.theme?.name;
  if (theme === 'dragon') return buildDragonBackdrop(summary);
  if (theme === 'ember') return buildEmberBackdrop(summary);
  if (theme === 'cosmic') return buildCosmicBackdrop(summary);
  if (theme === 'prism') return buildPrismBackdrop(summary);
  if (theme === 'bubble') return buildBubbleBackdrop(summary);
  return buildSparkBackdrop(summary);
}

export function raritySortIndex(rarity) {
  const idx = RARITY_ORDER.indexOf(rarity);
  return idx === -1 ? 0 : idx;
}
