// search.ts — push-based A* (push-optimal) and a beam-search fallback over pushes.
//
// A state is the sorted box squares plus the player's reachable region, named by its lowest
// square: wherever the player stands inside one region, the pushes available are the same.
// The search moves boxes, not the player: each step is one push, and the walk the player takes
// to stand behind the box is rebuilt afterwards (walkTo). A* over pushes with the optimal
// assignment heuristic is push-optimal; the beam fallback trades optimality for a valid answer
// when a room stalls the optimal search. Node-count budgets only — never the clock — so two
// executions write the same bytes.
import { DIRS, deltaOf } from './parse.ts';
import { makeAssignmentHeuristic } from './heuristic.ts';
import { isCornerDead, isFrozenBlock, isWallLineDead } from './deadlock.ts';

export interface PushProblem {
  w: number;
  wall: Uint8Array;
  floor: Uint8Array; // squares the player may stand on
  boxCells: Uint8Array; // squares a box may stand on
  goals: number[];
  goalSet: Uint8Array;
  boxes: number[];
  player: number;
  exit: number; // square the player must be able to reach at the end, or -1 when it need not
  dist: Int32Array[];
  dead: Uint8Array;
  nodeBudget: number;
}

export interface PushSolution {
  moves: string;
  pushes: number;
  expanded: number;
  optimal: boolean;
}

interface Succ {
  boxes: number[];
  player: number;
  pushFrom: number;
  pushDir: number;
  low: number;
  exitOk: boolean;
}

interface RegionTool {
  reach: Uint8Array;
  compute(occupied: Uint8Array, from: number): number;
}

/** The squares the player reaches from `from` with `occupied` in the way; returns the lowest. */
function createRegionTool(size: number, w: number, floor: Uint8Array): RegionTool {
  const seen = new Int32Array(size);
  const stack = new Int32Array(size);
  const reach = new Uint8Array(size);
  let stamp = 0;
  let lastVisited: number[] = [];
  return {
    reach,
    compute(occupied: Uint8Array, from: number): number {
      for (const s of lastVisited) reach[s] = 0;
      stamp += 1;
      const mark = stamp;
      const visited: number[] = [];
      let low = from;
      let n = 0;
      stack[n++] = from;
      seen[from] = mark;
      reach[from] = 1;
      visited.push(from);
      while (n > 0) {
        const p = stack[--n]!;
        if (p < low) low = p;
        for (let d = 0; d < 4; d++) {
          const q = p + deltaOf(d, w);
          if (!floor[q] || occupied[q] || seen[q] === mark) continue;
          seen[q] = mark;
          reach[q] = 1;
          visited.push(q);
          stack[n++] = q;
        }
      }
      lastVisited = visited;
      return low;
    },
  };
}

interface SearchCtx {
  occupied: Uint8Array;
  regionA: RegionTool; // the expanding state's region (whose pushes are being tried)
  regionB: RegionTool; // a successor's region (for its key and exit check)
}

function createSearchCtx(prob: PushProblem): SearchCtx {
  const size = prob.wall.length;
  return {
    occupied: new Uint8Array(size),
    regionA: createRegionTool(size, prob.w, prob.floor),
    regionB: createRegionTool(size, prob.w, prob.floor),
  };
}

/**
 * Every push the state (boxes, player) can make: the box, the direction, the boxes after it,
 * and the player's region after it. Dead pushes never leave this function.
 */
function successors(
  prob: PushProblem,
  ctx: SearchCtx,
  boxes: number[],
  player: number,
): Succ[] {
  const { w, wall, boxCells, goalSet, dead, exit } = prob;
  const out: Succ[] = [];
  for (const b of boxes) ctx.occupied[b] = 1;
  ctx.regionA.compute(ctx.occupied, player);
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi]!;
    for (let d = 0; d < 4; d++) {
      const delta = deltaOf(d, w);
      const behind = b - delta;
      const target = b + delta;
      if (ctx.regionA.reach[behind] !== 1) continue;
      if (wall[target] || ctx.occupied[target] || !boxCells[target]) continue;
      if (
        dead[target] ||
        isCornerDead(wall, w, target, goalSet) ||
        isWallLineDead(wall, goalSet, w, target)
      ) {
        continue;
      }
      ctx.occupied[b] = 0;
      ctx.occupied[target] = 1;
      if (isFrozenBlock(wall, ctx.occupied, goalSet, target, w)) {
        ctx.occupied[target] = 0;
        ctx.occupied[b] = 1;
        continue;
      }
      const nb = boxes.slice();
      nb[bi] = target;
      nb.sort((x, y) => x - y);
      const low = ctx.regionB.compute(ctx.occupied, b);
      out.push({
        boxes: nb,
        player: b,
        pushFrom: b,
        pushDir: d,
        low,
        exitOk: exit < 0 || ctx.regionB.reach[exit] === 1,
      });
      ctx.occupied[target] = 0;
      ctx.occupied[b] = 1;
    }
  }
  for (const b of boxes) ctx.occupied[b] = 0;
  return out;
}

