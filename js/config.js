// Palette, species, upgrades and world layout: the single place to tune the game.

// Six brand colours; every other tone in the game is mixed from these.
export const PALETTE = {
  turquoise: '#3CCFC4',
  deep: '#0E3D63',
  sand: '#F2D7A6',
  coral: '#FF6F5E',
  foam: '#FFF4E3',
  sun: '#FFC870',
  // derived shades
  lagoon: '#1C9AAE',
  abyss: '#06223B',
  wood: '#A8744B',
  woodDark: '#6B4A35',
  leaf: '#2F9E8A',
  rock: '#8A9894',
  rockDark: '#4A5E6B',
};

export const WORLD = {
  waterLevel: 0,
  pier: { x0: -1.6, x1: 1.6, z0: 4, z1: 35, deckY: 1.55 },
  ladder: { x: 0.85, z: 3.2 },
  bounds: { xMin: -64, xMax: 64, zMin: -132, zMax: 64 },
  spawn: { x: 0, z: 9.5, yaw: 0 },
  shop: { x: -7.5, z: 39.5 },
};

export const ZONES = [
  { id: 'shallows', name: 'Солнечная отмель', range: '0–10 м' },
  { id: 'reef', name: 'Коралловый склон', range: '10–20 м' },
  { id: 'blue', name: 'Синяя бездна', range: '20–36 м' },
];
export const zoneIndexAt = (z) => (z > -30 ? 0 : z > -55 ? 1 : 2);

export const RARITY = {
  common: { label: 'обычная', color: '#BFEDE8' },
  rare: { label: 'редкая', color: '#3CCFC4' },
  legendary: { label: 'легендарная', color: '#FFC870' },
};

// size — body length in metres; sweet — half-width of the grab timing window;
// strength — grip level needed; alt — preferred height above the seabed.
export const SPECIES = {
  sardine: {
    id: 'sardine', name: 'Серебристая сардинка', rarity: 'common', value: 4, xp: 3,
    size: 0.36, strength: 1, sweet: 0.12, shape: 'slim',
    colors: { back: '#1F86A0', belly: '#EEF8F4', accent: '#3CCFC4', fin: '#BDEBE4' },
    pattern: 3, patFreq: 0, shine: 1.8, glow: 0,
    speed: 2.0, panic: 6.2, perception: 7.5, alertRate: 1.15, alt: [1.2, 4.5], tail: 11,
  },
  perch: {
    id: 'perch', name: 'Коралловый окунь', rarity: 'common', value: 9, xp: 6,
    size: 0.62, strength: 1, sweet: 0.12, shape: 'perch',
    colors: { back: '#FF6F5E', belly: '#FFE6CC', accent: '#FFF4E3', fin: '#FF9D80' },
    pattern: 1, patFreq: 6.5, shine: 0.9, glow: 0,
    speed: 1.35, panic: 4.6, perception: 6, alertRate: 1.0, alt: [0.6, 2.6], tail: 7,
  },
  puffer: {
    id: 'puffer', name: 'Песочный иглобрюх', rarity: 'rare', value: 20, xp: 14,
    size: 0.5, strength: 1, sweet: 0.11, shape: 'round', puff: true,
    colors: { back: '#D8B47C', belly: '#FFF4E3', accent: '#0E3D63', fin: '#F2D7A6' },
    pattern: 2, patFreq: 9, shine: 0.7, glow: 0,
    speed: 0.8, panic: 2.6, perception: 4.5, alertRate: 0.9, alt: [0.4, 1.6], tail: 6,
  },
  tang: {
    id: 'tang', name: 'Лазурный хирург', rarity: 'rare', value: 32, xp: 20,
    size: 0.66, strength: 2, sweet: 0.095, shape: 'disc',
    colors: { back: '#2B78C2', belly: '#3CCFC4', accent: '#0E3D63', fin: '#FFC870' },
    pattern: 3, patFreq: 0, shine: 1.1, glow: 0,
    speed: 1.8, panic: 5.4, perception: 6.5, alertRate: 1.1, alt: [1.0, 4.5], tail: 8,
  },
  sunfish: {
    id: 'sunfish', name: 'Золотая луна-рыба', rarity: 'legendary', value: 140, xp: 80,
    size: 1.8, strength: 3, sweet: 0.09, shape: 'mola',
    colors: { back: '#E9B65C', belly: '#FFF4E3', accent: '#FFC870', fin: '#FFD99E' },
    pattern: 2, patFreq: 3.5, shine: 1.0, glow: 0.85,
    speed: 0.75, panic: 1.9, perception: 5.5, alertRate: 0.55, alt: [3.5, 9], tail: 2.2,
  },
};

