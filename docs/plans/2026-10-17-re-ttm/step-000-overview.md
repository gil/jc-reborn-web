# Reverse Engineering the TTM Interpreter (Chunk 5) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every TTM opcode handler of the original `SCRANTIC.SCR` against our engine, port the original page runner to TypeScript, prove it matches the original on every page of every TTM script, and switch the running engine from the old layer pipeline to the `src/gfx/gdi/` display model.

**Architecture:** The original runs a TTM script one *page* at a time (a page ends at opcode `0x0FF0`) and every story step re-runs each thread's current page, skipping loads and sounds on re-runs, until the page's delay is due. Every opcode draws into buffer B; dirty rects then present B to the window and copy the clean background C back over B. We port the page runner (`1058:040c`) literally into `src/ttm/page-runner.ts`, behind a `TtmDevice` interface whose methods map one to one onto the original's callees. A Unicorn harness runs the original page runner on every page with those callees replaced by recorders, and a data test compares that trace with our runner driven by a recording device. A `GdiDevice` implements the interface on the chunk 4 `Display`. Finally the scheduler, island, walk, story, and main loop switch to the display model, and the old layer pipeline is deleted. Thread lifecycle (chunk 6), story and island logic (chunk 7), and walking (chunk 8) only get the thinnest adapter needed; every bridge is logged in `docs/re/open-questions.md`.

**Tech Stack:** TypeScript + Vitest (Node 24, pnpm), Python 3.11 + `unicorn==2.1.4` in `re/.venv`, Ghidra 12.1.4 at `$GHIDRA_INSTALL_DIR` (`/Applications/ghidra`), exports in `re/out/`.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 5).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

Chunks 1 to 4 built the toolchain and checked the archive, decompression, decoders, and graphics. Read `docs/re/README.md` and `scripts/re/unicorn/README.md` once before starting. `docs/re/graphics.md` is the model for the findings file this chunk writes (`docs/re/ttm.md`), and its `Dirty rects` and `Display buffers` sections explain the three-buffer display this chunk wires in.

**User decision (2026-10-17):** this chunk wires the `src/gfx/gdi/` model into the running engine and deletes the old layer pipeline (OQ-20). Thread lifecycle stays with chunk 6; the scheduler only gets an adapter.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) and anything derived from the data files (fixtures, traces, `.bin` dumps) live only under `re/`, which is gitignored. Never commit them. Only our own notes, scripts, tests, snapshots, `names.json`, and `jump-tables.json` are committed.
- Never paste decompiled code into committed files. Findings and `names.json` notes are in our own words.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`. With `-I`, the script's own folder is not on `sys.path`; scripts meant to run directly insert `Path(__file__).resolve().parent` themselves. The unittest runner (`-m unittest discover -s scripts/re/unicorn`) puts that folder on the path for test modules.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1058:040c`) are allowed and expected on every behavior-pinning test.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. There is no other linter. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`, and the Unicorn tests must pass: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`.
- `scripts/re/names.json` keeps its entries under `"functions"`, sorted by address; `node scripts/re/function-map.mjs` rejects an unsorted file. Insert new entries in address order. After editing it, run `node scripts/re/function-map.mjs` (regenerates `docs/re/function-map.md`).
- Data tests are named `*.data.test.ts` and skip themselves when `public/data/` files (or the fixture they compare against) are missing.
- The original wins over workarounds. A difference or workaround with no root cause found stays and is logged in `docs/re/open-questions.md`.
- Scope fence: change chunk 6, 7, and 8 logic (`src/ads/`, `src/story/`, `src/island/`, `src/walk/`, `src/engine/`, `src/main.ts`) only as far as step 6 lists. Every place where step 6 makes up behavior to connect the model gets an open-questions entry with **Resolve in:** the owning chunk.

## Binary facts (first reading, 2026-10-17)

These come from reading the decompile and the case code during planning. Step 2 confirms or corrects each and writes the confirmed version as a finding. Address format `ssss:oooo`; NE segment `n` is selector `0x1000 + (n - 1) * 8`; `1068` is the auto data segment (DS). Far cdecl: first argument at `[BP+6]`, caller pops. In the case code of `1058:040c`, the instruction's word arguments live in locals: arg 0 at `[BP-4]`, arg 1 at `[BP-6]`, arg 2 at `[BP-8]`, arg 3 at `[BP-0xa]`, arg 4 at `[BP-0xc]`, arg 5 at `[BP-0xe]`, arg 6 at `[BP-0x10]`; the string argument pointer at `[BP-0x1a]`.

### Missing case code