/**
 * The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters
 * (the first direction first on ties: fixed u, d, l, r order, so the walk is deterministic).
 * Null when `to` is out of reach.
 */
export function walkTo(
  wall: Uint8Array,
  floor: Uint8Array,
  occupied: Uint8Array,
  w: number,
  from: number,
  to: number,
): string | null {
  if (from === to) return '';
  const size = wall.length;
  const prev = new Int32Array(size).fill(-1);
  const how = new Int8Array(size).fill(-1);
  const queue = new Int32Array(size);
  let qh = 0;
  let qt = 0;
  queue[qt++] = from;
  prev[from] = from;
  while (qh < qt) {
    const p = queue[qh++]!;
    if (p === to) break;
    for (let d = 0; d < 4; d++) {
      const q = p + deltaOf(d, w);
      if (!floor[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = d;
      queue[qt++] = q;
    }
  }
  if (prev[to] === -1) return null;
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = DIRS[how[p]!]!.letter + s;
  return s;
}

/** The moves of a found state: walk to each push's square, then push, from the start state. */
function reconstructMoves(
  prob: PushProblem,
  ctx: SearchCtx,
  sParent: number[],
  sPushFrom: number[],
  sPushDir: number[],
  found: number,
): string {
  const { w, wall, floor } = prob;
  const chain: number[] = [];
  for (let t = found; t > 0; t = sParent[t]!) chain.push(t);
  chain.reverse();
  let moves = '';
  let player = prob.player;
  let boxes = prob.boxes.slice();
  for (const t of chain) {
    const from = sPushFrom[t]!;
    const d = sPushDir[t]!;
    const delta = deltaOf(d, w);
    for (const b of boxes) ctx.occupied[b] = 1;
    const walk = walkTo(wall, floor, ctx.occupied, w, player, from - delta);
    for (const b of boxes) ctx.occupied[b] = 0;
    if (walk === null) return '';
    moves += walk + DIRS[d]!.push;
    player = from;
    const i = boxes.indexOf(from);
    boxes[i] = from + delta;
    boxes.sort((a, b) => a - b);
  }
  return moves;
}

function heapLess(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  // Lower f first; on a tie the deeper state first, then the one found first: deterministic.
  return (
    a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])))
  );
}

function heapPush(
  heap: [number, number, number, number][],
  e: [number, number, number, number],
): void {
  let i = heap.length;
  heap.push(e);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!heapLess(heap[i]!, heap[p]!)) break;
    const tmp = heap[i]!;
    heap[i] = heap[p]!;
    heap[p] = tmp;
    i = p;
  }
}

function heapPop(heap: [number, number, number, number][]): [number, number, number, number] {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    for (let i = 0; ; ) {
      let c = 2 * i + 1;
      if (c >= heap.length) break;
      if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
      if (!heapLess(heap[c]!, heap[i]!)) break;
      const tmp = heap[i]!;
      heap[i] = heap[c]!;
      heap[c] = tmp;
      i = c;
    }
  }
  return top;
}

/**
 * Push-optimal A* over pushes. The goal test runs on pop, with a consistent heuristic, so the
 * first solved state popped is push-optimal. Null when the node budget runs out or no solution
 * exists in the problem as stated.
 */