// Patrol homes as [x, z]; the first homes sit next to the pier so fish are visible on the first dive.
export const GROUPS = [
  { sp: 'sardine', homes: [[-4, 2], [14, -10], [-18, -22], [8, -34]], size: [12, 16], radius: 9 },
  { sp: 'perch', homes: [[5, 8], [-8, -4], [16, -18], [-22, -12], [2, -28], [-12, -40]], size: [3, 5], radius: 6 },
  { sp: 'puffer', homes: [[-4, 13], [10, 0], [-14, -16], [20, -30], [-6, -36], [12, -44]], size: [1, 1], radius: 5 },
  { sp: 'tang', homes: [[-10, -36], [8, -44], [-20, -50], [22, -40]], size: [3, 4], radius: 7 },
  { sp: 'sunfish', homes: [[-8, -78], [14, -98], [-16, -118]], size: [1, 1], radius: 14 },
];

// req[i] — diver level needed to buy level i+1.
export const UPGRADES = [
  {
    id: 'tank', name: 'Баллон', icon: 'i-tank', desc: 'Больше воздуха на одно погружение.',
    max: 5, cost: [40, 90, 170, 300, 480], req: [1, 1, 2, 3, 4],
    value: (l) => 60 + l * 20, fmt: (v) => `${v} с`,
  },
  {
    id: 'fins', name: 'Ласты', icon: 'i-fins', desc: 'Быстрее плывёшь и резче поворачиваешь.',
    max: 4, cost: [35, 85, 170, 300], req: [1, 2, 3, 4],
    value: (l) => 3.2 + l * 0.55, fmt: (v) => `${v.toFixed(1)} м/с`,
  },
  {
    id: 'grip', name: 'Хват', icon: 'i-hand', desc: 'Тянешься дальше, шире зона захвата, удержишь крупную рыбу.',
    max: 3, cost: [45, 130, 280], req: [1, 3, 5],
    value: (l) => l + 1, fmt: (v) => `сила ${v}`,
  },
  {
    id: 'bag', name: 'Сумка улова', icon: 'i-bag', desc: 'Больше рыбы за одно погружение.',
    max: 4, cost: [25, 60, 130, 240], req: [1, 1, 2, 3],
    value: (l) => 3 + l * 2, fmt: (v) => `${v} рыб`,
  },
  {
    id: 'lamp', name: 'Фонарь', icon: 'i-lamp', desc: 'Освещает глубину. Включается клавишей L.',
    max: 3, cost: [70, 160, 320], req: [2, 3, 5],
    value: (l) => [0, 12, 18, 26][l], fmt: (v) => (v ? `луч ${v} м` : 'нет'),
  },
  {
    id: 'suit', name: 'Гидрокостюм', icon: 'i-mask', desc: 'Держит давление и открывает новые зоны.',
    max: 2, cost: [120, 340], req: [2, 4],
    value: (l) => [10, 20, 36][l], fmt: (v) => `до ${v} м`,
  },
];

export const LEVEL_XP = [0, 30, 80, 160, 280, 450, 680, 980, 1360, 1850, 2500, 3300];

export function levelInfo(xp) {
  let level = 1;
  while (level < LEVEL_XP.length && xp >= LEVEL_XP[level]) level++;
  const cur = LEVEL_XP[level - 1];
  const next = LEVEL_XP[level] ?? cur + 1000;
  return { level, cur, next, progress: Math.min(1, (xp - cur) / (next - cur)) };
}

export function statsFor(up) {
  return {
    o2Max: 60 + up.tank * 20,
    speed: 3.2 + up.fins * 0.55,
    agility: 2.4 + up.fins * 0.45,
    reach: 1.9 + up.grip * 0.35,
    strength: 1 + up.grip,
    sweetBonus: up.grip * 0.03,
    bag: 3 + up.bag * 2,
    lamp: up.lamp,
    maxDepth: [10, 20, 36][up.suit],
  };
}