Borland compiled each `switch` on an opcode as a linear search: `MOV CX,<count>; MOV BX,<values>; ... CMP AX,CS:[BX]; ... LOOP; ... JMP CS:[BX + 2*count]`. Ghidra cannot follow these, so the case code is missing from `re/out/` (about 2.4 KB in `1058:040c` alone). Step 1 fixes the export. The tables, as `jump address: values address, count`:

| Jump | Values | Count | Function |
| --- | --- | --- | --- |
| `1048:0354` | `1048:0383` | 35 | ADS arg counts (chunk 3) |
| `1048:10a8` | `1048:1142` | 18 | ADS (chunk 6) |
| `1048:12ab` | `1048:14bd` | 23 | ADS (chunk 6) |
| `1048:1554` | `1048:1875` | 44 | ADS (chunk 6) |
| `1058:0031` | `1058:00fc` | 18 | sound opcodes `0xCxxx` |
| `1058:0175` | `1058:03bc` | 20 | drawing opcodes `0xAxxx` |
| `1058:059b` | `1058:138d` | 4 | page-call offsets |
| `1058:0602` | `1058:1379` | 5 | island offsets |
| `1058:06a5` | `1058:12bd` | 47 | control opcodes |
| `1058:1088` | `1058:1275` | 18 | dirty rects after drawing |
| `1058:1561` | `1058:1900` | 8 | effects |

Entry `i` matches value word `values + 2i` and jumps to the offset stored at `values + 2*count + 2i`, in the same segment. 240 entries in all.

### Runtime state

- `1068:2641` = 4 in the data segment; only `1050:0152` writes it (to 2, in color mode 12, never). So every `>= 3` test passes.
- `1068:287a` = 1 in the data segment; `platform_initSaver` (`1008:143c`) sets it to 0 at the end. At runtime it is 0.
- `1068:429e` = 1 at runtime (set by `platform_initSaver`): copies into A are skipped and presents come from the copy source (B). The window is a fourth picture, painted only by presents. See `docs/re/graphics.md`, `Display buffers`.
- `1068:1ebf` = 0 always (nothing writes it). Every palette-effect branch behind it never runs.
- `1068:1ebd` (color mode) = 2 always.
- `1040:0c13`, `1040:0c21`, `1040:0c31`, `1030:07c3`, `1030:07d4` are empty functions (return a constant). The palette-effect and font-select calls do nothing.

### TTM record and thread node

- TTM record (far, `0xd4` bytes, current one at `1068:2638`): word `[0]` id, `[1]` page count, `+0x0c` six BMP slot list pointers (near), `+0x18` six font handles, `+0x24` six palette far pointers, `+0x3c` twelve zone buffer far pointers, `+0x6c` / `+0x84` / `+0x9c` / `+0xb4` twelve zone x / y / w / h words, `+0xd0` far pointer to the page table.
- Thread = tag node (near, `0x3d` bytes, list at `1068:263c`, current one at `1068:263e`): word `[0]` TTM id, `[1]` tag, `[2]` tag page, `[3]` next page (`0xFFFF` = none), `[4]` current page, `[5]` last page run, `[6]` self-goto flag, `[7]` (`+0x0e`) "page already ran" flag, `+0x10` font slot, `+0x12` palette slot, `+0x14` BMP slot, `+0x16` zone slot, `+0x1c` value of opcode `0x1031`, byte `+0x1e` foreground, byte `+0x1f` background, byte `+0x20` clip on, words `+0x21` clip x1, `+0x23` x2, `+0x25` y1, `+0x27` y2, `+0x29` delay, `+0x2b`, `+0x2d`, `+0x2f` mode, `+0x31` count, `+0x33`/`+0x35` end time, `+0x37`/`+0x39` next due time, `+0x3b` next node.
- `1048:0b3e(node)` (thread reset, chunk 6): palette, BMP, and zone slots 0, current page = tag page, next page `0xFFFF`, foreground = background = 15, `+0x1c` = 0, delay 0, due time 0, flag `[7]` = 0, mode 0, clip on, clip = `(0, 0, 639, 479)`.

### Page runner `1058:040c(page)`, called through `1050:074a(page)`

