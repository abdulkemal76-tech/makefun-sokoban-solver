// deadlock.ts — the deadlocks a push search prunes before a state ever expands.
//
// Four tests, all sound (none prunes a solvable state):
//   - dead squares: from the push-distance maps, a square no goal is reachable from;
//   - corners: walls on two adjacent perpendicular sides, so no push can ever move the box;
//   - wall lines: a box leaning on a wall with no goal anywhere along that wall's run;
//   - frozen 2x2 blocks: four squares of walls and boxes holding a box off its goal.
// The dead-square table subsumes the corner and wall-line tests by construction (the reverse
// push BFS behind it only ever reaches squares a box can leave); the explicit tests are kept as
// cheap extra guards on the square a push just landed on.
import { DIRS, deltaOf } from './parse.ts';

/** dead[c] = 1 when no goal is reachable by pushes from square c (from the push-distance maps). */
export function computeDead(boxCells: Uint8Array, dist: Int32Array[]): Uint8Array {
  const dead = new Uint8Array(boxCells.length);
  for (let c = 0; c < boxCells.length; c++) {
    if (!boxCells[c]) continue;
    let live = false;
    for (let g = 0; g < dist.length; g++) {
      if (dist[g]![c]! >= 0) {
        live = true;
        break;
      }
    }
    if (!live) dead[c] = 1;
  }
  return dead;
}

/** True when the box on `cell` sits in a corner (walls on two adjacent perpendicular sides). */
export function isCornerDead(
  wall: Uint8Array,
  w: number,
  cell: number,
  goalSet: Uint8Array,
): boolean {
  if (goalSet[cell]) return false;
  const up = wall[cell - w] === 1;
  const down = wall[cell + w] === 1;
  const left = wall[cell - 1] === 1;
  const right = wall[cell + 1] === 1;
  return (up && left) || (up && right) || (down && left) || (down && right);
}

/**
 * True when the box on `cell` leans on a wall and can never leave that wall's run: the run
 * holds no goal, and every square of the run has the wall still beside it, so there is no gap
 * to slip through. A box that can slide to a gap and step off the wall is NOT dead — the gap
 * check is what makes this sound.
 */
export function isWallLineDead(
  wall: Uint8Array,
  goalSet: Uint8Array,
  w: number,
  cell: number,
): boolean {
  if (goalSet[cell]) return false;
  // The box slides along the run beside the wall (wallDelta away). It is dead on that side
  // only when the run holds no goal and the wall never gaps along the whole run.
  const runDead = (wallDelta: number, stepA: number, stepB: number): boolean => {
    for (const step of [stepA, stepB]) {
      for (let x = cell; !wall[x]; x += step) {
        if (goalSet[x]) return false;
        if (wall[x + wallDelta] === 0) return false;
      }
    }
    return true;
  };
  if (wall[cell - w] === 1 && runDead(-w, -1, 1)) return true;
  if (wall[cell + w] === 1 && runDead(w, -1, 1)) return true;
  if (wall[cell - 1] === 1 && runDead(-1, -w, w)) return true;
  if (wall[cell + 1] === 1 && runDead(1, -w, w)) return true;
  return false;
}

/**
 * True when the box just pushed to `t` sits in a frozen 2x2 block: four squares of walls and
 * boxes with a box among them off its goal. None of those boxes can ever move again.
 */
export function isFrozenBlock(
  wall: Uint8Array,
  occupied: Uint8Array,
  goalSet: Uint8Array,
  t: number,
  w: number,
): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (
      !(
        (wall[a] || occupied[a]) &&
        (wall[b] || occupied[b]) &&
        (wall[c] || occupied[c]) &&
        (wall[d] || occupied[d])
      )
    ) {
      continue;
    }
    if (
      (occupied[a] && !goalSet[a]) ||
      (occupied[b] && !goalSet[b]) ||
      (occupied[c] && !goalSet[c]) ||
      (occupied[d] && !goalSet[d])
    ) {
      return true;
    }
  }
  return false;
}
