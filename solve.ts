// solve.ts — orchestration: decompose into rooms, solve each room, stitch the walks together.
//
// Each room is solved on its own (the player starting on its door square, the hallway square
// outside the door standing open so a box on the door can be pushed in), then the rooms are
// stitched: walk the hallway from door to door, step in, run the room's moves, walk back out.
// A room that needs the player to leave through its door must end with the door reachable;
// the last room solved needs no exit. When decomposition fails, or any room will not solve,
// the whole level is searched as one push problem instead. Every stitched answer is replayed
// on the full level before it is returned, so a bad stitch can never ship.
import { DIRS, deltaOf, parseLevel } from './parse.ts';
import type { Level } from './parse.ts';
import { computePushDist } from './heuristic.ts';
import { computeDead } from './deadlock.ts';
import { solvePushAStar, solvePushBeam, walkTo } from './search.ts';
import type { PushProblem, PushSolution } from './search.ts';
import { detectRooms } from './rooms.ts';
import type { DetectedRoom } from './rooms.ts';

export interface SolveResult {
  moves: string;
  pushes: number;
  roomPushes: number[];
  method: string;
}

// Node-count budgets only — never the clock — so two executions write the same bytes.
// Sized from measurement (about 33us per room expansion, 70us per whole-level one): a room
// that stalls its optimal search costs at most ~3s, a whole-level fallback at most ~4s, so
// even a set that fell back on every level stays well inside the 60s wall. Rooms in practice
// solve in tens of expansions; the budgets are three orders of magnitude above that.
const ROOM_ASTAR_BUDGET = 100_000;
const ROOM_BEAM_WIDTH = 4000;
const ROOM_BEAM_BUDGET = 100_000;
const WHOLE_ASTAR_BUDGET = 40_000;
const WHOLE_BEAM_WIDTH = 2000;
const WHOLE_BEAM_BUDGET = 40_000;

function goalSetOf(goals: number[], size: number): Uint8Array {
  const g = new Uint8Array(size);
  for (const x of goals) g[x] = 1;
  return g;
}

/** The push problem for one room: its cells, its door, and the hallway square outside it. */
function buildRoomProblem(
  level: Level,
  room: DetectedRoom,
  isLast: boolean,
): PushProblem | null {
  const size = level.w * level.h;
  const floor = new Uint8Array(size);
  for (const c of room.cells) floor[c] = 1;
  floor[room.hallAdj] = 1;
  const boxCells = new Uint8Array(size);
  for (const c of room.cells) boxCells[c] = 1;
  const dist = computePushDist(level.w, floor, boxCells, room.goals);
  const dead = computeDead(boxCells, dist);
  if (room.boxes.some((b) => dead[b])) return null;
  // The player starts outside the door, on the hallway square: a box may be standing on the
  // door itself, and only from the hallway can it be pushed into the room. The player must be
  // able to reach that hallway square again at the end (to leave for the next room), unless
  // this is the last room solved.
  return {
    w: level.w,
    wall: level.wall,
    floor,
    boxCells,
    goals: room.goals,
    goalSet: goalSetOf(room.goals, size),
    boxes: room.boxes,
    player: room.hallAdj,
    exit: isLast ? -1 : room.hallAdj,
    dist,
    dead,
    nodeBudget: ROOM_ASTAR_BUDGET,
  };
}

/** Replay `moves` from (`player0`, `boxes0`); null on an illegal step or a bad letter. */
function simulate(
  level: Level,
  boxes0: number[],
  player0: number,
  moves: string,
): { player: number; boxes: number[]; pushes: number } | null {
  const { w, wall } = level;
  const boxes = boxes0.slice();
  const boxSet = new Set(boxes);
  let player = player0;
  let pushes = 0;
  for (const ch of moves) {
    const d = DIRS.findIndex((x) => x.letter === ch.toLowerCase());
    if (d < 0) return null;
    const delta = deltaOf(d, w);
    const next = player + delta;
    if (wall[next]) return null;
    if (boxSet.has(next)) {
      const beyond = next + delta;
      if (wall[beyond] || boxSet.has(beyond)) return null;
      boxSet.delete(next);
      boxSet.add(beyond);
      boxes[boxes.indexOf(next)] = beyond;
      pushes += 1;
    }
    player = next;
  }
  boxes.sort((a, b) => a - b);
  return { player, boxes, pushes };
}

