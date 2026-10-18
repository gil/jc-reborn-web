# TTM Interpreter

How the original runs TTM scripts: pages, opcodes, what each draws where, and which state it keeps. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 5. One claim per address. Our own words; no decompiled code. Data counts come from the 41 TTM scripts (`docs/re/decoders.md`, `TTM opcode coverage`) unless a bullet says otherwise.

## Page runner

- A page is the code between two `0x0FF0` instructions (the first page starts at the bytecode start). The loader records where each page starts (`1050:04d6`, `docs/re/decoders.md`, `TTM loader`).
- `1050:074a`: far cdecl `(page)`. Returns 0 when no TTM record is current (`1068:2638`), when `page < 0` or `page >= ` the record's page count (word `[1]`, signed compare), or when the page's table entry is null. Otherwise returns `1058:040c(page)`.
- `1058:040c`: far cdecl `(page)`. Returns 0 when no TTM record is current. It does not check the page against the count: it reads entry `page` of the page table (record `+0xd0`) whatever it holds.
- `1058:040c`: the runner keeps no instruction pointer between calls. Every call starts at the page's table entry and runs to the page's `0x0FF0`.
- `1058:040c`: at entry it copies the current thread node's word `[7]` (`+0x0e`, "page already ran") into the replay flag `1068:46d8`, and sets the goto page `1068:4644` to `0xFFFF`.
- `1058:040c`: per instruction it stores the opcode word in `1068:46da` and takes the arg code from its low nibble, before any remap.
- `1058:040c`: remaps opcode `0x1301` to `0xc051` and `0x1311` to `0xc061`. Both have arg code 1, so the arg count does not change.
- `1058:040c`: stops at opcode `0x0FF0` and jumps to the end-of-page block. This test comes before anything else is done for the instruction.
- `1058:040c`: for every other instruction it sets both the draw target `1068:1eb8` and the copy source `1068:1eb6` to B (`1068:1eb2`) before reading the args.
- `1058:040c`: dispatch order: opcodes `0xCxxx` go to `1058:0000` with `(arg0, arg1, arg2, arg3, string)`, skipped when the replay flag is set; opcodes `0xAxxx` go to `1058:0144` with `(arg0, ..., arg6, string)` on every run; anything else is looked up in the 47-entry table at `1058:12bd` (cases in `re/out/jump-tables.tsv`, jump `1058:06a5`). The return values of `1058:0000` and `1058:0144` are ignored.
- `1058:1005`: an opcode not in the 47-entry table and in `0xf10f..0xf19f` copies its string (`rtl_strcpy`, `1000:195a`) into text buffer `(opcode - 0xf10f) >> 4` and writes a 0 into the first byte of every later buffer up to index 8. Any other unknown opcode does nothing.
- `1058:1056`: after every instruction, when the opcode in `1068:46da` is in `0xa000..0xafff`, the runner marks a dirty rect (see Drawing and dirty rects), on first runs and replays alike.
- `1058:1212`: at the page end, when `1068:4640` is set (a screen was loaded, `1050:0b31`) and `1068:2641 >= 3`: it saves the clip-on byte `1068:1ea3`, clears it, adds a kind-1 dirty rect `(0, 0, 640, 480)` from B (or C when `1068:287a` is set) to A at age 0 with `1060:007e`, and restores the clip byte. Then it clears `1068:4640`, also when `2641 < 3`.
- `1058:1269`: returns 1 after a page end.

## Arguments and offsets

- `1058:040c`: the instruction's words go into locals: arg 0 at `[BP-4]`, arg 1 at `[BP-6]`, arg 2 at `[BP-8]`, arg 3 at `[BP-0xa]`, arg 4 at `[BP-0xc]`, arg 5 at `[BP-0xe]`, arg 6 at `[BP-0x10]`; the string pointer at `[BP-0x1a]` (0 when the instruction has no string).
- `1058:049b`: arg codes 2..7 jump through the 6-entry table at `1058:139d` and read args `count - 1` down to 1; every arg code then reads arg 0. Arg codes 0, 1, and 8..15 read arg 0 only.
- `1058:04e9`: arg 0 is always read, even for an instruction with no args: it then holds the next instruction's opcode word, and for a string instruction the string's first two bytes. Only the pointer advance follows the arg code.
- `1058:040c`: args the instruction does not have keep the values of earlier instructions of the same call (the locals are not cleared). At the start of each call they hold whatever the stack held.
- `1058:040c`: some handlers write into the locals: `0x0070` and `0xf05f` put the thread's palette slot in arg 0, `0xa5a7` subtracts arg 0 from arg 4 and arg 1 from arg 5 (`1058:108c`), and both offset passes add into them. No opcode the data uses relies on a stale or rewritten value: each reads only args it has.
- `1058:04f2`: arg code 15 is a string: `1058:141f(0, pointer)` copies it up to its NUL into `1068:464a`, and `1050:04a8` moves the pointer past the padded field.
- `1058:04f8`: `0xaf1f` and `0xaf2f` instead take a word count `n` (arg 0): `1058:141f(4n, pointer + 2)` copies `4n` bytes of word pairs, and the pointer moves `4n + 2` bytes.
- `1058:141f`: far cdecl `(n, far source)`. With `n == 0` it copies up to the NUL; otherwise `n` bytes. When `n >= 1068:2564` (the screen height, 480, signed compare) it copies nothing. It always ends the copy with a 0 and returns `1068:464a`.
- `1058:0569`: page-call offsets: when `1068:27c2 != 0` (inside opcode `0x3003`) and the opcode is in `0xa000..0xafff`, it looks the opcode up in the 4-entry table at `1058:138d`: `0xa0a4` adds `1068:46e0` to args 0 and 2 and `1068:46de` to args 1 and 3; `0xa601`, `0xaf1f`, `0xaf2f` get nothing; every other `0xAxxx` opcode adds `46e0` to arg 0 and `46de` to arg 1.
- `1058:05b9`: island offsets: when `1068:46e4` or `1068:46e2` is not 0 and the opcode is in `0xa000..0xafff` or is `0x4004` or `0x4204`, it looks the opcode up in the 5-entry table at `1058:1379`: `0x4004` and `0xa0a4` add `46e4` to args 0 and 2 and `46e2` to args 1 and 3; `0xa601`, `0xaf1f`, `0xaf2f` get nothing; every other opcode of the set adds `46e4` to arg 0 and `46e2` to arg 1.
- `1058:05b9`: the island pass runs after the page-call pass, so inside a page call both offsets add up.
- `1058:05b9`: `0x4204` gets the island offset on its x and y but not on its width and height (args 2 and 3 are sizes).
- `1010:00fc`: sets the island offset (chunk 7 owns it): `46e4` = island x `1068:30c4` + 1 (+ `0x111` when its argument is set), `46e2` = island y `1068:30c2`; both 0 when `1068:30b2` is 2.

## Thread and record state

