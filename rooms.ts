// rooms.ts — hallway/door detection and room flood-fill.
//
// The generator lays a 1-wide hallway across the board with 1-4 rooms off it, each opening
// through one door. A box pushed through a door into the hallway can never be pushed back, so
// every box stays in its room: cut the hallway row out of the floor (its squares reach no goal)
// and each floor part left that holds boxes is one room, with its door the one room square
// touching the hallway. A room whose door square is itself a goal is solved last, since a box
// ending on the door would shut the player inside the room.
import { deltaOf } from './parse.ts';
import type { Level } from './parse.ts';
import { computePushDist } from './heuristic.ts';

export interface DetectedRoom {
  cells: number[];
  cellSet: Uint8Array;
  boxes: number[];
  goals: number[];
  door: number;
  hallAdj: number;
}

export function detectRooms(
  level: Level,
): { hallwayRow: number; rooms: DetectedRoom[] } | null {
  const { w, wall, goals, boxes, player } = level;
  const size = wall.length;
  const floorAll = new Uint8Array(size);
  for (let i = 0; i < size; i++) floorAll[i] = wall[i] ? 0 : 1;
  // Live squares over the whole level: a hallway square reaches no goal, so the whole
  // hallway row is cut away and the rooms fall apart into separate parts.
  const distAll = computePushDist(w, floorAll, floorAll, goals);
  const live = new Uint8Array(size);
  for (let c = 0; c < size; c++) {
    for (let g = 0; g < goals.length; g++) {
      if (distAll[g]![c]! >= 0) {
        live[c] = 1;
        break;
      }
    }
  }
  const hallwayRow = Math.floor(player / w);
  const cut = new Uint8Array(size);
  for (let x = 0; x < w; x++) {
    const i = hallwayRow * w + x;
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(size).fill(-1);
  const rooms: DetectedRoom[] = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares: number[] = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      const p = squares[i]!;
      for (let d = 0; d < 4; d++) {
        const q = p + deltaOf(d, w);
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    squares.sort((a, b) => a - b);
    const cellSet = new Uint8Array(size);
    for (const c of squares) cellSet[c] = 1;
    rooms.push({ cells: squares, cellSet, boxes: [], goals: [], door: -1, hallAdj: -1 });
  }
  for (const b of boxes) {
    const r = part[b];
    if (r < 0) return null;
    rooms[r]!.boxes.push(b);
  }
  for (const g of goals) {
    const r = part[g];
    if (r < 0) return null;
    rooms[r]!.goals.push(g);
  }
  const kept: DetectedRoom[] = [];
  for (const r of rooms) {
    if (r.boxes.length !== r.goals.length) return null;
    if (r.boxes.length === 0) continue;
    r.boxes.sort((a, b) => a - b);
    r.goals.sort((a, b) => a - b);
    // The door: the one room square touching a hallway floor square.
    let door = -1;
    let hallAdj = -1;
    let count = 0;
    for (const s of r.cells) {
      for (const d of [-w, w]) {
        const q = s + d;
        if (Math.floor(q / w) === hallwayRow && !wall[q]) {
          count += 1;
          door = s;
          hallAdj = q;
        }
      }
    }
    if (count !== 1) return null;
    r.door = door;
    r.hallAdj = hallAdj;
    kept.push(r);
  }
  // Rooms whose door is a goal go last: a box ending on the door would shut the player in.
  const doorIsGoal = (r: DetectedRoom): number => (r.goals.includes(r.door) ? 1 : 0);
  kept.sort((a, b) => doorIsGoal(a) - doorIsGoal(b) || a.door - b.door);
  return { hallwayRow, rooms: kept };
}