- `1050:074a`: returns 0 unless a TTM is current, `0 <= page < page count`, and the page table entry is set; else returns `1058:040c(page)`.
- At entry: `1068:46d8` (the replay flag) = thread `[7]`; `1068:4644` (goto page) = `0xFFFF`.
- Per instruction: read the opcode into `1068:46da`; arg count = low nibble; remap `0x1301` → `0xc051` and `0x1311` → `0xc061`; stop at `0x0FF0`. Set the draw target `1068:1eb8` and copy source `1068:1eb6` to B. Read up to 7 word args (stale locals keep earlier values for missing args). Arg code 15: a string (copied by `1058:141f` into `1068:464a`), except `0xaf1f`/`0xaf2f` which take a word count and that many word pairs.
- Page-call offsets: when `1068:27c2 != 0` (inside opcode `0x3003`) and the opcode is in `0xa000..0xafff`: `0xa0a4` adds `(1068:46e0, 1068:46de)` to both corners, `0xa601`/`0xaf1f`/`0xaf2f` get nothing, the rest get it on args 0 and 1.
- Island offsets: when `(1068:46e4, 1068:46e2)` is not `(0, 0)` and the opcode is in `0xa000..0xafff`, `0x4004`, or `0x4204`: `0x4004` and `0xa0a4` get it on both corners, `0xa601`/`0xaf1f`/`0xaf2f` get nothing, the rest on args 0 and 1. `1010:00fc` sets them (chunk 7).
- Dispatch: `0xCxxx` → `1058:0000` only when the replay flag is 0. `0xAxxx` → `1058:0144`. Anything else → the 47-entry table at `1058:12bd`; an opcode not in it and in `0xf10f..0xf19f` copies its string into text buffer `(opcode - 0xf10f) >> 4` (table of 9 near pointers at `1068:2622`) and clears the later buffers' first bytes.
- After an `0xAxxx` opcode: the 18-entry table at `1058:1275` computes the dirty rect; opcodes not in it use `(x, y, w + 8, h + 2)` (args 0..3). Each rect goes to `1050:0a85`.
- `1050:0a85(x, y, w, h)` with `287a == 0`: kind-1 dirty rects `(B → A, age 0)`, `(B → A, age 1)`, then `(C → B, age 0)` unless `1068:27c0 != 0`.
- After the page: when `1068:4640` is set (a screen was loaded), clip off for the call, kind-1 dirty `(0, 0, 640, 480)` `(B → A, age 0)`, clip back, `4640 = 0`. Returns 1.

### Opcodes

Data uses come from `docs/re/decoders.md`, `TTM opcode coverage`. "Skips on replay" means the handler does nothing when `1068:46d8` (thread flag `[7]`) is set.