- TTM record (far, `0xd4` bytes, current one at `1068:2638`, allocated by `1050:0177`): word `[0]` id, `[1]` page count, `+0x04` far bytecode pointer, `+0x0c` six near BMP slot list pointers, `+0x18` six font handles, `+0x24` six far palette pointers, `+0x3c` twelve far zone buffer pointers, `+0x6c` / `+0x84` / `+0x9c` / `+0xb4` twelve zone x / y / w / h words, `+0xcc` far next record, `+0xd0` far page table.
- Thread node (near, `0x3d` bytes, allocated by `1050:042a`, list at `1068:263c`, current one at `1068:263e`): word `[0]` TTM id, `[1]` tag, `[2]` tag page, `[3]` next page (`0xFFFF` = none), `[4]` current page, `[5]` last page run, `[6]` self-goto flag, `[7]` (`+0x0e`) page already ran.
- Thread node, the bytes TTM code reads or writes: `+0x10` font slot, `+0x12` palette slot, `+0x14` BMP slot, `+0x16` zone slot, `+0x1c` the value of opcode `0x1031`, byte `+0x1e` foreground, byte `+0x1f` background, byte `+0x20` clip on, words `+0x21` clip x1, `+0x23` x2, `+0x25` y1, `+0x27` y2 (inclusive).
- Thread node, the words the ADS side keeps (chunk 6): `+0x29` delay, `+0x2b` state, `+0x2d`, `+0x2f` mode, `+0x31` count, `+0x33`/`+0x35` end time, `+0x37`/`+0x39` next due time, `+0x3b` next node.
- `1048:0b3e`: far cdecl `(node)`. Does nothing for a null node. Sets the palette, BMP, and zone slots to 0 (not the font slot), current page `[4]` = tag page `[2]`, next page `[3]` = `0xFFFF`, foreground and background = 15, `+0x1c` = 0, delay 0, due time 0, `+0x31`, `+0x2d`, `+0x2b`, mode `+0x2f`, `[6]`, and `[7]` = 0, clip on, clip `(0, 0, width - 1, height - 1)`. It does not touch `[5]`.
- `1058:147a`: returns a pointer to the current record's font handle for the thread's font slot (`record + 0x18 + 2 × slot`).
- `1068:2641`: 4 in the data segment. Only `1050:0152` writes it, setting 2 when the color mode `1068:1ebd` is 12, which never happens (the mode is always 2, `docs/re/graphics.md`, `Surfaces and clip`). So every `2641 >= 3` test passes.
- `1068:287a`: 1 in the data segment; `platform_initSaver` (`1008:1551`) sets it to 0, and nothing else writes it. At runtime it is 0.
- `1068:429e`: set to 1 by `platform_initSaver` (`1008:14ab`): copies into A are skipped and presents come from B (`docs/re/graphics.md`, `Display buffers`).
- `1068:1ebf`: 0 in the data segment and nothing writes it. Every branch that tests it (the palette effects below, `1058:198a`, `1030:16d8`, `1030:124a`) never runs its non-zero side.
- `1068:1ebd`: the color mode, always 2 (`docs/re/graphics.md`).

## Opcodes

"Skips on replay" means the handler does nothing when the replay flag `1068:46d8` is set. Uses come from `docs/re/decoders.md`, `TTM opcode coverage`.

| Opcode | Handler | Uses in the data | Effect |
| --- | --- | --- | --- |
| `0x0010` | `1058:0a78` | 0 | skips on replay; return-0 stub `1028:188e(0, 0, 640, 480, 1068:46ae)` |
| `0x0020` | `1058:0e40` | 0 | skips on replay; `1050:0b31` (B into C, screen loaded) |
| `0x0070` | `1058:09f1` | 0 | skips on replay; frees the palette in the thread's palette slot, clears the pending palette when it is that one |
| `0x0080` | `1058:0806` | 190 | skips on replay; frees the bitmaps of the thread's BMP slot (unless they are the shared walk list) and clears the slot |
| `0x0090` | `1058:091d` | 0 | skips on replay; deletes the thread's font (empty stub `1030:07d4`) and clears it |
| `0x00c0` | `1058:086d` | 0 | skips on replay; frees zone buffer [thread zone slot] |
| `0x00e0` | `1058:072b` | 0 | skips on replay; frees the BMP matrix if any |
| `0x0110` | `1058:0f73` | 528 | purge flag `1068:4642 = 1` |
| `0x0400` | `1058:0dc7` | 0 | skips on replay; only with `1ebf`: palette reset through stubs |
| `0x0500` | `1058:0fd2` | 0 | `1068:27c0 = 1` (later drawings get no `C → B` rect) |
| `0x0510` | `1058:0fda` | 0 | `1068:27c0 = 0` |
| `0x0ff0` | `1058:1212` | 6,631 | ends the page |
| `0x1011` | `1058:0aa0` | 0 | return-0 stub `1028:18ae(arg0)` |
| `0x1021` | `1058:0e37` | 1,148 | delay `1068:46e6 = arg0` |
| `0x1031` | `1058:074f` | 0 | thread `+0x1c = arg0` |
| `0x1041` | `1058:0a6f` | 0 | `1068:46ae = arg0` |
| `0x1051` | `1058:075c` | 456 | thread BMP slot `+0x14 = arg0` |
| `0x1061` | `1058:0952` | 41 | thread palette slot `+0x12 = arg0`; unless replay, pending palette = the record's palette [arg0] |
| `0x1071` | `1058:08c3` | 0 | thread font slot `+0x10 = arg0`; selects that font (empty stub `1030:07c3`) |
| `0x1101`, `0x1111` | `1058:1056` | 5, 611 | nothing |
| `0x1121` | `1058:0853` | 61 | thread zone slot `+0x16 = arg0` |
| `0x1201` | `1058:0fc3` | 75 | goto: `1068:4644 = 1058:13a9(arg0)` |
| `0x1301`, `0x1311` | remapped | 0 | to `0xc051`, `0xc061` |
| `0x2002` | `1058:06a9` | 217 | foreground and text color = low byte of arg0, background = low byte of arg1 |
| `0x2012` | `1058:0f23` | 52 | unless replay, `1068:46d6 = 1` (the next image load builds pre-mirrored copies); calls the empty `1058:197c` |
| `0x2022` | `1058:0e08` | 152 | skips on replay; random delay (see Delays) |
| `0x2032` | `1058:0706` | 0 | skips on replay; scrolls the BMP matrix (`1040:1183(arg0, arg1)`) |
| `0x2302`, `0x2312`, `0x2322` | `1058:0d04` | 0 | only with `1ebf`: stores a color range |
| `0x2402` | `1058:0d36` | 0 | skips on replay; only with `1ebf`: palette cycling through stubs |
| `0x3003` | `1058:0f7f` | 0 | page call (see Page calls below the table) |
| `0x3103` | `1058:0eff` | 0 | skips on replay; `1050:0a85(0, 0, 640, 480)` |
| `0x4004` | `1058:0f40` | 52 | clip: thread and globals `x1 = arg0`, `y1 = arg1`, `x2 = arg2`, `y2 = arg3`, clip on |
| `0x4114` | `1058:0aac` | 0 | skips on replay; copies B to A and B to C (whole screen), selects the pending palette |
| `0x4124` | `1058:0ba4` | 0 | skips on replay; selects the pending palette, copies B to A (whole screen) |
| `0x4136` | `1058:0c8c` | 0 | only with `1ebf`: timed palette fade |
| `0x4204` | `1058:0e55` | 38 | skips on replay; copies `(x, y, w, h)` of B into C, then a `B → A` age 0 rect |
| `0x4214` | `1058:0860` | 60 | nothing |
| `0x5005` | `1058:1056` | 0 | nothing |
| `0xb000` | `1058:0fe2` | 0 | skips on replay; `1050:0000` |
| `0xb013` | `1058:0ff2` | 0 | `1050:0061(arg0, arg1, arg2)` |
| `0xb606` | `1058:0eb4` | 6 | skips on replay; copies `(x, y, w, h)` from surface arg4 to surface arg5 |
| `0xf01f` | `1058:06c5` | 40 | skips on replay; loads a screen into B, then `1050:0b31` |
| `0xf02f` | `1058:0769` | 263 | skips on replay; loads bitmaps into the thread's BMP slot |
| `0xf04f` | `1058:08e1` | 0 | skips on replay; loads `WILLY.FON` into the font slot and selects it |
| `0xf05f` | `1058:0995` | 41 | skips on replay; loads a palette into the thread's palette slot and makes it pending |
| `0xf08f` | `1058:06de` | 0 | skips on replay; loads a BMP matrix |
| `0xf10f`..`0xf19f` | `1058:1005` | 0 | text buffer strings |
| `0xc01f`, `0xc02f` | `1058:0035`, `0046` | 0 | unless replay, copy the string into `1068:46bd`, `1068:46b0` |
| `0xc031` | `1058:004e` | 0 | unless replay, return-0 stub `1028:1acc(1068:46b0, arg0)` |
| `0xc051` | `1058:0063` | 535 | unless replay, `audio_playSound(arg0)` (`1020:00ba`) |
| `0xc041`, `0xc061`..`0xc0a1`, `0xc0b2`..`0xc0f4`, `0xc102`, `0xcf01`, `0xcf11` | `1058:0000` table | 0 | unless replay, return-0 stubs (see Stubs and dead branches) |
| `0xa002` | `1058:022c` | 63 | `1040:0d54(x, y, foreground)` |
| `0xa014`..`0xa094`, `0xa0b5` | `1058:02f6` → `1058:1510` | `0xa054`: 1, `0xa064`: 1, the rest 0 | effects (see Zones and effects) |
| `0xa0a4` | `1058:0179` | 784 | line `1030:02ef(x1, y1, x2, y2)` |
| `0xa104` | `1058:01a9` | 111 | fill on, rect `1038:1bd8(x, y, w, h)` |
| `0xa114` | `1058:018c` | 0 | fill off, rect, fill on |
| `0xa204`..`0xa294` | `1058:035b` | 0 | text (see Text and fonts) |
| `0xa404` | `1058:01c4` | 437 | fill on, circle, fill on |
| `0xa424` | `1058:01bd` | 0 | fill off, circle, fill on |
| `0xa504`, `0xa514`, `0xa524`, `0xa534` | `1058:025b` | 12,546, 0, 2,822, 0 | sprite `1028:17d8(image, x, y, flags)` |
| `0xa506`, `0xa516`, `0xa526`, `0xa536` | `1058:025b` | 0 | stretched sprite `1030:03d7(image, x, y, flags, arg4, arg5)` |
| `0xa5a7` | `1058:025b` | 0 | draws nothing |
| `0xa601` | `1058:02d8` | 6,814 | draws nothing; its dirty rect is a zone rect |
| `0xa704` | `1058:023e` | 0 | BMP matrix blit `1040:1113(x, y, w, h)` when a matrix is loaded |
| `0xaf02` | `1058:02e5` | 0 | return-0 stub `1028:195e(x, y, background)` |
| `0xaf1f`, `0xaf2f` | `1058:01f8`, `01ff` | 0 | fill off / on, return-0 stub `1028:187e` with pointers into the copied word pairs, fill on |