function solveByRooms(
  level: Level,
  rooms: DetectedRoom[],
  hallwayRow: number,
): SolveResult | null {
  const size = level.w * level.h;
  const hallFloor = new Uint8Array(size);
  for (let x = 0; x < level.w; x++) {
    const i = hallwayRow * level.w + x;
    if (!level.wall[i]) hallFloor[i] = 1;
  }
  let moves = '';
  let player = level.player;
  let boxes = level.boxes.slice();
  const roomPushes: number[] = [];
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri]!;
    const isLast = ri === rooms.length - 1;
    const prob = buildRoomProblem(level, room, isLast);
    if (prob === null) return null;
    let sol: PushSolution | null = solvePushAStar(prob);
    if (sol === null) sol = solvePushBeam(prob, ROOM_BEAM_WIDTH, ROOM_BEAM_BUDGET);
    if (sol === null) return null;
    // Walk the hallway to the square outside this room's door, then run the room's moves
    // (they start with the player standing there, and walk or push the door box in).
    const empty = new Uint8Array(size);
    const walkIn = walkTo(level.wall, hallFloor, empty, level.w, player, room.hallAdj);
    if (walkIn === null) return null;
    moves += walkIn;
    player = room.hallAdj;
    moves += sol.moves;
    const after = simulate(level, boxes, player, sol.moves);
    if (after === null) return null;
    player = after.player;
    boxes = after.boxes;
    roomPushes.push(after.pushes);
    if (!isLast) {
      // Walk back out of the room to the hallway square outside its door.
      const roomFloor = new Uint8Array(size);
      for (const c of room.cells) roomFloor[c] = 1;
      roomFloor[room.hallAdj] = 1;
      const occ = new Uint8Array(size);
      for (const b of boxes) occ[b] = 1;
      const walkOut = walkTo(level.wall, roomFloor, occ, level.w, player, room.hallAdj);
      if (walkOut === null) return null;
      moves += walkOut;
      player = room.hallAdj;
    }
  }
  // Verify the stitched answer on the full level before it ships.
  const check = simulate(level, level.boxes, level.player, moves);
  if (check === null) return null;
  const goalSet = goalSetOf(level.goals, size);
  if (!check.boxes.every((b) => goalSet[b])) return null;
  return { moves, pushes: check.pushes, roomPushes, method: 'rooms' };
}

function solveWholeLevel(level: Level): SolveResult | null {
  const size = level.w * level.h;
  const floor = new Uint8Array(size);
  const boxCells = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    if (!level.wall[i]) {
      floor[i] = 1;
      boxCells[i] = 1;
    }
  }
  const dist = computePushDist(level.w, floor, boxCells, level.goals);
  const dead = computeDead(boxCells, dist);
  if (level.boxes.some((b) => dead[b])) return null;
  const prob: PushProblem = {
    w: level.w,
    wall: level.wall,
    floor,
    boxCells,
    goals: level.goals,
    goalSet: goalSetOf(level.goals, size),
    boxes: level.boxes,
    player: level.player,
    exit: -1,
    dist,
    dead,
    nodeBudget: WHOLE_ASTAR_BUDGET,
  };
  let sol: PushSolution | null = solvePushAStar(prob);
  if (sol === null) sol = solvePushBeam(prob, WHOLE_BEAM_WIDTH, WHOLE_BEAM_BUDGET);
  if (sol === null) return null;
  const check = simulate(level, level.boxes, level.player, sol.moves);
  if (check === null) return null;
  if (!check.boxes.every((b) => prob.goalSet[b])) return null;
  return { moves: sol.moves, pushes: check.pushes, roomPushes: [check.pushes], method: 'whole' };
}

export function solveLevel(text: string): SolveResult {
  const level = parseLevel(text);
  const detected = detectRooms(level);
  if (detected !== null) {
    const byRooms = solveByRooms(level, detected.rooms, detected.hallwayRow);
    if (byRooms !== null) return byRooms;
  }
  const whole = solveWholeLevel(level);
  if (whole !== null) return whole;
  return { moves: '', pushes: 0, roomPushes: [], method: 'failed' };
}
