const KEY = 'glubzhe.save.v1';

const DEFAULT = () => ({
  shells: 0,
  xp: 0,
  up: { tank: 0, fins: 0, grip: 0, bag: 0, lamp: 0, suit: 0 },
  caught: {},
  best: {},
  dives: 0,
  flags: {},
  settings: { view: 'third', volume: 0.8, quality: 'high', muted: false },
});

export function loadSave() {
  const base = DEFAULT();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base,
      ...s,
      up: { ...base.up, ...(s.up || {}) },
      settings: { ...base.settings, ...(s.settings || {}) },
      flags: { ...(s.flags || {}) },
      caught: { ...(s.caught || {}) },
      best: { ...(s.best || {}) },
    };
  } catch {
    return base;
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function writeSave(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or full storage: progress just won't persist */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return DEFAULT();
}