Page calls and the other handlers in detail:

- `1058:0f7f` (`0x3003`): adds 1 to `1068:27c2`, sets the page-call offset `46e0 = arg0`, `46de = arg1`, remembers whether the purge flag `4642` was clear, and runs `1058:040c(1058:13a9(arg2))`. After it returns, it clears `4642` again when it was clear before, then subtracts 1 from `27c2`.
- `1058:0f7f`: the nested run starts by setting `4644` to `0xFFFF`, so a goto from before the call is lost, and it reloads the replay flag (same value). `46e0`/`46de` keep their values after the call; a nested call overwrites them instead of adding.
- `1058:0f7f`: when the tag has no page, `1058:13a9` returns `0xFFFF` and `1058:040c` reads page table entry `0xFFFF`, past the table. No script uses `0x3003`.
- `1058:13a9`: far cdecl `(tag)`. Walks the page table from page 0 until the first null entry (the loader leaves one after the last page) and returns the first page whose first instruction is `0x1101` or `0x1111` with that tag; `0xFFFF` when none. A tag that is not a page's first instruction is never found.
- Data, `0x1101`/`0x1111`: every one of them is the first instruction of its page, and every `0x1201` names a tag that some page starts with (checked by framing every page of `re/fixtures/decompressed/*.TTM.TT3.bin`, 2026-10-18).
- `1058:06a9` (`0x2002`): stores the low byte of arg0 in thread `+0x1e`, the foreground `1068:1eae`, and the text color `1068:1ea0`, and the low byte of arg1 in thread `+0x1f` and the background `1068:1ead`. Nothing masks them to 4 bits; the one use with 207 (`0xcf`, both colors) gets a dither brush (`docs/re/graphics.md`, `Colors`).
- `1058:0f40` (`0x4004`): writes thread `+0x21`/`1068:1ea4` = arg0, `+0x25`/`1ea8` = arg1, `+0x23`/`1ea6` = arg2, `+0x27`/`1eaa` = arg3, then thread `+0x20` and `1ea3` = 1. It runs on replays too. One use passes `(0, 0, 640, 350)`, a right edge past the screen.
- `1058:0e55` (`0x4204`): when `2641 >= 3`, `1050:0b74(x, y, w, h)` copies that rect of B into C, then `1060:007e(x, y, w, h, kind 1, B (C when 287a), A, age 0)`.
- `1058:0eb4` (`0xb606`): source = `1058:14e0(arg4)`, target = `1058:14e0(arg5)`, `1038:06ce(x, y, w, h)`, then source A and target B. All 6 uses pass `arg4 = 2`, `arg5 = 1`: they copy C to B.
- `1058:14e0`: far cdecl `(n)`: 0 → A, 1 → B, 2 → C, anything else → B.
- `1058:0aac` (`0x4114`): source B, target A, `1038:06ce(0, 0, 640, 480)` (skipped into A by `429e`, presented anyway); when `2641 >= 3` target C and the same copy; then target B, `1040:0b08(pending)`, and the pending palette becomes `0b08`'s return value.
- `1058:0ba4` (`0x4124`): `1040:0b08(pending)` first (the pending pointer stays), then source B, target A, `1038:06ce(0, 0, 640, 480)`, target B.
- `1058:0fe2` / `1058:0ff2` (`0xb000` / `0xb013`): see Stubs and dead branches.

## Drawing and dirty rects

