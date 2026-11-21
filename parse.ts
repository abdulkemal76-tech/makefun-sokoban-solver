// parse.ts — XSB level parsing: walls, goals, boxes and the player, on one grid.
// The board is indexed row-major (i = y * w + x); short rows and the outer frame count as walls,
// matching the checker's replay (a step off the board is a step into a wall).
export interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** The four steps: dx, dy, walk letter, push letter, in fixed u, d, l, r order. */
export const DIRS: { dx: number; dy: number; letter: string; push: string }[] = [
  { dx: 0, dy: -1, letter: 'u', push: 'U' },
  { dx: 0, dy: 1, letter: 'd', push: 'D' },
  { dx: -1, dy: 0, letter: 'l', push: 'L' },
  { dx: 1, dy: 0, letter: 'r', push: 'R' },
];

/** Grid offset of direction `dir` on a board `w` wide. */
export function deltaOf(dir: number, w: number): number {
  return DIRS[dir]!.dy * w + DIRS[dir]!.dx;
}

export function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const size = w * h;
  const wall = new Uint8Array(size).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // A square on the outermost frame is a wall whatever it shows: nothing leaves the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  goals.sort((a, b) => a - b);
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}