| Opcode | Handler | Uses | Effect |
| --- | --- | --- | --- |
| `0x0010` | `1058:0a78` | 0 | skips on replay; return-0 stub `1028:188e(0, 0, 640, 480, 1068:46ae)` |
| `0x0020` | `1058:0e40` | 0 | skips on replay; `1050:0b31` (screen to background) |
| `0x0070` | `1058:09f1` | 0 | skips on replay; frees the thread's palette slot, clears the pending palette when it is that one |
| `0x0080` | `1058:0806` | 190 | skips on replay; frees the images of the thread's BMP slot (not the shared walk list `1068:30d2`) and clears the slot |
| `0x0090` | `1058:091d` | 0 | skips on replay; deletes the thread's font (empty stub `1030:07d4`) |
| `0x00c0` | `1058:086d` | 0 | skips on replay; frees zone buffer [thread zone slot] |
| `0x00e0` | `1058:072b` | 0 | skips on replay; frees the BMP matrix if any |
| `0x0110` | `1058:0f73` | 528 | purge flag `1068:4642 = 1` |
| `0x0400` | `1058:0dc7` | 0 | skips on replay; only with `1ebf`: palette reset (stubs) |
| `0x0500` | `1058:0fd2` | 0 | `1068:27c0 = 1` (no `C → B` restore for later drawings) |
| `0x0510` | `1058:0fda` | 0 | `1068:27c0 = 0` |
| `0x0ff0` | loop end | 6,631 | ends the page |
| `0x1011` | `1058:0aa0` | 0 | return-0 stub `1028:18ae(arg0)` |
| `0x1021` | `1058:0e37` | 1,148 | delay `1068:46e6 = arg0` (no minimum; 93 uses pass 0) |
| `0x1031` | `1058:074f` | 0 | thread `+0x1c = arg0` |
| `0x1041` | `1058:0a6f` | 0 | `1068:46ae = arg0` |
| `0x1051` | `1058:075c` | 456 | thread BMP slot `+0x14 = arg0` |
| `0x1061` | `1058:0952` | 41 | thread palette slot `+0x12 = arg0`; unless replay, pending palette `1068:4646` = TTM palette [arg0] (selected at once only in color mode 4, never) |
| `0x1071` | `1058:08c3` | 0 | thread font slot `+0x10 = arg0`; select font (empty stub) |
| `0x1101`, `0x1111` | `1058:1056` | 5, 611 | nothing (tags are only read by `1058:13a9` and the loader) |
| `0x1121` | `1058:0853` | 61 | thread zone slot `+0x16 = arg0` |
| `0x1201` | `1058:0fc3` | 75 | goto: `1068:4644 = 1058:13a9(arg0)` |
| `0x1301`, `0x1311` | remapped | 0 | to `0xc051`, `0xc061` |
| `0x2002` | `1058:06a9` | 217 | foreground = low byte of arg0 (thread `+0x1e`, `1068:1eae`, text color `1068:1ea0`); background = low byte of arg1 (thread `+0x1f`, `1068:1ead`). No `& 0x0f`: one use passes 207 (`0xcf`), a dither brush |
| `0x2012` | `1058:0f23` | 52 | unless replay, `1068:46d6 = 1` (the next image load builds pre-mirrored copies); calls the empty `1058:197c` |
| `0x2022` | `1058:0e08` | 152 | skips on replay; delay = `arg0 + abs(int16(rand % (uint16)(arg1 - arg0)))`, `rand` from `1018:1e60`; unsigned `DIV`, so `arg1 == arg0` would fault (no data case) |
| `0x2032` | `1058:0706` | 0 | skips on replay; scrolls the BMP matrix (`1040:1183`) |
| `0x2302`, `0x2312`, `0x2322` | `1058:0d04` | 0 | only with `1ebf`: stores a color range |
| `0x2402` | `1058:0d36` | 0 | skips on replay; only with `1ebf`: palette cycling (stubs) |
| `0x3003` | `1058:0f7f` | 0 | page call: `27c2++`, offsets `46e0 = arg0`, `46de = arg1`, runs `1058:040c(1058:13a9(arg2))`, cancels a purge raised inside the call, `27c2--` |
| `0x3103` | `1058:0eff` | 0 | skips on replay; `1050:0a85(0, 0, 640, 480)` |
| `0x4004` | `1058:0f40` | 52 | clip: thread and globals `x1 = arg0`, `y1 = arg1`, `x2 = arg2`, `y2 = arg3` (inclusive), clip on |
| `0x4114` | `1058:0aac` | 0 | skips on replay; copies B to A and B to C (whole screen), target B, selects the pending palette |
| `0x4124` | `1058:0ba4` | 0 | skips on replay; selects the pending palette, copies B to A (whole screen), target B |
| `0x4136` | `1058:0c8c` | 0 | only with `1ebf`: timed palette fade (`1058:1be1`, `1ad0`, `1b1f`) |
| `0x4204` | `1058:0e55` | 38 | skips on replay; `1050:0b74(x, y, w, h)` copies B into C; then kind-1 dirty `(x, y, w, h)` `(B → A, age 0)` |
| `0x4214` | `1058:0860` | 60 | nothing |
| `0x5005` | `1058:1056` | 0 | nothing |
| `0xb000` | `1058:0fe2` | 0 | skips on replay; `1050:0000` |
| `0xb013` | `1058:0ff2` | 0 | `1050:0061(arg0, arg1, arg2)` |
| `0xb606` | `1058:0eb4` | 6 | skips on replay; source = surface(arg4), target = surface(arg5) (`1058:14e0`: 0 A, 1 B, 2 C, other B), `1038:06ce(x, y, w, h)`, then source A, target B. All 6 uses copy C to B |
| `0xf01f` | `1058:06c5` | 40 | skips on replay; `1028:1813(name)` (screen drawn on target B), then `1050:0b31` |
| `0xf02f` | `1058:0769` | 263 | skips on replay; frees the slot's images; name `JOHNWALK.BMP` (`1068:27d2`, `rtl_stricmp`) → slot = shared walk list `1068:30d2`; else `1068:4106 = 46d6`, slot = `1028:17fa(name)`; then `46d6 = 4106 = 0` |
| `0xf04f` | `1058:08e1` | 0 | skips on replay; loads `WILLY.FON` (`1030:0765`) into the font slot |
| `0xf05f` | `1058:0995` | 41 | skips on replay; frees the thread's palette slot, loads (`1040:09eb`), stores it, pending palette = it |
| `0xf08f` | `1058:06de` | 0 | skips on replay; loads a BMP matrix |
| `0xf10f`..`0xf19f` | after the table | 0 | text buffer strings |
| `0xc051` | `1058:0063` | 535 | `audio_playSound(arg0)` (only when not replay) |
| `0xc061` and the other `0xCxxx` | `1058:00fc` table | 0 | return-0 stubs, or string copies into `1068:46bd`/`46b0` |
| `0xa002` | `1058:022c` | 63 | `1040:0d54(x, y, int8(foreground))`; dirty `(x, y, 8, 1)` |
| `0xa0a4` | `1058:0179` | 784 | `1030:02ef(x1, y1, x2, y2)`; dirty `(min x, min y, abs(dx) + 8, abs(dy) + 2)` |
| `0xa104` | `1058:01a9` | 111 | fill on, `1038:1bd8(x, y, w, h)`; dirty default |
| `0xa114` | `1058:018c` | 0 | fill off, rect, fill on; dirty default |
| `0xa404` | `1058:01c4` | 437 | fill on, `r = int16(arg3) >> 1`, `1040:0688(r, x + r, y + r)`, fill on; dirty `(x - 20, y, w + 48, h + 1)`. Arg 2 (width) is ignored; every use has width = height |
| `0xa424` | `1058:01bd` | 0 | the same with fill off |
| `0xa504`, `0xa514`, `0xa524`, `0xa534` | `1058:025b` | 12,546 / 0 / 2,822 / 0 | flags = bits 4..7 of the opcode (1 flip, 2 mirror); image = BMP list [arg3][arg2]; `1028:17d8(image, x, y, flags)`; dirty `(x, y, abs(width), height + 2)` (nothing when the list, the image, or the width is 0) |
| `0xa506`, `0xa516`, `0xa526`, `0xa536` | `1058:025b` | 0 | stretched: `1030:03d7(image, x, y, flags, arg4, arg5)`; dirty `(x, y, arg4, arg5)` |
| `0xa5a7` | `1058:025b` | 0 | draws nothing; dirty `(x, y, arg4 - x, arg5 - y)` |
| `0xa601` | `1058:02d8` | 6,814 | draws nothing; dirty = zone rect [arg0] when zone buffer [arg0] exists. Not a screen clear |
| `0xa704` | `1058:023e` | 0 | BMP matrix blit; dirty `(x, y, w, h)` |
| `0xaf02` | `1058:02e5` | 0 | return-0 stub `1028:195e(x, y, background)`; no dirty |
| `0xaf1f`, `0xaf2f` | `1058:01f8`, `01ff` | 0 | return-0 stub `1028:187e` (fill off / on); dirty whole screen |
| `0xa014`..`0xa094`, `0xa0b5` | `1058:1510` | `0xa054`: 1, `0xa064`: 1, rest 0 | effects (only when not replay, `w > 0`, `h > 0`, `x + w <= 640`, `y + h <= 480`), run with target A; dirty default. `0xa054`: zone 0 rect = `(x, y, w, h)`, saves that rect of the source (B) with `1030:01c4`. `0xa064`: target B, restores zone 0's buffer at zone 0's rect with `1030:0250`. Others: wipes and slides from B to A (`1058:1949`, `1058:1920`), `0xa0b5` → `1058:198a` (a plain copy while `1ebf` is 0) |
| `0xa204`..`0xa294` | `1058:0144` | 0 | text: font select (stub), back mode 1, `1030:04ce(text buffer n, x, y)`, back mode 0 |