- `1058:048e`: every instruction other than `0x0FF0` runs with draw target and copy source B. Every drawing opcode draws on B; only `0xb606`, `0x4114`, `0x4124`, and the effects change the target, and each sets it back to B (the effects through `1058:18f1`). `0xb606` leaves the copy source at A until the next instruction resets it.
- `1058:0144`: far cdecl `(arg0, ..., arg6, string)`. Looks the opcode up in the 20-entry table at `1058:03bc` (cases in `re/out/jump-tables.tsv`, jump `1058:0175`); otherwise checks the effect range, then the text range; anything else returns `0xFFFF` and draws nothing.
- `1058:022c` (`0xa002`): `1040:0d54(x, y, color)` with the foreground byte `1068:1eae` sign-extended, so 207 is passed as `-49` (`1040:0d54`: `docs/re/graphics.md`, `Primitives`).
- `1058:01c4` (`0xa404`): fill on, `r = arg3 >> 1` (arithmetic shift), `1040:0688(r, x + r, y + r)`, fill on. Arg 2 (width) is not read; all 437 uses have width = height.
- `1058:025b` (sprites): flags = bits 4..7 of the opcode (1 flip, 2 mirror), stored in `1068:46dc`; the bitmap list is the record's BMP slot list [arg3] (the instruction's own slot, not the thread's BMP slot), the image is that list's entry [arg2]. A null list or a null image draws nothing. Low nibble 7 draws nothing, 6 calls `1030:03d7(image, x, y, flags, arg4, arg5)`, 4 calls `1028:17d8(image, x, y, flags)`.
- `1058:025b`: neither the slot nor the image index is checked against a bound. In the data the slot args are 0..5.
- `1050:0a85`: far cdecl `(x, y, w, h)`. With `287a == 0` (runtime): kind-1 dirty rects `(B → A, age 0)`, `(B → A, age 1)`, and, when `1068:27c0 == 0` and `2641 >= 3`, `(C → B, age 0)`, each through `1060:007e` with the current clip.
- `1050:0a85`: with `287a != 0` (never at runtime): only `(C → B, age 1)`, and only when `27c0 == 0` and `2641 >= 3`.
- `1058:106c`: the dirty rect after an `0xAxxx` opcode comes from the 18-entry table at `1058:1275` (cases in `re/out/jump-tables.tsv`, jump `1058:1088`); each rect goes to `1050:0a85`.
- `1058:1195` (`0xa002`): `(x, y, 8, 1)`.
- `1058:119e` (`0xa0a4`): `(min(x1, x2), min(y1, y2), |x1 - x2| + 8, |y1 - y2| + 2)` (signed compares).
- `1058:1132` (`0xa404`, `0xa424`): `(x - 20, y, w + 48, h + 1)`.
- `1058:10b7` (`0xa504`..`0xa536`): the image as looked up for drawing; nothing when the list or the image is null. Low nibble 6: `(x, y, arg4, arg5)`. Otherwise `(x, y, |image width|, image height + 2)`, nothing when the width is 0.
- `1058:108c` (`0xa5a7`): `(x, y, arg4 - x, arg5 - y)`, written back into the arg 4 and 5 locals.
- `1058:1158` (`0xa601`): when zone buffer [arg0] (record `+0x3c`) is set, the zone rect [arg0] `(+0x6c, +0x84, +0x9c, +0xb4)`; otherwise nothing.
- `1058:10a1` (`0xa704`): `(x, y, w, h)` when a BMP matrix is loaded (`1068:2640`); otherwise nothing.
- `1058:0458` (`0xaf02`): no dirty rect.
- `1058:114b` (`0xaf1f`, `0xaf2f`): `(0, 0, 640, 480)`.
- `1058:11f0`: every other `0xAxxx` opcode (`0xa104`, `0xa114`, the effects, the text opcodes, and opcodes no case handles): `(x, y, w + 8, h + 2)` from args 0..3.
- `0xa601` is not a screen clear: it draws nothing, and its rect exists only for zone buffers made by `0xa054`. Only one script (`GJGULIVR.TTM`) runs `0xa054`, on zone 0, so everywhere else `0xa601` does nothing at all. Nothing needs clearing: every story step ends with the restore pass (`1060:03d3`, `docs/re/graphics.md`, `Dirty rects`), which copies C back over B at each `(C → B, age 0)` rect, erasing last step's drawings.
- `1050:0b74`: far cdecl `(x, y, w, h)`. When `2641 >= 3`: saves the copy source and draw target, copies `(x, y, w, h)` from B to C with `1038:06ce`, and restores both.
- `1050:0b31`: sets `1068:4640` (read by the end-of-page block), and when `2641 >= 3` copies all of B into C (`1050:0b74(0, 0, 640, 480)`) and drops the `(C → B, age 0)` list with `1060:06ac(C, B, 287a)`, so last step's pending restores do not undo the new screen.

## Resources

- `1058:06c5` (`0xf01f`): `1028:1813(name)` loads the screen through `decoders_loadScreen` (`1030:16d8`), drawn on the current target, B; then `1050:0b31`. Data names: `ISLETEMP.SCR` (32), `ISLAND2.SCR` (4), `SUZBEACH.SCR` (2), `JOFFICE.SCR`, `THEEND.SCR`.
- `1058:0769` (`0xf02f`): frees the bitmap list in the thread's BMP slot with `1028:1845` unless it is null or the shared walk list `1068:30d2`.
- `1058:079f`: when `rtl_stricmp(name, "JOHNWALK.BMP")` (`1000:197e`, string at `1068:27d2`) is 0, the slot gets the shared walk list `1068:30d2` and nothing is loaded.
- `1058:07c5`: otherwise `1068:4106 = 1068:46d6`, the slot gets `1028:17fa(name)` (`decoders_loadBmp`), and a null result logs `Unable to load bitmap file %s` (`1068:27df`) through `platform_debugLog` (`1020:081c`).
- `1058:07f8`: both paths end with `46d6 = 4106 = 0`.
- Data: `0xf02f` loads 113 different names; `JOHNWALK.BMP` 36 times.
- `1058:0f23` (`0x2012`) with `0xf02f`: `46d6` makes `1040:0000` build pre-mirrored images for the next load (`docs/re/graphics.md`, `Bitmap masks and mirrors`). In the data, 29 different bitmaps besides `JOHNWALK.BMP` are loaded right after a `0x2012` (for example `MJFISH1.BMP`, `GJGULL1.BMP`, `BOAT.BMP`); 9 more such loads are `JOHNWALK.BMP`, which takes the shared list and loads nothing. No `0x2012` is left pending at a page end.
- `1058:0806` (`0x0080`): frees the BMP slot's list like `0xf02f` (not the shared walk list) and sets the slot to 0.
- `1058:0995` (`0xf05f`): frees the palette in the thread's palette slot (`1040:0bc7`), loads the name with `1040:09eb`, stores the result as a far pointer in that slot, and makes it the pending palette. Data: always `JOHNCAST.PAL`.
- `1058:09f1` (`0x0070`): when the thread's palette slot holds a palette, clears the pending palette if it is that one, frees it with `1040:0bc7`; then clears the slot.
- `1058:0952` (`0x1061`): sets the thread's palette slot on every run; unless replay, the pending palette becomes the record's palette in that slot (which may be null). Data: always slot 0.
- `0xf01f`, `0xf02f`, `0xf05f` pass the name exactly as the bytecode spells it. In the data every name is upper case.
- `1028:1845` frees bitmap lists (`1030:00fe`), `1040:0bc7` frees palette slots, `1030:1b63` (`platform_farFree`) frees zone buffers.
- Data: `FIRE.TTM` loads `FLAME.BMP` and `FLURRY.BMP`, which are not in the archive. No ADS script loads `FIRE.TTM`. In the original the load returns null and `1058:07c5` logs it; ours returns null too.
- Ours: `src/ttm/gdi-device.ts` loads screens onto the draw target (`1028:1813`), bitmaps as surface lists (`1028:17fa`), the shared walk list once (`1068:30d2`), and palettes as 48 RGB bytes (`1040:09eb`); names are looked up in upper case.

