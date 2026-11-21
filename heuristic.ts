// heuristic.ts — push-distance maps and the optimal box-to-goal assignment heuristic.
//
// For each goal, a reverse push BFS over the board (ignoring the other boxes) gives the fewest
// pushes one box needs to travel from any square to that goal. Summing those distances over the
// cheapest one-box-per-goal assignment is a lower bound on the pushes still needed, so A* over
// pushes with it stays push-optimal. The same maps decide which squares are dead (see deadlock.ts).
import { DIRS, deltaOf } from './parse.ts';

/**
 * dist[g][cell]: fewest pushes for ONE box to travel from `cell` to goals[g], ignoring the other
 * boxes; -1 when no push sequence can get it there. A box may only ever stand on a `boxCells`
 * square; the player square a push needs must be a `floor` square (room cells plus, for a room,
 * the hallway square outside its door).
 */
export function computePushDist(
  w: number,
  floor: Uint8Array,
  boxCells: Uint8Array,
  goals: number[],
): Int32Array[] {
  const dists: Int32Array[] = [];
  for (const g of goals) {
    const dist = new Int32Array(floor.length).fill(-1);
    dist[g] = 0;
    const queue = [g];
    for (let qi = 0; qi < queue.length; qi++) {
      const x = queue[qi]!;
      for (let d = 0; d < 4; d++) {
        const delta = deltaOf(d, w);
        const y = x - delta; // the box stood here before the push that brought it to x
        const p = y - delta; // the player stood here to make that push
        if (!boxCells[y] || !floor[p]) continue;
        if (dist[y] !== -1) continue;
        dist[y] = dist[x]! + 1;
        queue.push(y);
      }
    }
    dists.push(dist);
  }
  return dists;
}

/** All permutations of [0..n-1] in lexicographic order (fixed order: deterministic). */
function permutations(n: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const rec = (): void => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}

/**
 * The heuristic: the cheapest assignment of boxes to distinct goals by single-box push distance.
 * Admissible (each box must reach a different goal, and one box alone can only do better than
 * with the others in the way), so A* with it returns push-optimal solutions. With many boxes the
 * permutations explode, so the one-goal-each constraint is dropped instead: the sum of each box's
 * nearest goal is still a lower bound, and the fallback search it serves is not optimal anyway.
 */
export function makeAssignmentHeuristic(
  dist: Int32Array[],
  goals: number[],
): (boxes: number[]) => number {
  const n = goals.length;
  if (n <= 6) {
    const perms = permutations(n);
    return (boxes: number[]): number => {
      let best = Infinity;
      for (const p of perms) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          const d = dist[p[i]!]![boxes[i]!]!;
          if (d < 0) {
            s = Infinity;
            break;
          }
          s += d;
        }
        if (s < best) best = s;
      }
      return best;
    };
  }
  return (boxes: number[]): number => {
    let s = 0;
    for (const b of boxes) {
      let m = Infinity;
      for (let g = 0; g < n; g++) {
        const d = dist[g]![b]!;
        if (d >= 0 && d < m) m = d;
      }
      if (m === Infinity) return Infinity;
      s += m;
    }
    return s;
  };
}