`1058:13a9(tag)`: the first page whose *first* instruction is `0x1101` or `0x1111` with that tag; `0xFFFF` when none.

### ADS side, read for the interface (chunk 6 owns it)

- `1048:1acb` (ADS tick), per thread that is due to run: makes its TTM current; loads text color/foreground, background, and clip (on and rect) from the node into the globals; `4642 = 0`; `46e6 = 0xFFFF`; runs `1050:074a(node[4])`. If it ran: `[7] = 1`, `[5] = [4]`; when `46e6 != 0xFFFF` and differs from the node's delay, the delay becomes `46e6` and the next due time `now + delay`. No purge: a goto sets `[3]`; then `1048:196e`. Purge: `[3] = [2]` (back to the tag page), then mode-dependent. After all threads: `1050:0799` (makes the pending palette active), clip on, clip = whole screen.
- `1048:196e(node)`: when the delay is non-zero and the due time has not come, nothing. Otherwise the due time becomes `now + delay`, `[7] = 0`, and the page advances: `[4] = [3]` and `[3] = 0xFFFF` when `[3]` is set, else `[4] += 1`.
- So a thread's page is re-run (with flag `[7]` set) on every ADS tick until its delay is due. That redraw is what keeps sprites on screen while the restore pass keeps erasing B from C.
- `1018:06bf` (one story step, chunk 7): `1010:040e(0)` (waves and island bits on B), ..., `1048:1acb` (ADS tick), `1048:0766`, `1010:1e50(0)` (redraws the holiday sprite when its rect overlaps a `(B → A, age 0)` dirty rect), sound 25 when due, `1060:03d3(0)` (restore pass).