## Palettes

- `1068:4646`/`4648`: the pending palette (near offset, segment). Set by `0xf05f` and `0x1061` (first runs only), cleared by `0x0070` when it frees that palette and by `1050:080c` when it unloads the record that holds it.
- `1050:0799`: when the pending palette is set, makes it active with `1040:0b08` and clears it. `1048:1acb` calls it once after running every thread, so a palette loaded in a page shows from the end of that ADS tick.
- `1058:0952`: in color mode 4 `0x1061` would also select the palette at once; the mode is always 2.
- `0x4114` and `0x4124` select the pending palette themselves (see Opcodes); no script uses them.
- `0x0400`, `0x2302`..`0x2322`, `0x2402`, `0x4136`, and the fade parts of `0x4114`/`0x4124` run only when `1068:1ebf` is set, which never happens. Their callees are the empty stubs `1040:0c13` and `1040:0c21` and the timer helpers `1058:1ad0`, `1058:1b1f`, `1058:1be1`.
- `1058:14a8`: far cdecl `(range, arg)`: `1040:0c21(start, end - start + 1, arg)` with the range stored by `0x2302`..`0x2322` at `1068:46ca`/`46d0`.
- `1058:1be1`: fills a 3-word timer record with the clock `1068:2e70`/`2e72` and a duration. `1058:1ad0`: returns 1 when that duration has run out, or when `1068:45e2` is 0. `1058:1b1f`: interpolates between two values by the elapsed share. `1058:1c06`: fills a record that has already run out; nothing references it.

## Zones and effects

- Record `+0x3c`: twelve far zone buffers, with their rects at `+0x6c`, `+0x84`, `+0x9c`, `+0xb4`. Only `0xa054` writes a zone buffer or rect, always zone 0.
- `1058:086d` (`0x00c0`): frees zone buffer [thread zone slot] with `platform_farFree` and clears it; the rect stays. `0x1121` sets the thread zone slot, which only `0x00c0` reads; no script uses `0x00c0`.
- `1058:02f6`: an opcode in `0xa014..0xa094` (any value in that range that the table does not take) or `0xa0b5` runs `1058:1510(x, y, w, h, arg4, opcode)` only when not replay, `w > 0`, `h > 0`, `x + w <= 640`, and `y + h <= 480` (signed). Its dirty rect is the default one, on every run.
- `1058:1510`: saves the draw target, sets it to A, dispatches through the 8-entry table at `1058:1900` (cases in `re/out/jump-tables.tsv`, jump `1058:1561`), and puts the saved target back at `1058:18f1`. The copy source stays B.
- `1058:1747` (`0xa054`): sets zone 0's rect to `(x, y, w, h)`, frees an older zone 0 buffer, allocates `1030:0197(w, h)` bytes with `platform_farAlloc` (`1030:199a`), stores it as zone 0, and saves that rect of the copy source B into it with `1030:01c4`. A zero size or failed allocation stops early.
- `1058:1801` (`0xa064`): sets the target to B and, when zone 0 has a buffer, restores it with `1030:0250` at zone 0's saved rect (not at the instruction's args).
- Data: `0xa054` and `0xa064` are each used once, in `GJGULIVR.TTM` (pages 142 and 321), both with `(194, 123, 175, 142)`.
- `1058:171a` (`0xa014`): return-0 stub `1028:17c8(x, y, w, h)`. Unused.
- `1058:1705` (`0xa024`): `1058:1949(x, y, w, h)`, a plain copy B → A. Unused.
- `1058:1565` (`0xa034`, `0xa094`): steps a rect centered in `(x, y, w, h)` with `1058:1949` copies B → A: `0xa034` shrinks it from the larger half size down to 1, copying its four edge strips each step; `0xa094` grows it from 1 up to the larger half size, copying the whole rect each step. Unused.
- `1058:185f` (`0xa044`): blinds: for offsets 1..10, copies every tenth row (`1038:06ce(x, y + offset + 10k, w, 1)`) with a `1058:1920` pause after each row. Unused.
- `1058:18a6` (default, `0xa074`, `0xa084`, and any other value in the range): for `i` from 3 to `h - 3`, copies a 3-row strip with `1058:1949`: at `y + h - i` for `0xa084`, at `i - 3` (an absolute row) for `0xa074`, at `y` for anything else, with a pause between strips. Unused.
- `1058:172f` (`0xa0b5`): `1058:198a(x, y, w, h, arg4)`. Unused.
- `1058:198a`: sets source B and target A; with `1ebf` clear (always) it is one `1038:06ce(x, y, w, h)`. The pixel dissolve behind `1ebf` never runs.
- `1058:1949`: `1038:06ce(x, y, w, h)` when both `w` and `h` are above 2. `1058:1920`: calls `1058:1949(0, 0, 0, 0)` 100 times, a busy wait that copies nothing.

## Delays

- `1058:0e37` (`0x1021`): `1068:46e6 = arg0`, on replays too. No minimum: 93 uses pass 0.
- `1058:0e08` (`0x2022`): skips on replay. Calls `story_random` (`1018:1e60`), divides the 16-bit result unsigned by `arg1 - arg0` (`DIV`), takes the remainder as a signed word, its absolute value, and sets `46e6 = arg0 + that`. When `arg1 == arg0` the divide by 0 faults; all 152 uses have `arg0 < arg1`.
- `1018:1e60`: an additive lagged-Fibonacci generator over the 56-word table at `1068:1ce8`; its seeding is chunk 7.
- `1048:1acb`: sets `46e6 = 0xFFFF` before running a page. After a run, when `46e6` is not `0xFFFF` and differs from the node's delay `+0x29`, the delay becomes `46e6` and the next due time `now + 46e6` (clock `1068:2e70`/`2e72`). An equal value changes nothing; a page without a delay opcode keeps the old delay.
- `1048:196e`: far cdecl `(node)`. With a non-zero delay and a due time still ahead, returns 0. Otherwise, with a non-zero delay, the due time becomes `now + delay`; then `[7] = 0` and the page advances (`[4] = [3]` and `[3] = 0xFFFF` when `[3]` is set, else `[4] += 1`); returns 1.
- So with a delay `d`, a page is first run on the tick it becomes current and re-run as a replay on every later tick until `d` clock units have passed since the page advanced (or since its first run set a new delay); with delay 0 it runs once.

## Text and fonts

