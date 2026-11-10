export interface VehicleDef {
  id: string;
  name: string;
  len: number;
  wid: number;
  mass: number;
  accel: number;
  maxSpeed: number;
  steer: number;
  grip: number;
  hp: number;
  colors: number[];
  kind: 'car' | 'sports' | 'pickup' | 'van' | 'taxi' | 'bus' | 'patrol' | 'tactical' | 'enforcer';
  seats: number;
  weight: number;
}

const CIV = [0xc8343c, 0x2f6fd0, 0xe0e0e8, 0x30343c, 0x2e9c6a, 0xd88a1e, 0x7a4fd0, 0x8b939e, 0x1fb5c4];

const V = (d: VehicleDef) => d;
export const VEHICLES: Record<string, VehicleDef> = {
  wren: V({ id: 'wren', name: 'Wren', len: 3.6, wid: 1.7, mass: 900, accel: 9, maxSpeed: 21, steer: 2.7, grip: 9, hp: 80, colors: CIV, kind: 'car', seats: 2, weight: 4 }),
  marlow: V({ id: 'marlow', name: 'Marlow', len: 4.3, wid: 1.85, mass: 1300, accel: 8, maxSpeed: 22, steer: 2.4, grip: 8, hp: 100, colors: CIV, kind: 'car', seats: 4, weight: 5 }),
  kestrel: V({ id: 'kestrel', name: 'Kestrel GT', len: 4.2, wid: 1.85, mass: 1150, accel: 13, maxSpeed: 30, steer: 2.6, grip: 7, hp: 90, colors: [0xff3d6a, 0xffd21f, 0x18e0b0, 0xf2f2f2], kind: 'sports', seats: 2, weight: 1 }),
  bastion: V({ id: 'bastion', name: 'Bastion', len: 4.8, wid: 2.0, mass: 1900, accel: 7, maxSpeed: 20, steer: 2.1, grip: 8, hp: 140, colors: CIV, kind: 'pickup', seats: 2, weight: 2 }),
  hauler: V({ id: 'hauler', name: 'Hauler', len: 5.2, wid: 2.1, mass: 2300, accel: 6, maxSpeed: 18, steer: 2.0, grip: 8, hp: 150, colors: [0xe0e0e8, 0x8b939e, 0x3c6fa8, 0xa86a3c], kind: 'van', seats: 2, weight: 2 }),
  fare: V({ id: 'fare', name: 'Fare', len: 4.3, wid: 1.85, mass: 1350, accel: 9, maxSpeed: 23, steer: 2.5, grip: 8, hp: 110, colors: [0x7be03a], kind: 'taxi', seats: 4, weight: 2 }),
  omnibus: V({ id: 'omnibus', name: 'Omnibus', len: 8.5, wid: 2.5, mass: 6000, accel: 4.5, maxSpeed: 15, steer: 1.5, grip: 9, hp: 260, colors: [0x3aa0e0, 0xe06a3a], kind: 'bus', seats: 2, weight: 1 }),
  patrol: V({ id: 'patrol', name: 'Patrol Unit', len: 4.5, wid: 1.9, mass: 1500, accel: 12, maxSpeed: 28, steer: 2.6, grip: 9, hp: 140, colors: [0x1c2440], kind: 'patrol', seats: 2, weight: 0 }),
  bulwark: V({ id: 'bulwark', name: 'Bulwark', len: 5.6, wid: 2.2, mass: 3200, accel: 9, maxSpeed: 24, steer: 2.1, grip: 9, hp: 260, colors: [0x20262e], kind: 'tactical', seats: 4, weight: 0 }),
  warden: V({ id: 'warden', name: 'Warden', len: 6.0, wid: 2.4, mass: 5000, accel: 8, maxSpeed: 23, steer: 1.9, grip: 10, hp: 480, colors: [0x3a4030], kind: 'enforcer', seats: 4, weight: 0 }),
};
export const TRAFFIC_POOL: string[] = [];
for (const d of Object.values(VEHICLES)) for (let i = 0; i < d.weight; i++) TRAFFIC_POOL.push(d.id);
export const isPolice = (d: VehicleDef) => d.kind === 'patrol' || d.kind === 'tactical' || d.kind === 'enforcer';

export interface WeaponDef {
  id: string;
  name: string;
  dmg: number;
  cd: number;
  speed: number;
  spread: number;
  pellets: number;
  life: number;
  melee?: boolean;
  /** Blast radius if explosive. */
  blast?: number;
  pickup: number;
  vehMul: number;
}
export const WEAPONS: Record<string, WeaponDef> = {
  fists: { id: 'fists', name: 'Fists', dmg: 18, cd: 0.35, speed: 0, spread: 0, pellets: 1, life: 0, melee: true, pickup: 0, vehMul: 0.1 },
  pistol: { id: 'pistol', name: 'Sidearm', dmg: 24, cd: 0.28, speed: 70, spread: 0.025, pellets: 1, life: 0.6, pickup: 24, vehMul: 0.5 },
  smg: { id: 'smg', name: 'Buzzgun', dmg: 14, cd: 0.07, speed: 75, spread: 0.07, pellets: 1, life: 0.5, pickup: 60, vehMul: 0.5 },
  shotgun: { id: 'shotgun', name: 'Scatter', dmg: 14, cd: 0.8, speed: 60, spread: 0.17, pellets: 7, life: 0.25, pickup: 12, vehMul: 0.6 },
  flamer: { id: 'flamer', name: 'Torch', dmg: 5, cd: 0.04, speed: 17, spread: 0.12, pellets: 1, life: 0.55, pickup: 150, vehMul: 0.8 },
  rocket: { id: 'rocket', name: 'Lance', dmg: 140, cd: 1.1, speed: 34, spread: 0.01, pellets: 1, life: 2.2, blast: 7, pickup: 5, vehMul: 1 },
  grenade: { id: 'grenade', name: 'Pineapple', dmg: 130, cd: 0.9, speed: 17, spread: 0.02, pellets: 1, life: 1.4, blast: 6.5, pickup: 6, vehMul: 1 },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'flamer', 'rocket', 'grenade'];

export interface FactionDef {
  name: string;
  color: number;
  css: string;
  blurb: string;
}
/** Faction index equals the district it controls. */
export const FACTIONS: FactionDef[] = [
  { name: 'Brass Saints', color: 0xffb020, css: '#ffb020', blurb: 'Old-money racketeers of Old Quay' },
  { name: 'The Circuit', color: 0x35e0ff, css: '#35e0ff', blurb: 'Data smugglers of Glasswork' },
  { name: 'Verdant Hand', color: 0x5dff7a, css: '#5dff7a', blurb: 'Bio-hackers of Greenhouse Row' },
];
/** Working for a faction angers its rival. */
export const rivalOf = (f: number) => (f + 1) % 3;

export const CASH_GOAL = 60000;