### Data facts used by the plan

- Every TTM page ends with `0x0FF0` (`src/decode/ttm-loader.data.test.ts`, `finds every page PAG: announces`).
- `0xa601` args are 0, 1, or 2. `0x1121` args 0..2. `0x1051` args 0..5. `0x1061` arg 0. Sprite slot args 0..5.
- `0xa054` and `0xa064` are each used once, with `(194, 123, 175, 142)`.
- `JOHNWALK.BMP` is loaded 40 times by TTM scripts.
- `0x2022` arg pairs never have `arg0 == arg1`.

## Trace format (steps 3 and 4)

Step 3 writes `re/fixtures/ttm/traces.tsv` from the original; step 4 builds the same rows from our runner. Header: `ttm	page	pass	event	values`. `pass` is `first` or `replay`. `values` is the remaining values joined with one space. Surfaces are written as numbers: A = 0, B = 1, C = 2 (`SURFACE_A`, `SURFACE_B`, `SURFACE_C` in `src/gfx/gdi/display.ts`). `clip` is five values: clip on (0/1), x1, y1, x2, y2 (`1068:1ea3`, `1ea4`, `1ea8`, `1ea6`, `1eaa`). Coordinates are signed 16-bit.

| Event | Values | Original callee |
| --- | --- | --- |
| `pixel` | target x y color clip | `1040:0d54` (color as passed, signed) |
| `line` | target x1 y1 x2 y2 foreground clip | `1030:02ef` |
| `rect` | target x y w h fill foreground background clip | `1038:1bd8` |
| `circle` | target r cx cy fill foreground background clip | `1040:0688` |
| `sprite` | target bitmapName imageIndex x y flags clip | `1028:17d8` |
| `stretch` | target bitmapName imageIndex x y flags w h clip | `1030:03d7` |
| `copy` | source target x y w h | `1038:06ce` |
| `dirty` | source target age x y w h clip | `1060:007e` (kind 1 only) |
| `drop` | source target age | `1060:06ac` |
| `save` | source x y w h | `1030:01c4` |
| `restore` | target x y w h | `1030:0250` |
| `screen` | target name | `1028:1813` |
| `bitmaps` | name mirroredCopy | `1028:17fa` (`mirroredCopy` = `1068:4106`) |
| `palette` | name | `1040:09eb` |
| `sound` | sample | `1020:00ba` |
| `random` | (none) | `1018:1e60` |
| `selectPalette` | name | `1040:0b08` (no TTM script should reach it; our recorder never writes it, so a row means a difference) |
| `result` | ran delay goto purge pendingPalette mirrorNextLoad keepDrawings | after each run: return value, `46e6`, `4644` (both signed, `-1` = none), `4642`, name of the palette at `4646` or `-`, `46d6`, `27c0` |
| `thread` | foreground background clipOn x1 y1 x2 y2 bmpSlot paletteSlot zoneSlot | after each run, from the node |

foreground, background, and fill are unsigned bytes. `bitmapName` and palette names are upper case; `screen`, `bitmaps`, and `palette` rows carry the name exactly as the bytecode spells it. The fake random source returns `(call * 25173 + 13849) & 0xffff` for the zero-based call count within one TTM. Run setup: TTM id 1, island offsets `46e4 = 7`, `46e2 = 5`, fill `1eac = 1`, everything else as at runtime (`2641 = 4`, `287a = 0`, `27c0 = 0`, `27c2 = 0`, `1ebf = 0`, `1ebd = 2`, screen 640 × 480). One thread node reset by `1048:0b3e`. Pages run in order `0..n-1`, each once with flag `[7] = 0` (`first`) then once with `[7] = 1` (`replay`). Before each run, the globals are loaded from the node as `1048:1acb` does.

## Shared pieces

Made by earlier chunks (exist now):

