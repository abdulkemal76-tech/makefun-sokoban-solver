// main.ts — entrypoint: read every level in /input, solve it, write /output/<id>/solution.txt.
// Run as `node main.ts` on Node 22 (erasable TypeScript only). One run answers the whole set;
// a level that fails to solve still gets a (valid, empty) answer file, so one bad instance
// never takes the others down with it.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { solveLevel } from './solve.ts';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

for (const id of readdirSync(I).sort()) {
  try {
    const text = readFileSync(join(I, id, 'level.txt'), 'utf8');
    const result = solveLevel(text);
    mkdirSync(join(O, id), { recursive: true });
    writeFileSync(join(O, id, 'solution.txt'), `${result.moves}\n`);
    console.error(
      `${id}: method=${result.method} pushes=${result.pushes} rooms=[${result.roomPushes.join(',')}] moves=${result.moves.length}`,
    );
  } catch (err) {
    // A level that fails outright still gets a (valid, empty) answer file.
    mkdirSync(join(O, id), { recursive: true });
    writeFileSync(join(O, id, 'solution.txt'), '\n');
    console.error(`${id}: ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
}