- `1058:08e1` (`0xf04f`): deletes the font in the thread's font slot (empty stub `1030:07d4`), loads one with `1030:0765(name)`, stores it, and selects it (`1030:07c3`). `1030:0765` ignores the name and uses `WILLY.FON` (`docs/re/graphics.md`, `Text`).
- `1058:08c3` (`0x1071`): sets the thread's font slot and selects its font (`1030:07c3`, empty).
- `1058:091d` (`0x0090`): deletes the slot's font (`1030:07d4`, empty) and clears it.
- `1058:1005` (`0xf10f`..`0xf19f`): fills text buffer `(opcode - 0xf10f) >> 4` from the near pointer table `1068:2622` (9 buffers of 41 bytes at `1068:2643`..`278b`). `0xf19f` gives index 9, past the table, and copies to wherever the next word points.
- `1058:035b` (`0xa204`..`0xa294`): selects the thread's font (`1030:07c3`), sets the text back mode `1068:1ea2 = 1` (transparent), draws text buffer `(opcode - 0xa204) >> 4` at `(x, y)` with `1030:04ce`, and sets the back mode back to 0. `0xa294` reads past the buffer table like `0xf19f`.
- `1030:04ce`, `1030:04ee`: see `docs/re/graphics.md`, `Text`.
- `1030:07c3`: empty, returns 1. `1030:07d4`: empty, returns nothing.
- Data: no TTM script uses any text or font opcode, so the engine draws no text (OQ-16).

## Stubs and dead branches

- Return-0 stubs reached from `1058` (all return 0 and do nothing else; `docs/re/decoders.md`, `Thunks`): `1028:17c8` from `0xa014`; `1028:187e` from `0xaf1f`/`0xaf2f`; `1028:188e` from `0x0010`; `1028:18ae` from `0x1011`; `1028:195e` from `0xaf02`.
- `1058:0000`: far cdecl `(arg0, arg1, arg2, arg3, string)`. Looks the opcode up in the 18-entry table at `1058:00fc` (cases in `re/out/jump-tables.tsv`, jump `1058:0031`); returns `0xFFFF` for an opcode not in it, else 0.
- `1058:0000` stubs: `0xc031` → `1028:1acc(1068:46b0, arg0)`, `0xc041` → `1028:1abc(arg0)`, `0xc061` → `1028:1aac(arg0)`, `0xc071` → `1028:1a9c(arg0)`, `0xc081` → `1028:1a8c(arg0)`, `0xc091` → `1028:1a7c(arg0)`, `0xc0a1` → `1028:1a6c(arg0)`, `0xc102` → `1028:1a5c(arg0, arg1)`, `0xc0b2` → `1028:1a4c(arg0, arg1)`, `0xc0c2` → `1028:1a3c(arg0, arg1)`, `0xc0d3` → `1028:1a2c(arg0, arg1, arg2)`, `0xc0e3` → `1028:1a1c(arg0, arg1, arg2)`, `0xc0f4` → `1028:1a0c(arg0, arg1, arg2, arg3)`, `0xcf01` → `1028:19fc(arg0)`, `0xcf11` → `1028:19ec(arg0)`.
- `1058:0000`: `0xc01f` and `0xc02f` copy the string into `1068:46bd` and `1068:46b0` (`rtl_strcpy`); only `0xc031` reads `46b0`, and it passes it to a stub.
- `1058:0000`: `0xc051` → `audio_playSound(arg0)`; the only `0xCxxx` opcode the data uses.
- `1050:0000` (`0xb000`): stores the widest image width of the thread's BMP slot in `1068:463c` and clears `1068:463e`.
- `1050:0061` (`0xb013`): draws the thread's BMP slot images in a column at `x = arg2`, starting `463e` rows above the screen bottom and spaced by `arg0` plus each image's height, marks each with `1050:0a85`, adds `arg1` to `463e`, and raises the purge flag when none was drawn (a credits scroll). No script uses `0xb000` or `0xb013`.
- BMP matrix: `0xf08f` (`1040:0db0`), `0x00e0` (`1040:10ef`), `0x2032` (`1040:1183`), `0xa704` (`1040:1113`). No resource has `BMP:MTX:` and no script uses them (`docs/re/graphics.md`, `Bitmap matrix`).
- Branches behind `1068:1ebf` (never set): `0x0400`, `0x2302`..`0x2322`, `0x2402`, `0x4136`, the fades in `0x4114`/`0x4124`, and the dissolve in `1058:198a`.
- `1040:0c13`: empty, returns nothing. `1040:0c21`: empty, returns 0. `1040:0c31`: empty, returns nothing; nothing references it.

## Unloading

- `1050:080c`: far cdecl `(id)`. Selects the record; with none, does nothing. Frees the BMP matrix if loaded, deletes every font (`1030:07d4`), frees every BMP slot list except the shared walk list, frees every palette (clearing the pending palette when it is one of them), frees every zone buffer, the page table, and the bytecode, unlinks the record from the list at `1068:2634`, and frees it.
- `1050:07c6`: unloads every record with `1050:080c`, then frees every thread node and clears `1068:263c` and `1068:263e`.
- `1050:0a6e`: frees the dirty-rect pool (`1060:0556`) and calls `1050:07c6`. Nothing references it.
- `1050:0152`: sets `2641 = 2` in color mode 12 (never), then grows the dirty-rect pool by 100 nodes (`1060:0000`). Called once from `1048:0000`.

## ADS side

Read for the interface; chunk 6 verifies.

- `1048:1acb`: walks the thread nodes of the current ADS. For each it first sets `[5] = 0xFFFF`. A node runs when its state `+0x2b` is not 6 and its mode `+0x2f` is 1, 2, 3, or 5.
- `1048:1acb`: before a run it selects the node's TTM (`1050:03e2`), loads the text color and foreground (`1ea0`, `1eae`) from byte `+0x1e`, the background `1ead` from `+0x1f`, the clip `1ea4`, `1ea8`, `1ea6`, `1eaa` from `+0x21`, `+0x25`, `+0x23`, `+0x27`, and the clip-on byte `1ea3` from `+0x20`; clears the purge flag `4642`; sets `46e6 = 0xFFFF`; and runs `1050:074a([4])`.
- `1048:1acb`: when the run returned 0 (and the state is not 5), the node goes back to its tag page (`[3] = [2]`) and its mode becomes 4. With state 5, nothing more happens, so `[7]` stays 0.
- `1048:1acb`: after a run: `[7] = 1`, `[5] = [4]`, and the delay is applied (see Delays).
- `1048:1acb`: without a purge: a goto (`4644 != 0xFFFF`) sets `[3] = 4644` and also `[6] = 1` when it names the current page; then `1048:196e` unless the mode is 5.
- `1048:1acb`: with a purge: `[3] = [2]` (back to the tag page); mode 2 with a count advances and counts down; mode 3 with an end time advances; otherwise it advances and, when it did, sets mode 4 and delay 0.
- `1048:1acb`: after all nodes: `1050:0799` (pending palette), then clip on over the whole screen.
- `1048:196e`: see Delays. It is the only place that clears `[7]`, so a page is replayed (`[7] = 1`) on every tick until its delay is due.
- `1048:1e5a`: re-runs `[5]` of every node that ran this tick as a replay (`[7]` forced to 1, then restored), loading the globals as `1048:1acb` does. No call or relocation references it.
- `1018:06bf` (one story step, chunk 7): `1010:040e(0)` (island scenery), the ADS load and tag start when needed, `1048:1acb`, `1048:0766`, `1010:1e50(0)`, sound 25 when due, then the restore pass `1060:03d3(0)`.
- Ours: src/ads/scheduler.ts runs pages through runTtmPage with the thread's draw state loaded (loadThreadDrawState) and reset after all threads (resetDrawClip), activates the pending palette after all threads (1050:0799), keeps replaying an ending thread's page until its timer is due, and paces with countdown timers (OQ-22).