export function solvePushAStar(prob: PushProblem): PushSolution | null {
  const { goalSet, boxes, player, exit, dist, dead, nodeBudget } = prob;
  const h = makeAssignmentHeuristic(dist, prob.goals);
  if (boxes.some((b) => dead[b])) return null;
  if (h(boxes) === Infinity) return null;
  const ctx = createSearchCtx(prob);
  const sBoxes: number[][] = [boxes.slice()];
  const sPlayer: number[] = [player];
  const sParent: number[] = [-1];
  const sPushFrom: number[] = [-1];
  const sPushDir: number[] = [-1];
  const sLow: number[] = [0];
  const sExitOk: boolean[] = [false];
  const sG: number[] = [0];
  const best = new Map<string, number>();
  const heap: [number, number, number, number][] = [];
  let counter = 0;
  const keyOf = (bs: number[], low: number): string => `${low}:${bs.join(',')}`;
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet[b]);
  for (const b of boxes) ctx.occupied[b] = 1;
  const low0 = ctx.regionA.compute(ctx.occupied, player);
  for (const b of boxes) ctx.occupied[b] = 0;
  sLow[0] = low0;
  sExitOk[0] = exit < 0 || ctx.regionA.reach[exit] === 1;
  best.set(keyOf(boxes, low0), 0);
  heapPush(heap, [h(boxes), 0, counter++, 0]);
  if (solved(boxes) && sExitOk[0]) {
    return { moves: '', pushes: 0, expanded: 0, optimal: true };
  }
  let expanded = 0;
  while (heap.length > 0) {
    const entry = heapPop(heap);
    const g = entry[1];
    const s = entry[3];
    if (best.get(keyOf(sBoxes[s]!, sLow[s]!)) !== s) continue;
    if (solved(sBoxes[s]!) && sExitOk[s]!) {
      return {
        moves: reconstructMoves(prob, ctx, sParent, sPushFrom, sPushDir, s),
        pushes: g,
        expanded,
        optimal: true,
      };
    }
    if (expanded >= nodeBudget) return null;
    expanded += 1;
    const succs = successors(prob, ctx, sBoxes[s]!, sPlayer[s]!);
    for (const su of succs) {
      const ng = g + 1;
      const k = keyOf(su.boxes, su.low);
      const prev = best.get(k);
      if (prev !== undefined && sG[prev]! <= ng) continue;
      const hs = h(su.boxes);
      if (hs === Infinity) continue;
      const t = sBoxes.length;
      sBoxes.push(su.boxes);
      sPlayer.push(su.player);
      sParent.push(s);
      sPushFrom.push(su.pushFrom);
      sPushDir.push(su.pushDir);
      sLow.push(su.low);
      sExitOk.push(su.exitOk);
      sG.push(ng);
      best.set(k, t);
      heapPush(heap, [ng + hs, ng, counter++, t]);
    }
  }
  return null;
}

/**
 * Beam search over pushes: keeps the `width` most promising states per push depth, scored by
 * pushes made plus the assignment heuristic. Not optimal, but it still returns a valid solution
 * when the optimal search stalls — a longer valid solution is worth far more than none.
 */
export function solvePushBeam(
  prob: PushProblem,
  width: number,
  genBudget: number,
): PushSolution | null {
  const { goalSet, boxes, player, exit, dist, dead } = prob;
  const h = makeAssignmentHeuristic(dist, prob.goals);
  if (boxes.some((b) => dead[b])) return null;
  if (h(boxes) === Infinity) return null;
  const ctx = createSearchCtx(prob);
  const sBoxes: number[][] = [boxes.slice()];
  const sPlayer: number[] = [player];
  const sParent: number[] = [-1];
  const sPushFrom: number[] = [-1];
  const sPushDir: number[] = [-1];
  const sG: number[] = [0];
  const best = new Map<string, number>();
  const keyOf = (bs: number[], low: number): string => `${low}:${bs.join(',')}`;
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet[b]);
  for (const b of boxes) ctx.occupied[b] = 1;
  const low0 = ctx.regionA.compute(ctx.occupied, player);
  for (const b of boxes) ctx.occupied[b] = 0;
  const exitOk0 = exit < 0 || ctx.regionA.reach[exit] === 1;
  best.set(keyOf(boxes, low0), 0);
  if (solved(boxes) && exitOk0) {
    return { moves: '', pushes: 0, expanded: 0, optimal: false };
  }
  let beam: number[] = [0];
  let generated = 0;
  let counter = 0;
  while (beam.length > 0) {
    const cand: { f: number; g: number; c: number; t: number }[] = [];
    for (const s of beam) {
      const g = sG[s]!;
      const succs = successors(prob, ctx, sBoxes[s]!, sPlayer[s]!);
      for (const su of succs) {
        const ng = g + 1;
        const k = keyOf(su.boxes, su.low);
        const prev = best.get(k);
        if (prev !== undefined && sG[prev]! <= ng) continue;
        const hs = h(su.boxes);
        if (hs === Infinity) continue;
        const t = sBoxes.length;
        sBoxes.push(su.boxes);
        sPlayer.push(su.player);
        sParent.push(s);
        sPushFrom.push(su.pushFrom);
        sPushDir.push(su.pushDir);
        sG.push(ng);
        best.set(k, t);
        generated += 1;
        if (generated > genBudget) return null;
        if (solved(su.boxes) && su.exitOk) {
          return {
            moves: reconstructMoves(prob, ctx, sParent, sPushFrom, sPushDir, t),
            pushes: ng,
            expanded: generated,
            optimal: false,
          };
        }
        cand.push({ f: ng + hs, g: ng, c: counter++, t });
      }
    }
    cand.sort((a, b) => a.f - b.f || b.g - a.g || a.c - b.c);
    beam = cand.slice(0, width).map((c) => c.t);
  }
  return null;
}
