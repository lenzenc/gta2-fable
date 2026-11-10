export type Loc = { d: number; k: 'spot' | 'yard' | 'terminal' | 'safehouse' | 'paint'; i?: number };
export type Step =
  | { t: 'goto'; loc: Loc; text: string; time?: number }
  | { t: 'steal'; loc: Loc; veh: string; text: string; heat?: number }
  | { t: 'deliver'; loc: Loc; text: string; time?: number }
  | { t: 'eliminate'; loc: Loc; n: number; faction: number; weapon: string; text: string }
  | { t: 'destroy'; loc: Loc; veh: string; n: number; text: string }
  | { t: 'collect'; locs: Loc[]; text: string; time?: number }
  | { t: 'heat'; level: number; text: string }
  | { t: 'give'; weapon: string; ammo: number; text: string };

export interface MissionDef {
  id: string;
  faction: number;
  title: string;
  brief: string;
  reward: number;
  repReq: number;
  steps: Step[];
}

const yard = (d: number, i: number): Loc => ({ d, k: 'yard', i });
const spot = (d: number, i: number): Loc => ({ d, k: 'spot', i });
const term = (d: number): Loc => ({ d, k: 'terminal' });

export const MISSIONS: MissionDef[] = [
  // Brass Saints — Old Quay
  {
    id: 'bs1', faction: 0, title: 'Collection Day', reward: 3000, repReq: 0,
    brief: 'Three shopfronts owe the Saints. Pick up the envelopes.',
    steps: [
      { t: 'collect', locs: [yard(0, 0), yard(0, 1), yard(0, 2)], text: 'Collect the three envelopes' },
      { t: 'goto', loc: term(0), text: 'Bring the take back to the Saints' },
    ],
  },
  {
    id: 'bs2', faction: 0, title: 'Borrowed Wheels', reward: 5000, repReq: 0,
    brief: 'A Circuit courier parks a Kestrel GT in Glasswork. The Saints want it.',
    steps: [
      { t: 'steal', loc: yard(1, 0), veh: 'kestrel', text: 'Steal the Kestrel GT in Glasswork', heat: 1 },
      { t: 'deliver', loc: yard(0, 3), text: 'Deliver it to the Old Quay lockup', time: 150 },
    ],
  },
  {
    id: 'bs3', faction: 0, title: 'Unplugged', reward: 8000, repReq: 20,
    brief: 'A Circuit crew is tapping Saints phone lines. Cut the connection.',
    steps: [
      { t: 'give', weapon: 'smg', ammo: 90, text: '' },
      { t: 'eliminate', loc: yard(1, 1), n: 4, faction: 1, weapon: 'pistol', text: 'Take out the Circuit wire crew' },
      { t: 'heat', level: 2, text: 'Shake the heat' },
    ],
  },
  {
    id: 'bs4', faction: 0, title: 'Burn Rate', reward: 14000, repReq: 40,
    brief: 'The Circuit moves its servers by van. Make sure they never arrive.',
    steps: [
      { t: 'give', weapon: 'grenade', ammo: 8, text: '' },
      { t: 'destroy', loc: yard(1, 2), veh: 'hauler', n: 3, text: 'Destroy the three Circuit Haulers' },
      { t: 'goto', loc: term(0), text: 'Report back to the Saints' },
    ],
  },
  // The Circuit — Glasswork
  {
    id: 'ci1', faction: 1, title: 'Dead Drop', reward: 3000, repReq: 0,
    brief: 'A drive is waiting in a planter. Get it across town before the key expires.',
    steps: [
      { t: 'collect', locs: [yard(1, 3)], text: 'Pick up the drive' },
      { t: 'goto', loc: yard(2, 0), text: 'Run it to the Greenhouse Row contact', time: 110 },
    ],
  },
  {
    id: 'ci2', faction: 1, title: 'Signal Jam', reward: 5000, repReq: 0,
    brief: 'Verdant Hand relays are flooding our bands. Pull the boxes.',
    steps: [
      { t: 'collect', locs: [yard(2, 1), yard(2, 2), yard(2, 3), yard(2, 4)], text: 'Pull the four relay boxes', time: 200 },
    ],
  },
  {
    id: 'ci3', faction: 1, title: 'Root Access', reward: 9000, repReq: 20,
    brief: 'The city keeps a Bulwark tactical van in Old Quay. We want what is inside it.',
    steps: [
      { t: 'steal', loc: yard(0, 4), veh: 'bulwark', text: 'Steal the Bulwark in Old Quay', heat: 2 },
      { t: 'deliver', loc: yard(1, 4), text: 'Bring the Bulwark to the Glasswork garage' },
      { t: 'heat', level: 1, text: 'Lose the heat' },
    ],
  },
  {
    id: 'ci4', faction: 1, title: 'Hard Reset', reward: 14000, repReq: 40,
    brief: 'The Verdant Hand grew something that eats fibre. Wipe the lab crew and their trucks.',
    steps: [
      { t: 'give', weapon: 'shotgun', ammo: 24, text: '' },
      { t: 'eliminate', loc: yard(2, 5), n: 6, faction: 2, weapon: 'smg', text: 'Clear out the Verdant lab crew' },
      { t: 'destroy', loc: yard(2, 3), veh: 'bastion', n: 2, text: 'Destroy both Verdant Bastions' },
    ],
  },
  // Verdant Hand — Greenhouse Row
  {
    id: 'vh1', faction: 2, title: 'Seed Run', reward: 3000, repReq: 0,
    brief: 'A Hauler full of cuttings is wilting at the kerb. Drive it home, gently.',
    steps: [
      { t: 'steal', loc: yard(2, 0), veh: 'hauler', text: 'Get in the Hauler' },
      { t: 'deliver', loc: yard(2, 5), text: 'Drive the cuttings to the nursery', time: 100 },
    ],
  },
  {
    id: 'vh2', faction: 2, title: 'Pruning', reward: 5000, repReq: 0,
    brief: 'Saints collectors have been leaning on our growers. Trim them back.',
    steps: [
      { t: 'give', weapon: 'pistol', ammo: 36, text: '' },
      { t: 'eliminate', loc: yard(0, 5), n: 3, faction: 0, weapon: 'pistol', text: 'Deal with the Saints collectors' },
    ],
  },
  {
    id: 'vh3', faction: 2, title: 'Compost', reward: 8000, repReq: 20,
    brief: 'The Saints love their sedans. Turn three of them into mulch.',
    steps: [
      { t: 'give', weapon: 'grenade', ammo: 8, text: '' },
      { t: 'destroy', loc: yard(0, 1), veh: 'marlow', n: 3, text: 'Destroy the three Saints Marlows' },
      { t: 'heat', level: 3, text: 'Lose the heat' },
    ],
  },
  {
    id: 'vh4', faction: 2, title: 'Wildfire', reward: 14000, repReq: 40,
    brief: 'Take the Torch. Old Quay has a counting house that needs clearing.',
    steps: [
      { t: 'give', weapon: 'flamer', ammo: 300, text: '' },
      { t: 'eliminate', loc: yard(0, 2), n: 6, faction: 0, weapon: 'pistol', text: 'Burn out the counting house crew' },
      { t: 'goto', loc: term(2), text: 'Return to the Hand' },
    ],
  },
];
export { spot };