## Emulated

- `scripts/re/unicorn/original_ttm.py` loads each TTM script with the original loader (`1050:0177`, `1050:04d6`), resets one thread node with `1048:0b3e`, and runs pages through `1050:074a`. The page runner, the offset passes, dispatch, every opcode handler, the dirty-rect arithmetic, the zone bookkeeping of `0xa054`/`0xa064`, `1058:13a9`, and `rtl_stricmp` run as original code.
- Replaced by handlers that write one trace row each: pixel `1040:0d54`, line `1030:02ef`, rect `1038:1bd8`, circle `1040:0688`, sprite `1028:17d8`, stretched sprite `1030:03d7`, copy `1038:06ce`, dirty add `1060:007e`, dirty drop `1060:06ac`, rect save `1030:01c4` and restore `1030:0250`, screen load `1028:1813`, bitmap load `1028:17fa`, palette load `1040:09eb`, sound `1020:00ba`, random `1018:1e60`, and palette select `1040:0b08`.
- Replaced silently (return 0): bitmap free `1028:1845`, palette free `1040:0bc7`, and the empty debug log `1020:081c`.
- The fake bitmap loader builds a near table of image records with each image's width and height from `BMP:INF:`, so `1058:025b`'s null and width tests run as original code. `JOHNWALK.BMP` is pre-loaded into the shared walk list `1068:30d2`.
- The fake palette loader returns a fresh near pointer for a name that exists in the archive, 0 otherwise.
- The fake random source returns `(call * 25173 + 13849) & 0xffff`, `call` counted from 0 within one TTM.
- Fixture: `re/fixtures/ttm/traces.tsv` (gitignored), written by `scripts/re/unicorn/dump_ttm.py`. Every page of the 41 TTM scripts, in page order, each run once as a first run (`[7] = 0`) and once as a replay (`[7] = 1`). Island offsets `(7, 5)`, fill on, everything else as at runtime. Before each run the globals are loaded from the node as `1048:1acb` does. 13,262 runs, 154,380 rows.
- Fixture counts: 535 sound rows, all on first runs (the 535 uses of `0xc051`); 41 palette loads; 40 screen loads; 227 bitmap loads (263 uses of `0xf02f` minus the 36 `JOHNWALK.BMP` loads, which take the shared list); 28,431 sprite draws; every dirty rect is kind 1.
- `1058:025b`: with pages run in file order, 17 sprite draws index past the end of the bitmap list in their slot (both passes of GJNAT1 pages 21 and 162, GJVIS3 116 and 119, SMDATE 173 to 175; replays only of SJLEAVES 60 and 112). SJLEAVES page 112 shows the replay case: its first run draws image 20 of slot 3 and then loads a smaller `SLEVEJM3.BMP` into slot 3, so the replay reads past it. The original reads whatever word follows the table. The harness pads every table with zeros to 128 entries (the largest index in the data is 101), so such a draw finds a null image and draws nothing. Whether the game ever reaches these pages with those slot contents depends on the ADS order (chunk 6). Our runner keeps the same guard (OQ-23).
- Step 4 compares our runner with this trace (`src/ttm/page-runner.data.test.ts`).

Trace rows: `ttm	page	pass	event	values`. `pass` is `first` or `replay`; `values` are joined with one space. Surfaces: A = 0, B = 1, C = 2. `clip` is five values: clip on (0/1), x1, y1, x2, y2 (`1068:1ea3`, `1ea4`, `1ea8`, `1ea6`, `1eaa`). Coordinates are signed 16-bit. Foreground, background, and fill are unsigned bytes. `bitmapName` and palette names are upper case; `screen`, `bitmaps`, and `palette` rows carry the name as the bytecode spells it.

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
| `selectPalette` | name | `1040:0b08` (no TTM script reaches it; a row means a difference) |
| `result` | ran delay goto purge pendingPalette mirrorNextLoad keepDrawings | after each run: return value, `46e6`, `4644` (both signed, `-1` = none), `4642`, name of the palette at `4646` or `-`, `46d6`, `27c0` |
| `thread` | foreground background clipOn x1 y1 x2 y2 bmpSlot paletteSlot zoneSlot | after each run, from the node |

## Past fixes reviewed

Every commit below changed the old interpreter (`src/ttm/interpreter.ts`, deleted in chunk 5).