- TypeScript: `src/types.ts` (`SCREEN_W = 640`, `SCREEN_H = 480`, `TRANSPARENT = 0xff`, `Sprite { width; height; indexed }`, `Palette` = 16 × RGBA `Uint8Array`, and the old `Layer`, `Rect`), `src/decode/ttm-loader.ts` (`decodeTtm(payload): TtmResource { pageCount; bytecode; pageOffsets: number[]; tags: { id; page }[] }`), `src/decode/ttm-bytecode.ts` (`readTtmInstruction(bytecode, offset): { offset; opcode; args: number[] (unsigned words); text?: string; next }`), `src/decode/bmp.ts` (`decodeBmp(payload).sprites: Sprite[]`), `src/decode/scr.ts` (`decodeScr(payload): { width; height; indexed }`), `src/decode/pal.ts` (`decodePal(payload).colors`: 48 bytes RGB), `src/gfx/palette.ts` (`makePalette()`, `setPaletteColors(palette, colors)`), `src/testing/corpus.ts` (`hasCorpus`, `hasFixture(path)`, `readFixtureRows(path)`, `loadArchive()` → `ParsedArchive { byName: Map<string, { name; type; payload }>; list }`).
- Graphics model (`src/gfx/gdi/`): `surface.ts` (`Surface { width; height; pixels }`, `ClipRect { x1; y1; x2; y2 }` inclusive, `DrawState { foreground; background; fill; clipOn; clip }`, `makeSurface()`, `makeDrawState()` (fill on, clip off, whole screen), `rawIndices(indexed)`), `primitives.ts` (`setPixel(surface, state, x, y, color)`, `drawLine(surface, state, x1, y1, x2, y2)`, `drawRect(surface, state, x, y, w, h)`, `drawCircle(surface, state, r, cx, cy)`), `sprite.ts` (`FLIP_VERTICAL = 1`, `MIRROR = 2`, `spriteSurface(sprite)`, `drawSprite(surface, state, image, x, y, flags = 0, hasMirroredCopy = false)`, `drawSpriteStretched(surface, state, image, x, y, flags, w, h)`), `dirty.ts` (`COPY_RECT = 1`, `DirtyLists` with `add(x, y, w, h, kind, source, target, age, clip: ClipRect | null, saved = 0)`, `overlaps(x, y, w, h, target, age)`, `drop(source, target, age)`, `snapshot()`), `display.ts` (`SURFACE_A = 0`, `SURFACE_B = 1`, `SURFACE_C = 2`, `class Display` with `surfaces`, `dirty`, `source`, `target`, `screenIsB`, `shown()`, `copyRect`, `saveRect(id, ...)`, `restoreRect(id, ...)`, `blitScreen(image, x, y)`, `restorePass(which)`).
- Python (`scripts/re/unicorn/`): `emulator.py` (`Emulator(image)`, `call_far(address, stack_words=[...])` (push order: pass cdecl args reversed), `replace_function(address, handler)`, `arg(i)`, `near_alloc`, `read`, `write`, `data_segment`), `ne_image.py`, `corpus.py` (`load_resources(data_dir) -> list[Resource(name, offset, payload)]`, `walk_chunks(payload) -> list[Chunk(path, body_offset, size, container)]`), `original_loaders.py` (`new_loader_emulator(image, payloads)`, `put_string`, `c_string`, `read_word`, `LOAD_TTM = "1050:0177"`, `INDEX_TTM_PAGES = "1050:04d6"`, `CURRENT_TTM = 0x2638`, `TTM_GLOBALS = 0x2634`, `TTM_GLOBALS_SIZE = 12`), `original_graphics.py` (`set_byte`, `set_word`, `signed`, `DC_A, DC_B, DC_C = 0xA1, 0xB2, 0xC3`, `DC_GLOBALS`, `SOURCE_DC = 0x1EB6`, `TARGET_DC = 0x1EB8`, `CLIP_ON = 0x1EA3`, `CLIP_X1 = 0x1EA4`, `CLIP_X2 = 0x1EA6`, `CLIP_Y1 = 0x1EA8`, `CLIP_Y2 = 0x1EAA`, `SCREEN_WIDTH = 0x2562`, `SCREEN_HEIGHT = 0x2564`, `COLOR_MODE = 0x1EBD`, `RECORD_SIZE = 14`, `RECORD_WIDTH = 6`, `RECORD_HEIGHT = 8`).

