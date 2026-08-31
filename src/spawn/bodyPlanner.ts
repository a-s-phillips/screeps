const BASE_BLOCKS: Record<CreepRole, BodyPartConstant[]> = {
  harvester: [WORK, WORK, CARRY, MOVE],
  upgrader: [WORK, CARRY, MOVE],
  builder: [WORK, CARRY, MOVE],
  hauler: [CARRY, MOVE]
};

// A source regenerates SOURCE_ENERGY_CAPACITY every ENERGY_REGEN_TIME ticks; each WORK
// part harvests HARVEST_POWER per tick. Past this many WORK parts, a solo harvester's
// extra WORK parts sit idle every tick since the source can't regenerate fast enough
// to keep them fed.
const SOURCE_SATURATION_WORK = Math.ceil(
  SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER
);

const ROLE_MAX_REPEATS: Partial<Record<CreepRole, number>> = {
  harvester: Math.floor(
    SOURCE_SATURATION_WORK / BASE_BLOCKS.harvester.filter((p) => p === WORK).length
  )
};

export function bodyCost(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

export function planBody(role: CreepRole, energyCapacityAvailable: number): BodyPartConstant[] {
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