- `d670686` (SET_DELAY missing timer): `0x1021` set the thread's countdown timer as well as its delay, both at least 4 ticks. Original: `1058:0e37` only sets `1068:46e6 = arg0`, with no minimum; `1048:1acb` turns a changed delay into a due time after the page ends. Verdict: differs: the 4-tick floor has no counterpart; `src/ttm/page-runner.ts` returns the delay as is and the scheduler's 1-tick pacing floor is OQ-22.
- `5f4e3a0` (DRAW_RECT/DRAW_CIRCLE no longer offset width and height): `0xa104` and `0xa404` stopped adding the island offset to args 2 and 3. Original: `1058:05b9` adds the island offset to args 0 and 1 only, except `0x4004` and `0xa0a4`, which get it on both corners. Verdict: matches the original.
- `9a40bb2` (LOAD_SCREEN resets dx/dy): `0xf01f` set the island offset to 0 after loading a screen. Original: `1058:06c5` loads the screen on B and calls `1050:0b31`; nothing in it touches `1068:46e4`/`46e2`, which only `1010:00fc` sets. Verdict: differs: our runner keeps the offset, and which offset a scene runs with is set per scene by the story (OQ-24, chunk 7).
- `0d4078d` (DRAW_BACKGROUND is a no-op): `0x0080` stopped clearing the thread's layer. Original: `1058:0806` frees the BMP slot's bitmaps (not the shared walk list) and clears the slot; it draws nothing. Verdict: matches on drawing; our runner also clears the slot (`FREE_IMAGES`).
- `7a9d964` (TIMER sets delay and timer directly): `0x2022` set the delay to the average of its args and kept running the page. Original: `1058:0e08` picks `arg0 + |rand % (arg1 - arg0)|` with `1018:1e60`, skips on replay, and the page always runs to its `0x0FF0`. Verdict: differs: the delay is random, not an average; our runner follows `1058:0e08` (`randomDelay`), with `Math.random` as the source (OQ-26).
- `e1d3bae` (GOTO_TAG defers the jump): `0x1201` stored the target and kept running instead of jumping at once. Original: `1058:0fc3` sets `1068:4644 = 1058:13a9(arg0)`; the page runs on to its `0x0FF0`, and `1048:1acb` moves the node to that page through `[3]` and `1048:196e`. Verdict: matches the original in spirit; replaced by `src/ttm/page-runner.ts` (`gotoPage`).
- `cacfdb0` (PURGE schedules a jump): `0x0110` jumped back to the previous tag when the scene had a time limit, else ended the thread, and kept running. Original: `1058:0f73` only sets the purge flag `1068:4642`; `1048:1acb` sends the node back to its tag page (`[3] = [2]`, not the last tag before the instruction) and decides the rest from the node's mode. Verdict: only mattered in the old interpreter; replaced by `src/ttm/page-runner.ts` (`purge`), with the scheduler side in OQ-22.
- `31988b3` (revert DRAW_SCREEN): removed the scaled draw for `0xb606` again. Original: `1058:0eb4` copies a rect between surfaces, C to B in all 6 uses; it does not scale. Verdict: only mattered in the old interpreter; replaced by `src/ttm/page-runner.ts` (`COPY_SURFACE_RECT`).
- `2ed4424` (GOTO_TAG must yield): `0x1201` jumped and returned at once, to stop loops without a `0x0FF0`. Original: every page ends at `0x0FF0` (`1058:040c`), and the jump happens between ticks (`1048:196e`). Verdict: only mattered in the old interpreter, which had no pages; replaced by `src/ttm/page-runner.ts`.
- `c7f3c6b` (DRAW_SCREEN for scaled sprites): `0xb606` drew a sprite scaled to `(w, h)`. Original: `1058:0eb4` copies `(x, y, w, h)` from surface arg4 to surface arg5 with `1038:06ce`; stretched sprites are `0xa506`..`0xa536` (`1030:03d7`), unused in the data. Verdict: differs: wrong opcode meaning, reverted by `31988b3`; replaced by `src/ttm/page-runner.ts`.
- `037819f` (GOTO_TAG searched LOCAL_TAG instead of TAG): the goto search changed from `0x1101` to `0x1111`. Original: `1058:13a9` takes the first page whose first instruction is `0x1101` or `0x1111` with the tag. Verdict: only mattered in the old interpreter; replaced by `pageOfTag`, which takes both.

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1028:17fa` | `decoders_callLoadBmp` | `src/ttm/gdi-device.ts:86` `GdiDevice.loadBitmaps` | fixed |
| `1028:1813` | `decoders_callLoadScreen` | `src/ttm/gdi-device.ts:79` `GdiDevice.loadScreen` | fixed |
| `1030:04ce` | `gfx_drawTextNear` | none (text not modeled, OQ-16) | open |
| `1030:04ee` | `gfx_drawText` | none (text not modeled, OQ-16) | open |
| `1030:0765` | `gfx_loadFont` | none (text not modeled, OQ-16) | open |
| `1030:07c3` | `gfx_selectFontStub` | none (empty) | match |
| `1030:07d4` | `gfx_deleteFontStub` | none (empty) | match |
| `1038:07e8` | `gfx_presentRect` | `src/gfx/gdi/display.ts:87` `Display.present` (the old pipeline shows a whole buffer) | fixed |
| `1040:09eb` | `decoders_loadPalette` | `src/ttm/gdi-device.ts:97` `GdiDevice.loadPalette` | fixed |
| `1040:0c13` | `gfx_paletteLevelStub` | none (empty) | match |
| `1040:0c21` | `gfx_paletteCycleStub` | none (empty) | match |
| `1040:0c31` | `gfx_paletteEmptyStub` | none (empty, unreferenced) | match |
| `1050:0000` | `ttm_measureSlotImages` | none (no TTM script uses `0xb000`) | match |
| `1050:0061` | `ttm_scrollSlotImages` | none (no TTM script uses `0xb013`) | match |
| `1050:0152` | `ttm_initDirtyPool` | none (no node pool; `2641` stays 4) | match |
| `1050:074a` | `ttm_runPageChecked` | `src/ttm/page-runner.ts:59` `runTtmPage`, `src/ttm/page-runner.ts:84` `runPage` (the page checks) | fixed |
| `1050:0799` | `ttm_activatePendingPalette` | `src/ttm/page-runner.ts:78` `activatePendingPalette` (the old interpreter applies a palette the moment it loads) | fixed |
| `1050:07c6` | `ttm_unloadAll` | none (garbage collection frees records) | match |
| `1050:080c` | `ttm_unload` | none (garbage collection frees records) | match |
| `1050:0a6e` | `ttm_shutdown` | none (unreferenced; garbage collection frees records) | match |
| `1050:0a85` | `ttm_markDrawn` | `src/ttm/page-runner.ts:221` `addDrawnRect` (the old pipeline has no dirty rects) | fixed |
| `1050:0b31` | `ttm_screenToBackground` | `src/ttm/page-runner.ts:336` `screenToBackground` | fixed |
| `1050:0b74` | `ttm_copyToBackground` | `src/ttm/page-runner.ts:342` `copyToBackground` | fixed |
| `1058:0000` | `ttm_soundOpcode` | `src/ttm/page-runner.ts:97` the `0xc000` branch of `runPage` (the old interpreter also plays on replays and ignores `0x1301`) | fixed |
| `1058:0144` | `ttm_drawOpcode` | `src/ttm/page-runner.ts:139` `drawOpcode` | fixed |
| `1058:040c` | `ttm_runPage` | `src/ttm/page-runner.ts:84` `runPage` (the old interpreter keeps an instruction pointer and has no pages or replays) | fixed |
| `1058:13a9` | `ttm_pageOfTag` | `src/ttm/page-runner.ts:65` `pageOfTag` (the old search finds `0x1111` anywhere and skips `0x1101`) | fixed |
| `1058:141f` | `ttm_copyStringArg` | none (strings are decoded by `readTtmInstruction`) | match |
| `1058:147a` | `ttm_fontSlotPointer` | none (no TTM script uses a font opcode) | match |
| `1058:14a8` | `ttm_paletteRangeEffect` | none (needs `1068:1ebf`, never set) | match |
| `1058:14e0` | `ttm_surfaceByNumber` | `src/ttm/page-runner.ts:348` `surfaceByNumber` (the old interpreter ignores `0xb606`) | fixed |
| `1058:1510` | `ttm_effectOpcode` | `src/ttm/page-runner.ts:177` `zoneEffect` (only `0xa054`/`0xa064`; the other effects are OQ-27) | fixed |
| `1058:1920` | `ttm_effectPause` | none (only effects no TTM script uses) | match |
| `1058:1949` | `ttm_effectCopy` | none (only reached by effects in OQ-27) | match |
| `1058:197c` | `ttm_emptyMirrorHook` | none (empty) | match |
| `1058:198a` | `ttm_dissolveEffect` | none (no TTM script uses `0xa0b5`) | match |
| `1058:1ad0` | `ttm_timerExpired` | none (needs `1068:1ebf`, never set) | match |
| `1058:1b1f` | `ttm_timerLerp` | none (needs `1068:1ebf`, never set) | match |
| `1058:1be1` | `ttm_startTimer` | none (needs `1068:1ebf`, never set) | match |
| `1058:1c06` | `ttm_expireTimer` | none (unreferenced) | match |