Made in this chunk (each step's Interfaces block has the exact signatures):

- `scripts/re/jump-tables.json`, `scripts/re/ghidra/ApplyJumpTables.java`, `re/out/jump-tables.tsv` (step 1).
- `docs/re/ttm.md` (step 2 creates, steps 3 to 7 extend). Sections, in this order: `Page runner`, `Arguments and offsets`, `Thread and record state`, `Opcodes`, `Drawing and dirty rects`, `Resources`, `Palettes`, `Zones and effects`, `Delays`, `Text and fonts`, `Stubs and dead branches`, `Unloading`, `ADS side`, `Emulated`, `Past fixes reviewed` (step 7), `Side-by-side checklist`. One claim per bullet, each starting with its address. Checklist rows: `| Original | Name | Ours | Status |`, status `match`, `fixed`, or `open` (every `open` row has an entry in `docs/re/open-questions.md`). Functions with no TypeScript counterpart write `none (reason)` and count as `match` when the finding explains why nothing is needed.
- `scripts/re/unicorn/original_ttm.py`, `dump_ttm.py`, `test_original_ttm.py`, fixture `re/fixtures/ttm/traces.tsv` (step 3).
- `src/ttm/opcodes.ts` (renamed keys), `src/ttm/state.ts`, `src/ttm/device.ts`, `src/ttm/page-runner.ts`, `src/testing/ttm-recorder.ts` (step 4).
- `Display.window` and presenting in `src/gfx/gdi/display.ts`, `src/ttm/gdi-device.ts` (step 5).
- `src/gfx/present.ts`, the engine switch, and the deletion of the old pipeline (step 6).

## Open-question numbers

The last existing entry is OQ-21. New entries use these numbers so steps agree:

- OQ-22: thread start delay 0 and the one-tick floor in the scheduler adapter (step 6, chunk 6).
- OQ-23: page-runner guards where the original reads garbage or faults (step 4, by choice).
- OQ-24: island drawing bridge (step 6, chunk 7).
- OQ-25: walk drawing bridge (step 6, chunk 8).
- OQ-26: the random source for `0x2022` is `Math.random`, not `1018:1e60` with its seed (step 6, chunk 7).
- OQ-27: opcodes the data never uses and that the port leaves out (step 2, by choice).
- OQ-28: engine tick order versus `1018:06bf` (step 6, chunk 7).

## Function scope of this chunk

Every function below must end `verified` in `docs/re/function-map.md` or be listed in `docs/re/open-questions.md`:

- `1050:0000 0061 0152 074a 0799 07c6 080c 0a6e 0a85 0b31 0b74`
- `1058:0000 0144 040c 13a9 141f 147a 14a8 14e0 1510 1920 1949 197c 198a 1ad0 1b1f 1be1 1c06`
- Empty stubs reached from TTM code: `1030:07c3 1030:07d4 1040:0c13 1040:0c21 1040:0c31`
- Text: `1030:04ee 1030:04ce 1030:0765` (OQ-16)

Read for the interface, named but not verified here: `1048:0b3e 196e 1acb 1e5a` (chunk 6), `1010:00fc` and `1018:1e60` (chunk 7).

## Steps

- [x] `step-001-jump-tables-in-export.md`: the Ghidra export includes every switch case; every chunk 5 function named.
- [x] `step-002-ttm-findings.md`: `docs/re/ttm.md` with every opcode handler confirmed against the export; OQ-14, OQ-16, OQ-19, OQ-27 settled.
- [x] `step-003-original-page-trace.md`: Unicorn runs the original page runner on every page of every TTM and writes `re/fixtures/ttm/traces.tsv`.
- [x] `step-004-page-runner.md`: `src/ttm/page-runner.ts` and friends, pinned by unit tests and equal to the original trace on the whole corpus.
- [x] `step-005-display-window-and-gdi-device.md`: the `Display` gets a window surface painted by presents (OQ-17); `GdiDevice` runs the page runner on the model; OQ-8 settled.
- [x] `step-006-wire-engine.md`: scheduler adapter, island, walk, story, and main switch to the model; old pipeline deleted (OQ-9, OQ-10, OQ-20).
- [x] `step-007-chunk-wrap-up.md`: every in-scope function `verified` or logged, past fixes reviewed, comment audit, full rebuild and test run, browser check, spec checkbox ticked.

Order: run the steps one at a time, in number order. Step 2 needs step 1's export. Step 3 needs step 1 (names in Ghidra are optional, the harness uses addresses) and the trace format above. Step 4 needs step 3's fixture for its data test (its unit tests do not). Step 5 needs step 4 (`TtmDevice`, `Bitmaps`). Step 6 needs steps 4 and 5. Step 7 needs all of them. Steps 2 to 7 all extend `docs/re/ttm.md` and `docs/re/open-questions.md`.

## Leftovers Protocol

Finishing your step completely is the goal. `step-999-leftovers.md` is a
last resort for work that genuinely cannot happen in your session (a missing
credential, an upstream bug, a discovery that changes scope). It is not a
place to park work that is hard, boring, or long.

If you must defer something, append an entry to `step-999-leftovers.md` in
this directory (create the file if it doesn't exist):

### [step file] - [short title]

- **What:** the undone work, specific enough to act on without your
  session's context
- **Why deferred:** the concrete blocker
- **Where:** files and tests involved
- **Done when:** how to verify it's resolved

Write down everything you defer. If it's not done and not in leftovers,
it's lost.
