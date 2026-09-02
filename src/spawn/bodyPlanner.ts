// Miner, scout, and reserver are deliberately excluded: miner doesn't fit the symmetric
// block-repeat model these roles share (see planMinerBody, which plans its asymmetric
// body independently); scout/reserver are small fixed bodies that never scale with
// capacity (see planScoutBody/planReserverBody).
type BlockRole = Exclude<CreepRole, "miner" | "scout" | "reserver">;

// remoteHarvester uses a 1:1 MOVE ratio, unlike the local harvester's lighter 2 WORK to
// 1 MOVE - v1 has no remote roads, so full speed on plain terrain even fully loaded
// matters more than it does locally, where roads eventually cover the route.
const BASE_BLOCKS: Record<BlockRole, BodyPartConstant[]> = {
  harvester: [WORK, WORK, CARRY, MOVE],
  upgrader: [WORK, CARRY, MOVE],
  builder: [WORK, CARRY, MOVE],
  hauler: [CARRY, MOVE],
  remoteHarvester: [WORK, CARRY, MOVE, MOVE],
  // Same 1:1 ratio as the local hauler, for the same reason remoteHarvester uses 1:1
  // instead of harvester's lighter 2:1 - no remote roads, full speed matters loaded or not.
  remoteHauler: [CARRY, MOVE]
};

// A source regenerates SOURCE_ENERGY_CAPACITY every ENERGY_REGEN_TIME ticks; each WORK
// part harvests HARVEST_POWER per tick. Past this many WORK parts, a solo harvester's
// extra WORK parts sit idle every tick since the source can't regenerate fast enough
// to keep them fed.
const SOURCE_SATURATION_WORK = Math.ceil(
  SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER
);

const ROLE_MAX_REPEATS: Partial<Record<BlockRole, number>> = {
  harvester: Math.floor(
    SOURCE_SATURATION_WORK / BASE_BLOCKS.harvester.filter((p) => p === WORK).length
  )
};

export function bodyCost(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

// Miners are stationary and never need more than one MOVE part (they move once, from
// spawn to their parked container tile, then never again), so unlike every other role's
// symmetric block-repeat body, WORK parts scale independently up to the true source-
// saturation ceiling (SOURCE_SATURATION_WORK) plus exactly 1 MOVE part.
export function planMinerBody(energyCapacityAvailable: number): BodyPartConstant[] {
  const moveCost = BODYPART_COST[MOVE];
  const workCost = BODYPART_COST[WORK];

  if (energyCapacityAvailable < workCost + moveCost) return [];

  const affordableWork = Math.floor((energyCapacityAvailable - moveCost) / workCost);
  const workParts = Math.min(SOURCE_SATURATION_WORK, affordableWork);

  const body: BodyPartConstant[] = [];
  for (let i = 0; i < workParts; i++) body.push(WORK);
  body.push(MOVE);
  return body;
}

export function planScoutBody(): BodyPartConstant[] {
  return [MOVE];
}

export function planReserverBody(): BodyPartConstant[] {
  return [CLAIM, MOVE];
}

export function planBody(role: BlockRole, energyCapacityAvailable: number): BodyPartConstant[] {
  const block = BASE_BLOCKS[role];
  const cost = bodyCost(block);

  const affordableRepeats = Math.floor(energyCapacityAvailable / cost);
  const maxSizeRepeats = Math.floor(MAX_CREEP_SIZE / block.length);
  const roleMaxRepeats = ROLE_MAX_REPEATS[role] ?? Infinity;
  const repeats = Math.min(affordableRepeats, roleMaxRepeats, maxSizeRepeats);

  const body: BodyPartConstant[] = [];
  for (let i = 0; i < repeats; i++) {
    body.push(...block);
  }
  return body;
}
