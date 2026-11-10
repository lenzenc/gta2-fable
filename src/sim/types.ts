import type { VehicleDef } from '../data/defs';

export interface TrafficAI {
  dir: number;
  turn: number;
  ex: number;
  ey: number;
  cruise: number;
  panicT: number;
  stuckT: number;
  lostT: number;
}
export interface CopAI {
  stuckT: number;
  reverseT: number;
  revSteer: number;
  weapon: string;
}
export interface Vehicle {
  id: number;
  def: VehicleDef;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  av: number;
  hp: number;
  fireT: number;
  wreck: boolean;
  wreckT: number;
  remove: boolean;
  driver: 'none' | 'player' | 'ai' | 'cop';
  ai: TrafficAI | null;
  cop: CopAI | null;
  color: number;
  throttle: number;
  steer: number;
  handbrake: boolean;
  parked: boolean;
  siren: boolean;
  missionTag: boolean;
  byPlayerT: number;
  skid: number;
  parkTile: number;
}
export type PedKind = 'player' | 'civ' | 'gang' | 'cop' | 'target';
export interface Ped {
  id: number;
  kind: PedKind;
  x: number;
  y: number;
  a: number;
  hp: number;
  armor: number;
  faction: number;
  state: 'idle' | 'wander' | 'flee' | 'attack' | 'dead';
  tx: number;
  ty: number;
  dir: number;
  speed: number;
  fleeT: number;
  fx: number;
  fy: number;
  cooldown: number;
  weapon: string;
  deadT: number;
  walk: number;
  moving: boolean;
  color: number;
  skin: number;
  remove: boolean;
  hostile: boolean;
  crossing: number;
  missionTag: boolean;
  arrestT: number;
}
export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  kind: string;
  dmg: number;
  owner: number;
  byPlayer: boolean;
}
export interface Pickup {
  id: number;
  x: number;
  y: number;
  kind: string;
  amount: number;
  active: boolean;
  respawnT: number;
  temp: boolean;
  ttl: number;
  missionTag: boolean;
}
export interface GameEvent {
  type: string;
  x: number;
  y: number;
  a: number;
  n: number;
  s: string;
  s2: string;
}
export interface InputState {
  /** right - left */
  mx: number;
  /** down - up */
  my: number;
  aimX: number;
  aimY: number;
  aim: boolean;
  fire: boolean;
  handbrake: boolean;
  enter: boolean;
  interact: boolean;
  nextW: boolean;
  prevW: boolean;
  slot: number;
}
export const emptyInput = (): InputState => ({
  mx: 0, my: 0, aimX: 0, aimY: 0, aim: false, fire: false, handbrake: false, enter: false, interact: false, nextW: false, prevW: false, slot: -1,
});
