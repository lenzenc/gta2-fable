import type { Game } from './game';

const KEY = 'neon-ledger-save-v1';

export interface SaveData {
  cash: number;
  rep: number[];
  done: string[];
  ammo: Record<string, number>;
  weapon: string;
  district: number;
  kills: { peds: number; vehicles: number };
  won: boolean;
}

export function toSave(g: Game): SaveData {
  return { cash: g.cash, rep: [...g.rep], done: [...g.done], ammo: { ...g.ammo }, weapon: g.weapon, district: g.homeDistrict, kills: { ...g.kills }, won: g.won };
}

export function applySave(g: Game, s: SaveData) {
  g.cash = s.cash;
  g.rep = [...s.rep];
  g.done = new Set(s.done);
  g.ammo = { ...s.ammo };
  g.weapon = s.weapon;
  g.kills = { ...s.kills };
  g.won = s.won;
  g.homeDistrict = s.district;
  const h = g.city.anchors[s.district].safehouse;
  g.player.x = h.x;
  g.player.y = h.y;
  g.inSafe = true;
}

export function writeSave(g: Game) {
  try {
    localStorage.setItem(KEY, JSON.stringify(toSave(g)));
  } catch {
    /* storage unavailable */
  }
}
export function readSave(): SaveData | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as SaveData) : null;
  } catch {
    return null;
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
