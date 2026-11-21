[![sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/abdulkemal76-tech/makefun-sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/abdulkemal76-tech/makefun-sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

# Room-decomposed push-optimal Sokoban solver

Entry for the make.fun bounty [Build the best Sokoban solver, 21 November 2026](https://make.fun/bounty/sokoban-solver-01-run-20261121).

One program (`main.ts`, Node 22) answers 5 Sokoban instances in a single run of
well under 60 seconds, deterministically (byte-identical output across runs).

## How it beats plain A*

The house baseline is a plain move-based A*. This solver is structurally
stronger — it exploits the generator's own layout instead of searching the
whole level blind:

1. **Room decomposition.** Every generated level is a 1-wide hallway with 1–4
   rooms off it (one door each), and a box pushed through a door can never be
   pushed back — so every box stays in its room and the push-optimal count P*
   is the sum of the rooms' optima. The solver detects the hallway and each
   room, solves every room independently from its door, then stitches the
   per-room push sequences into one walk along the hallway. One huge search
   becomes several small ones.
2. **Push-based search with strong deadlock detection.** Search is over pushes,
   not moves. Dead squares are precomputed per room, and corner deadlocks,
   2×2 freeze squares and wall-line deadlocks prune dead states before they
   expand.
3. **Strong heuristic.** Per-room push-distance maps (minimum pushes for one
   box to each goal, ignoring other boxes) plus an optimal box-to-goal
   assignment (min-cost matching), with a player-reachability check on every
   push.
4. **Safe fallback.** If optimal A* stalls on a room, a beam search still
   returns a valid solution — a valid longer solution scores far better than
   none. A whole-level push-A* fallback covers layouts where room detection
   fails. Node-count budgets only (never the wall clock), so output is fully
   deterministic.

## Practice-set result

Scored with the kit's own grader (`grade-local`, process driver):

| instance | pushes | P\* | points |
| -------- | ------ | --- | ------ |
| i001 | 13 | 13 | 1000 |
| i002 | 16 | 16 | 1000 |
| i003 | 29 | 29 | 1000 |
| i004 | 47 | 47 | 1000 |
| i005 | 60 | 60 | 1000 |
| **total** | | | **1,000,000** |

~0.25 s for the whole set (limit 60 s), byte-identical across two runs, and
1,000,000 on six further freshly generated 5-instance sets from the kit
generator (30 unseen instances).

## Layout

- `main.ts` — entrypoint: IO loop only
- `parse.ts` — XSB parsing
- `rooms.ts` — hallway/door detection, room flood-fill, stitching walks
- `deadlock.ts` — dead-square table, corner / 2×2 / wall-line deadlock tests
- `heuristic.ts` — push-distance maps + optimal box→goal assignment
- `search.ts` — push-based A\* (optimal) + beam fallback
- `solve.ts` — orchestration: per-room solve → stitch → whole-level fallback

## Run locally

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/<id>/solution.txt` for each instance.
