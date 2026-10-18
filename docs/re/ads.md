# ADS Scheduler

How the original runs ADS scripts: the record, the nodes made from TTM tags, the section scripts re-run every tick, and how a node's TTM pages advance. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 6. One claim per address. Our own words; no decompiled code. Opcode counts come from the 10 ADS scripts (`docs/re/decoders.md`, `ADS opcode coverage`).

## Record and slots

- `1068:460c`: 10 ADS slots, far pointers (offset at `460c + 4n`, segment at `460e + 4n`). An empty slot is a null pointer.
- `1048:0079`: a slot holds a zeroed far record of `0x472` bytes: word `+0x00` "sections indexed" flag, `+0x02` section count, `+0x04`/`+0x06` far bytecode pointer, `+0x08`/`+0x0a` pointer to the last bytecode byte, `+0x0c`/`+0x0e` TTM list head, `+0x10` node list head (near).
- `1048:04fc`: per section `i` (0 to 79): word `+0x12 + 2i` state, word `+0xb2 + 2i` loop counter, far `+0x152 + 4i` start (just after the section's tag word), far `+0x292 + 4i` resume pointer (null = none), near `+0x3d2 + 2i` scene list (or 0).
- `1068:2608`: the current slot index, `-1` (`0xFFFF`) in the data segment. Set by `1048:04fc(n)`, cleared by `1048:067f` when it unloads the current slot. The tick, the script runner, and the section and node lookups work on the record of this slot.
- `1068:2606`: the index of the section the tick is running. 0 in the data segment. Only `1048:1acb` writes it (once per section, before the section's script runs) and never sets it back, so it is never `-1` and keeps the last section's index between ticks.
- `1068:460a` (the high word of `1068:4608`): the end-of-block counter. `1048:1519` adds 1 on `0x1500`, `0x1510`, and `0x1520`; only `1048:1925` reads it and clears it. The low word `1068:4608` is only a temporary for the TTM id in `1048:0079`.
- `1068:4634`: the result of the last condition chain. Only `1048:1223` writes it; `1048:1519` reads it right after.
- `1008:16c2`: the timer callback adds 1 to the 32-bit clock `1068:2e70` (low) / `2e72` (high). The clock starts at 0. Chunk 7 owns the timer rate.
- `1068:463a`, `1068:4636`, `1068:4638`: the variables of conditions `0x1380`..`0x13c1`. Nothing in the binary writes them; the data segment holds 0 in all three.
- `1048:0960`: maps a slot argument `n` (0 = the current slot, else slot `n - 1`) to an index, or `-1` when that slot is empty. Only the unreferenced setters call it.

## Nodes

- A node is the TTM side's tag record (`docs/re/ttm.md`, `Thread and record state`): `1050:04d6` makes one with `1050:042a` for every `0x1111` tag of a TTM, appended at the tail of the list `1068:263c`. Our `decodeTtm(...).tags` lists exactly those tags, in file order.
- `1048:0079`: clears `1068:263c` before loading the ADS's TTMs and stores the list in record word `+0x10` after, so the node list of an ADS is every tag of every `ADS:RES:` TTM, in resource order, then tag order.
- Node words: `[0]` TTM id, `[1]` tag, `[2]` tag page, `[3]` next page (`0xFFFF` = none), `[4]` current page, `[5]` page run this tick (`0xFFFF` = none), `[6]` self-goto flag, `[7]` ran flag (the next run of `[4]` is a replay).
- Node bytes the ADS side keeps: `+0x29` delay, `+0x2b` copy of the section state, `+0x2d` play count, `+0x2f` mode, `+0x31` plays left, `+0x33`/`+0x35` end time (32 bits), `+0x37`/`+0x39` due time (32 bits), `+0x3b` next node.
- Modes (`+0x2f`): 0 idle; 1 play once; 2 play `+0x31` more times; 3 play until the end time; 4 done; 5 hold. `1048:0db6` sets 1, 2, 3; `1048:0e6e` sets 5; `1048:0e9b` and `1048:0b3e` set 0; `1048:1acb` sets 4 (a scene ends) and 0 (one script pass after 4).
- `1048:0b3e`: does nothing for a null node. Sets the palette, BMP, and zone slots (`+0x12`, `+0x14`, `+0x16`) to 0 but not the font slot `+0x10`; `[4] = [2]`; `[3] = 0xFFFF`; foreground and background 15; `+0x1c` 0; delay, due time, plays left, play count, `[7]`, mode, `+0x2b`, `[6]` all 0; clip on; clip `(0, 0, width - 1, height - 1)` from the screen size `1068:2562`/`2564`. It does not touch `[5]` or the end time.
- `1048:0bc5`: resets every node of the current slot's list with `1048:0b3e`, in list order.
- `1048:0bf4(ttm, tag)`: the first node of the current slot's list with that TTM id and tag, or 0. TTM 0 (the walk) has no node.
- `1048:0db6`, `0e2e`, `0e6e`, `0e9b`, `0ec8`: each stores the node it found in `1068:263e` (the TTM side's current node) before acting on it.

## Sections

- `1048:04fc`: section starts, count, and tags as in `docs/re/decoders.md` (`ADS loader`): section 0 starts after the first word; every `0xFFFF` closes a section and the next one starts 4 bytes later. A section's tag is the word just before its start.
- `1048:04fc`: on the first use of a slot it also sets all 80 state words to 8 (fresh, idle) and resets every node (`1048:0bc5`). Later calls only select the slot.
- Section states (`+0x12 + 2i`, without bit 8): 0 idle, 1 running, 2 stopped, 3 restart (reset its nodes, then run), 4 start (run without reset), 5 freeze, 6 hide. Bit 8 is "fresh": the next pass starts at the section start.
- `1048:1acb`: states 3 and 4 become 1 on the section's next pass. Only state 1 runs the script.
- `1048:1acb`: the state reaches its nodes through `+0x2b`: 5 lets them replay without advancing or finishing, 6 stops them from running. No code the data reaches sets 5 or 6 (only the unreferenced `1048:0920`, `0940`, `0a33`, `0a86`).
- A stopped section (state 2) does not stop its scenes: its nodes keep `+0x2b = 2` and play on in whatever mode they have.
- `1048:1acb`: the fresh bit is cleared on the first tick for every section, whatever its state, so a state-8 section becomes 0. Only `1048:04fc` (first use) and the unreferenced `1048:0ad9` set it.
- `1048:040f`: a section's scene list is the distinct nodes named by its `0x2000`/`0x2005` instructions (the 2-word table at `1068:260a`), found with `1048:0bf4` while walking the whole section to its `0xFFFF`, including random blocks and else bodies. A name with no node is dropped. The list is zero-terminated; a section with no scenes gets 0.
- `1048:19e7(tag)`: the index of the first section of the current slot whose tag word equals `tag`, or `-1`. Also `-1` when no slot is current.
- `1048:0c30(start)`: walks from the section start with `1048:0303`. At a `0xFFFF` (or a null pointer) it returns the start; at a word `0x0005` met at an instruction start it returns the address just past it. A `0x0005` as the first word counts.
- `1048:0c30`: in the data no section has a `0x0001`, `0x0005`, or `0x0000` word at an instruction start (`re/scratch/ads/scan.py`), so it always returns the section start.
- `1048:1acb`: the loop counter `+0xb2 + 2i` and the resume pointer `+0x292 + 4i` belong to while blocks (see Blocks).

## Tick

- `1048:1acb`: returns 0 at once when no slot is current. Otherwise it makes three passes and returns 1 when any node's page ran (see pass 3), else 0.
- `1048:1acb`, pass 1: for each section in index order, it takes the state without bit 8 and, for each node of the section's scene list: when the state is 3 it resets the node (`1048:0b3e`), otherwise it copies the state into the node's `+0x2b`. A node in several lists ends with the value of the last section.
- `1048:1acb`, pass 2: for each section in index order: when bit 8 is set it clears it in the state word and starts at the section start; otherwise it starts at `1048:0c30(section start)`. A non-null resume pointer replaces the start.
- `1048:1acb`, pass 2: then state 3 or 4 is written back as 1, `1068:2606` is set to the section index, and when the start is not null and the state is 1 it runs `1048:1925(start)`. The result is ignored.
- `1048:1acb`, pass 2: a section's script can change any section's state. A section later in index order sees the change in the same pass; an earlier one on the next tick. Pass 1 has already run, so a state 3 set on a later section runs it this tick without resetting its nodes; the state is 1 by the next pass 1, so those nodes are not reset at all.
- `1048:1acb`, pass 3: for each node in list order (the list can have been reordered by `0x4000`/`0x4010` in pass 2): `[5] = 0xFFFF`; it reads `s = +0x2b` and `m = mode` once, before running anything.
- `1048:1acb`, pass 3: the node plays when `s != 6` and `m` is 1, 2, 3, or 5. It selects the node's TTM (`1050:03e2`), loads colors and clip from the node (`docs/re/ttm.md`, `ADS side`), clears the purge flag `1068:4642`, sets the delay `1068:46e6 = 0xFFFF`, and runs page `[4]` with `1050:074a`. `1058:040c` sets the goto `1068:4644 = 0xFFFF` itself.
- `1048:1acb`, pass 3: when the run returned 0, or when `s == 5`: unless `s == 5`, `[3] = [2]` and mode 4. With `s == 5` nothing changes: no `[7]`, no `[5]`, and the run does not count for the return value.
- `1048:1acb`, pass 3: the page runner returns 0 when `[4]` is past the last page (`1050:074a`). The "not run" branch does not move `[4]`, so a node that ran off its last page stays there; `0x2005` alone cannot restart it, only `0x2000`, `0x2020`, or a section restart (state 3).
- `1048:1acb`, pass 3: after a run (`s != 5`): `[7] = 1`, `[5] = [4]`, return value 1. When `46e6 != 0xFFFF` and differs from the delay `+0x29`, the delay becomes `46e6` and the due time `now + 46e6` (sign-extended, 32-bit add).
- `1048:1acb`, pass 3, no purge: a goto (`4644 != 0xFFFF`) sets `[3] = 4644`, and `[6] = 1` when it equals `[4]`. Then, unless the mode (read again, after the run) is 5, `1048:196e`; its result is ignored.
- `1048:1acb`, pass 3, purge: `[3] = [2]`. Mode 2 with plays left not 0: `1048:196e`, and when it advanced, plays left − 1. Mode 3 with an end time not 0: `1048:196e`. Any other mode (1, 2 with none left, 3 with end time 0, 5): `1048:196e`, and when it advanced, mode 4 and delay 0.
- `1048:1acb`, pass 3: so a page with a purge is replayed until its delay is due, then the node moves to its tag page; in modes 1 and 2 (none left) that is when it becomes mode 4.
- `1048:1acb`, pass 3: when the node does not play (`s == 6` or `m` is 0 or 4): when `s` is not 5 or 6 and `m == 4`, mode 0. So mode 4 lasts from the tick a scene ends through the next tick's pass 2, where conditions see it.
- `1048:1acb`, pass 3: last, for every node, when `m == 3` (the mode before the run) and the end time is `<=` now (32-bit unsigned, high word first), mode 4. This runs whether the node played or not.
- `1048:1acb`: after all nodes: `1050:0799` (the pending palette becomes active), clip on, clip `(0, 0, width - 1, height - 1)`.

## Page advance

- `1048:196e(node)`: with delay `+0x29 == 0` it always advances. Otherwise it returns 0 while now `<` the due time (32-bit unsigned, high word first); when due, the due time becomes `now + delay` (delay sign-extended) and it advances.
- `1048:196e`: advancing clears `[7]`, then moves `[4]` to `[3]` and sets `[3] = 0xFFFF` when `[3]` is set, or adds 1 to `[4]` when it is not. Returns 1.
- `1048:196e`: it is the only place that clears `[7]`, so a page runs once as a first run, then as a replay on every tick until its delay is due.

## Script runner

- `1048:1925(p)`: loops: returns 0 when the word at `p` is `0xFFFF`; runs `p = 1048:1519(p)`; when the end-of-block counter is set it clears it and returns `p` (which can be 0); when `p` is null it returns 0. It does not check `p` for null before the first read.
- `1048:1519(p)`: returns 0 for a null `p`. Looks the word up in the 44-entry table at `1048:1875` (cases in `re/out/jump-tables.tsv`, jump `1048:1554`); a word not in the table returns 0.
- `1048:1519`: `0x0001` and `0x0005` return `p + 2`. `0xFFFF` returns 0.
- `1048:1519`: `0x1500` (else, reached at the end of a true body) skips to the end of the else body with `1048:106b(p + 2)`, adds 1 to the counter, and returns that address. No script uses `0x1500`.
- `1048:1519`: `0x1510` (end if, 584 uses) adds 1 to the counter and returns `p`. `0x1520` (end while, 1 use) adds 1 and returns 0.
- `1048:1519`: `0x2000` (`1048:0e2e`) and `0x2005` (`1048:0db6`) take `(arg0, arg1, arg2)` and return `p + 10`; arg 3, the random weight, is not passed.
- `1048:1519`: `0x2010` (`1048:0e9b`), `0x2015` (`1048:0e6e`), `0x2020` (`1048:0ec8`), `0x4000` (`1048:0f8c`), `0x4010` (`1048:0ef2`) take `(arg0, arg1)` and return `p + 8`; arg 2, the random weight, is not passed.
- `1048:1519`: `0x3010` returns `1048:0cda(p + 2)`. `0x1420`, `0x1430`, and `0x3020` return 0 (they only mean something inside a condition chain or random block). `0x30FF` is not in the table, so it returns 0 too.
- `1048:1519`: `0x1310`..`0x13c1` are if blocks and `0x1010`..`0x1080` while blocks (see Blocks). `0xF000`, `0xF010`, `0xF200`, `0xF210`: see Section control.
- A section's pass is one `1048:1925` from its start: it ends at the section's `0xFFFF`, at an instruction that returns 0, or at a top-level `0x1500`/`0x1510`/`0x1520`.

## Blocks

- `1048:1519`, if (`0x1310`..`0x13c1`, case `1048:1758`): `q = 1048:1223(p)`. When `1068:4634` is set, `r = 1048:1925(q)` (runs the body); otherwise `r = 1048:11db(q)`. Returns `r + 2` when `r` is not null, else 0.
- `1048:1519`, if: a true body ends at its `0x1510` (the counter stops `1048:1925` there) and the if returns the address after it. A body that hits `0xFFFF` or an instruction returning 0 makes the if return 0, which ends the enclosing block.
- Every if block of a running section is checked again on every tick: the script re-runs from the section start each pass, and nothing remembers that a body already ran. Scripts guard bodies with conditions on the scenes they start (`0x1330` play count 0, `0x1350` done).
- `1048:106b(p, depth)`: walks forward with `1048:0303`. A 0 word returns 0 (checked before the null check, so a null `p` is read). `0x1500` or `0x1510` returns its address. `0xFFFF` returns 0. A null next pointer returns 0.
- `1048:106b`: a nested if (`0x1310`..`0x13c1`, the 18-entry table at `1048:1142`) is stepped over: its condition chain through `1048:1223` (which also evaluates it and overwrites `1068:4634`), its body with `1048:106b`, an else body with `1048:106b(r + 2)` when the body ended at `0x1500`, then one instruction (the closing `0x1510`). While opcodes `0x10xx` are not in the table, so they are not treated as nesting. `depth` is counted but never read.
- `1048:11db(q)`: `r = 1048:106b(q)`; when `r` is at `0x1500`, `r = 1048:1925(r + 2)` (runs the else body, which ends at its `0x1510`). Returns `r`.
- `1048:1519`, while (`0x1010`..`0x1080`, case `1048:17a0`): `q = 1048:1223(p)`. When true: the section's loop counter + 1, its resume pointer = `p` (the while instruction), `1048:1925(q)`, and returns 0. When false: counter 0, resume null, returns `1048:118a(q) + 2`.
- `1048:1519`, while: a true while ends the section's pass, and the next pass starts at the while itself, skipping whatever came before it in the section (including an enclosing if). A false while clears the resume pointer, so the pass after it starts at the section start again.
- `1048:1519`, while: when `1048:118a` returns null the false branch still adds 2, giving a non-null far pointer `0000:0002`.
- `1048:118a(q)`: walks forward with `1048:0303`: a 0 word or `0xFFFF` returns 0; `0x1520` returns its address; a null next pointer returns 0. It does not step over nested blocks.
- `ACTIVITY.ADS`, section tag 7: the only while block. At byte 2006, `if 0x1350 4 10` (scene 4:10 done): a random block picks one of three `0x2005 4 5 n` (n = 2, 3, 4); then at byte 2046 `0x1070 4 5` with an empty body (`0x1520` at byte 2052) waits while scene 4:5 plays; then `0x2005 4 22 0` and the `0x1510` at byte 2064 that ends the if.
- `ACTIVITY.ADS`, tag 7: while 4:5 plays, each pass resumes at byte 2046, so the random pick and the `0x1350 4 10` test are not repeated. When it stops, the pass adds 4:22, and the `0x1510` at byte 2064 is now top-level, so it ends the pass; the next pass starts at the section start.

## Conditions

- `1048:1223(p)`: evaluates the condition at `p`, steps past it with `1048:0303`, and looks at the next instruction. Not `0x1420`/`0x1430`: the chain ends.
- `1048:1223`: joining rules, with `c` the running result: `c` true and `0x1430` (or): remember "an or was true" and skip the next condition. `c` true and `0x1420` (and): `c` = the next condition. `c` false and `0x1430`: `c` = the next condition. `c` false and `0x1420`: skip the next condition, `c` stays false.
- `1048:1223`: at the end `1068:4634 = c`, or 1 when an or was true. It returns the address after the chain. A null next pointer returns 0 and leaves `4634` as it was.
- `1048:1223`: so `A or B and C` is `A or (B and C)` when A is false, and true when A is true (B is skipped, C is evaluated but the remembered or wins).
- `1048:1223`: for every opcode except `0x1080` and `0x1380`..`0x13c1` it first looks up `node = 1048:0bf4(arg0, arg1)`. An opcode not in the 23-entry table at `1048:14bd` (cases in `re/out/jump-tables.tsv`, jump `1048:12ab`) is false.
- Scene conditions (`0x10xx` and `0x13xx` share a low byte and a test): `0x10` node in mode 5; `0x20` no node or mode not 5; `0x30` no node or play count 0; `0x40` node with play count not 0; `0x50` node in mode 4; `0x60` no node, or mode 0 or 4; `0x70` node in mode 1, 2, or 3.
- `1048:1223`, `0x1080 n`: the current section's loop counter `<= n` (signed, `JG`).
- `1048:1223`, `0x1380 n`: `[463a] <= n`; `0x1390 n`: `[463a] >= n` (both signed, `JLE`/`JGE`).
- `1048:1223`, `0x13a0`/`0x13a1 n`: `var <= n`; `0x13b0`/`0x13b1 n`: `var >= n`; `0x13c0`/`0x13c1 n`: `var == n`; all unsigned (`JBE`, `JNC`, `JZ`), with `var` = `[4636]` for `xx0` and `[4638]` for `xx1`. With every variable 0: `0x1380` is true for `n >= 0` (signed), `0x1390` for `n <= 0` (signed), `0x13a0`/`0x13a1` always, `0x13b0`..`0x13c1` only for `n == 0`.
- Data: the scripts use only `0x1070` (1, the while), `0x1330` (55), `0x1350` (500), `0x1360` (76), `0x1370` (30), with `0x1420` (47) and `0x1430` (30).
- `FISHING.ADS`: every section starts with `0x1330 ttm tag` (the first scene was never played) whose body adds scenes and ends at `0x1510`; later blocks test `0x1350` chains (a scene is done); the last block stops the section with `0xF010 0xFFFF`.

## Scene operations

- `1048:0db6(ttm, tag, n)` (`0x2005`, 867 uses): no node, nothing. `n == 0`: mode 1. `n < 0` (signed): mode 3, end time `now - n` (`n` sign-extended, 32-bit). `n > 0`: mode 2, plays left `n - 1`. Then play count + 1. It does not touch the page, `[3]`, `[7]`, or the delay, so adding a scene that is playing only changes its mode and count.
- `1048:0e2e(ttm, tag, n)` (`0x2000`, no uses): `[4] = [2]` (back to the tag page), then `1048:0db6`.
- `1048:0e6e(ttm, tag)` (`0x2015`, no uses): mode 5.
- `1048:0e9b(ttm, tag)` (`0x2010`, 111 uses): mode 0. The node's page and flags stay as they are.
- `1048:0ec8(ttm, tag)` (`0x2020`, no uses): resets the node (`1048:0b3e`).
- `1048:0f8c(ttm, tag)` (`0x4000`, 4 uses): unless the node is already the tail, unlinks it (from the head or after its predecessor) and appends it at the tail. Uses `1068:4606`/`4604` as temporaries.
- `1048:0ef2(ttm, tag)` (`0x4010`, no uses): when the node is not the head, unlinks it and puts it at the head. A node that is the head stays.
- Nodes run in list order in pass 3 and each draws over what earlier ones drew, so `0x4000` puts a scene on top and `0x4010` beneath.
- `BUILDING.ADS`, sections tag 7 (bytes 3110, 3136) and tag 8 (bytes 3834, 3860): `if 0x1350 3 43 { 0x4000 3 44 1; 0x2005 3 44 0 1 }` and `if 0x1350 3 44 { 0x4000 3 44 1; 0x2005 3 44 0 1 }`: when scene 3:43 or 3:44 is done, 3:44 is moved on top and played once more.

## Random

- `1048:0cda(p)` (after `0x3010`, 77 uses): first walks from `p` with `1048:0303` to the `0x30FF`, summing the weights; a null pointer on the way returns 0. With a total of 0 it returns the address past the `0x30FF`.
- `1048:0c8d(p)`: an instruction's weight is its word at byte `+8` for `0x2000`/`0x2005` (arg 3), `+2` for `0x3020` (arg 0), and `+6` for anything else (arg 2, right for `0x2010`..`0x4010`).
- `1048:0cda`: `k = abs(int16(rand % total)) + 1`, with `rand` from `1018:1e60` and an unsigned 16-bit remainder. For any total this is in `1..total`.
- `1048:0cda`: walks again from `p`, subtracting each weight from `k`, and stops at the first instruction that makes `k < 1`. It runs that instruction with `1048:1519` (result ignored) unless it is `0x3020` (17 uses, a weighted "do nothing"), then returns the address past the `0x30FF`.
- `1048:0cda`: one call to `1018:1e60` per random block run with a non-zero total. The TTM side (`0x2022`) draws from the same source.

## Section control

- `1048:1519`, `0xF000` (no uses): when `1068:2606 == -1` returns 0; otherwise the current section's state word becomes 2 (bit 8 dropped, resume pointer kept) and it returns 0. `2606` is never `-1` (see Record and slots), so the first branch is dead.
- `1048:1519`, `0xF010 t` (67 uses): the section is the current one when `t == 0xFFFF`, else `1048:19e7(t)`. When found, its state word becomes 2 (bit 8 dropped, resume pointer kept). Returns 0 when that index equals `1068:2606` (it stopped itself), else `p + 4`.
- `1048:1519`, `0xF010`: a tag with no section gives `-1`, which never equals `2606`, so it returns `p + 4` and the pass goes on.
- `1048:1519`, `0xF200 t` (12 uses): when the section exists, state = `(state & 8) | 4`; the resume pointer is kept. Returns `p + 4`.
- `1048:1519`, `0xF210 t` (no uses): as `0xF200` with state 3.
- `1048:0805(slot index, tag, state)`: finds the section with `1048:19e7` (in the current slot), clears its resume pointer and sets state = `(state & 8) | value` in the record of the given slot index.
- `1048:08b4(slot index, tag, state)`: as `1048:0805`, but sets the state word to the value whole, and only when it is not exactly 8 (a fresh idle section is left alone). The resume pointer is cleared either way.
- `1048:0874(tag)`: `1048:0805(current slot, tag, 3)`: the story's start of a section.

## Story interface

Read for the interface; chunk 7 owns `1018`.

- `1018:06bf`: when the queue entry's ADS id (byte `+0x0f`) is `-1` (a walk entry), it never calls `1048:1acb` or `1048:0766`.
- `1018:06bf`: on the first step of an ADS entry (flag `0x8000` of word `+0x0d` set) it calls `1018:0c62(id)`, `1048:04fc(slot + 1)`, and `1048:0874(tag)` (byte `+0x10`), then clears the flag.
- `1018:06bf`: on every step of an ADS entry, the first one included: `1048:04fc(slot + 1)`, `1048:1acb`, `1048:0766(tag)`. When `1048:0766` returns 0 the entry ends and the queue moves on.
- `1018:0c62(id)`: keeps one loaded ADS per file in the table `1068:166e` and unloads the previous file (`1018:0d11`) only when the id differs from the last one asked for. A scene from the same ADS as the one before reuses the loaded record, with its section states and nodes as the last scene left them; only the started section's state is set to 3 (its scene list's nodes reset in pass 1).
- `1048:0766(tag)`: 0 when the tag has no section. 1 when the section's state without bit 8 is 1 or 4. Otherwise 1 when a node of its scene list has a mode other than 0 and 4 and its self-goto flag `[6]` (`+0x0c`) is 0; else 0.
- `1048:0766`: so a scene ends only after its section stopped (state 2, through `0xF010`/`0xF000`) and every scene of the section is idle, done, or looping on itself through a goto to its own page. A self-looping node keeps playing after the scene ends.
- `1048:0766`: a state 3 does not count as busy, but the tick turns it into 1 before `1048:0766` runs.

## Loading and unloading

- `1048:0079`: the load itself, as in `docs/re/decoders.md` (`ADS loader`). Every listed TTM is loaded at once through `1048:0044`; when one fails, the load fails and calls `1048:001b`, which unloads every ADS slot and every TTM, not only this ADS (OQ-13).
- `1048:0079`: it does not select the new slot or index its sections; the first `1048:04fc(slot + 1)` does that.
- `1048:0044`: loads one TTM and stores its id (`docs/re/decoders.md`, `TTM loader`).
- `1048:067f(n)`: `n` is slot + 1, or 0 for the current slot. For a loaded slot it makes the slot's lists current (`1068:263c`, `2634`/`2636`), unloads every TTM and node on them (`1050:07c6`), frees the 80 scene lists, the bytecode, and the record, empties the slot, and sets `1068:2608 = -1` when it was the current slot.
- `1048:001b`: `1048:067f(n)` for slots 1 to 10, then `1050:07c6`. Called by `1048:0000`, by `1048:0079` on failure, and from `1008:159a`.
- `1048:0000`: `1048:001b`, then `1050:0152` (sets up the dirty-rect pool); returns 1. Called once from `1008:154d`.

## Unreferenced

No call in `re/out/index.tsv` and no relocation in `re/out/relocations.tsv` reaches these. The relocations into segment 10 only target `1048:0000`, `001b`, `0079`, `04fc`, `067f`, `0766`, `0874`, and `1acb`.

- `1048:0894(tag)`: `1048:0805(current slot, tag, 4)`.
- `1048:0920(tag)`: `1048:08b4(current slot, tag, 6)`.
- `1048:0940(tag)`: `1048:08b4(current slot, tag, 5)`.
- `1048:0993(n)`: for `t` from 1 to the slot's section count, `1048:0805(slot, t, 3)`. It passes the numbers as tags, so it reaches the sections whose tags are 1 to the count, not every section.
- `1048:09e3(n)`: as `1048:0993` with state 4.
- `1048:0a33(n)`: for `t` from 1 to slot `n`'s section count, `1048:08b4(current slot, t, 6)`.
- `1048:0a86(n)`: as `1048:0a33` with state 5.
- `1048:0ad9(n)`: for `t` from 1 to the slot's section count, `1048:08b4(slot, t, 8)`; then resets every node of that slot (`1048:0bc5` with the slot made current for the call).
- `1048:1aaf(out)`: sets the iterator `1068:4602` to 0, then `1048:1a4b(out)`.
- `1048:1a4b(out)`: when the iterator is below the current slot's section count, stores that section's tag in `out`, moves on, and returns 0; otherwise returns 1.
- `1048:1e5a`: re-runs page `[5]` of every node with `[5] != 0xFFFF` (those that ran this tick) as a replay, loading the globals as `1048:1acb` does, then resets the clip and clears `1068:263e`.

## Emulated

- `scripts/re/unicorn/original_ads.py` (`AdsTracer`) loads each ADS with `1048:0079` and runs `1048:04fc`, `1048:0874`, then per tick `1048:04fc`, `1048:1acb`, `1048:0766` with the clock `1068:2e70` set before each tick. The page runner `1050:074a` is the original one, with the chunk 5 recorders in place of its drawing, loading, sound, and random callees. Rows: `re/fixtures/ads/traces.tsv` (format in `docs/plans/2026-10-18-re-ads/step-000-overview.md`, `Trace format`).
- The dump covers 66 sections in 10 files: 85,212 rows (plus the header). The tick limit is 2000. The whole dump took 4 min 50 s; the slowest section (`BUILDING.ADS` tag 7) took 17 s.
- 65 runs ended because `1048:0766` returned 0. One reached the tick limit: `ACTIVITY.ADS` tag 6.
- `ACTIVITY.ADS`, tag 6: the last block is a random pick between `0x2005 4 22` (weight 2) and `0x2005 4 21` (weight 1), and only a playing 4:21 reaches the `0xF010 0xFFFF` that stops the section. With the trace's random source (`1048:0cda`) every pick is 4:22, which restarts the cycle, so the section stays in state 1 for all 2000 ticks. Nothing else in the section stops it.
- `STAND.ADS`, tag 14: ends after one tick. Its pass starts 1:42 and stops the section (state 2) in the same pass; 1:42's tag page ends with a purge and no delay, so `1048:1acb` makes it mode 4 at once and `1048:0766` returns 0 on tick 0.
- No run faulted or reached an unstubbed import.
- `src/ads/tick.data.test.ts` runs `traceAdsSection` (`src/testing/ads-trace.ts`) on every section and finds no difference with `re/fixtures/ads/traces.tsv`: all 66 sections, every row. The port matched on the first run, so no fix was needed. Changing `1048:196e`'s due check from `<` to `<=` breaks 64 of the 66 sections, so the comparison does catch timing errors.

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1048:0000` | `ads_init` | none (nothing to free in JavaScript) | match |
| `1048:001b` | `ads_unloadAll` | none (the scheduler state is dropped with the scene) | open |
| `1048:0079` | `ads_loadAds` | `src/ads/state.ts:67` `makeAdsState` (all-or-nothing TTM load) | fixed |
| `1048:0303` | `ads_nextInstruction` | `src/decode/ads-bytecode.ts:12` (`adsArgCount`), `src/ads/state.ts:150` `nextInstruction` | fixed |
| `1048:040f` | `ads_sectionSceneIds` | `src/ads/state.ts:155` `sectionScenes` | fixed |
| `1048:04fc` | `ads_indexSections` | `src/decode/ads-bytecode.ts:18` (`indexAdsSections`); the scheduler still scans on its own: OQ-11 | open |
| `1048:067f` | `ads_unload` | none (the scheduler state is dropped with the scene) | open |
| `1048:0766` | `ads_sectionBusy` | `src/ads/tick.ts:21` `adsSectionBusy` | fixed |
| `1048:0805` | `ads_setSectionState` | `src/ads/tick.ts:13` `adsStartSection` | fixed |
| `1048:0874` | `ads_startSection` | `src/ads/tick.ts:13` `adsStartSection` | fixed |
| `1048:0894` | `ads_resumeSection` | none (unreferenced) | match |
| `1048:08b4` | `ads_setSectionStateUnlessFresh` | none (only unreferenced callers) | match |
| `1048:0920` | `ads_hideSection` | none (unreferenced) | match |
| `1048:0940` | `ads_freezeSection` | none (unreferenced) | match |
| `1048:0960` | `ads_slotIndex` | none (only unreferenced callers) | match |
| `1048:0993` | `ads_restartAllSections` | none (unreferenced) | match |
| `1048:09e3` | `ads_startAllSections` | none (unreferenced) | match |
| `1048:0a33` | `ads_hideAllSections` | none (unreferenced) | match |
| `1048:0a86` | `ads_freezeAllSections` | none (unreferenced) | match |
| `1048:0ad9` | `ads_resetAllSections` | none (unreferenced) | match |
| `1048:0b3e` | `ads_resetThread` | `src/ads/state.ts:118` `resetNode` | fixed |
| `1048:0bc5` | `ads_resetAllNodes` | `src/ads/state.ts:67` `makeAdsState` (`nodes.forEach(resetNode)`) | fixed |
| `1048:0bf4` | `ads_findNode` | `src/ads/state.ts:138` `findNode` | fixed |
| `1048:0c30` | `ads_sectionResumePoint` | `src/ads/script.ts:118` `sectionResumePoint` | fixed |
| `1048:0c8d` | `ads_randomWeight` | `src/ads/script.ts:297` `randomWeight` | fixed |
| `1048:0cda` | `ads_randomBlock` | `src/ads/script.ts:276` `randomBlock` | fixed |
| `1048:0db6` | `ads_addScene` | `src/ads/script.ts:238` `addScene` | fixed |
| `1048:0e2e` | `ads_restartScene` | `src/ads/script.ts:254` `restartScene` | fixed |
| `1048:0e6e` | `ads_holdScene` | `src/ads/script.ts:261` `setMode` | fixed |
| `1048:0e9b` | `ads_stopScene` | `src/ads/script.ts:261` `setMode` | fixed |
| `1048:0ec8` | `ads_resetScene` | `src/ads/script.ts:54` `runInstruction` (`RESET_SCENE`) | fixed |
| `1048:0ef2` | `ads_drawFirst` | `src/ads/script.ts:266` `moveNode` | fixed |
| `1048:0f8c` | `ads_drawLast` | `src/ads/script.ts:266` `moveNode` | fixed |
| `1048:106b` | `ads_skipBlock` | `src/ads/script.ts:158` `skipBlock` | fixed |
| `1048:118a` | `ads_whileEnd` | `src/ads/script.ts:147` `whileEnd` | fixed |
| `1048:11db` | `ads_skipFalseBlock` | `src/ads/script.ts:173` `skipFalseBlock` | fixed |
| `1048:1223` | `ads_evalConditions` | `src/ads/script.ts:179` `evalConditions`, `src/ads/script.ts:208` `conditionHolds`, `src/ads/script.ts:228` `storyValueHolds` | fixed |
| `1048:1519` | `ads_runInstruction` | `src/ads/script.ts:54` `runInstruction`, `src/ads/script.ts:125` `ifBlock`, `src/ads/script.ts:132` `whileBlock`, `src/ads/script.ts:304` `startSection` | fixed |
| `1048:1925` | `ads_runBlock` | `src/ads/script.ts:41` `runBlock` | fixed |
| `1048:196e` | `ads_advancePage` | `src/ads/tick.ts:34` `advancePage` | fixed |
| `1048:19e7` | `ads_sectionIndex` | `src/ads/state.ts:142` `sectionIndex` | fixed |
| `1048:1a4b` | `ads_nextSectionTag` | none (unreferenced) | match |
| `1048:1aaf` | `ads_firstSectionTag` | none (unreferenced) | match |
| `1048:1acb` | `ads_tick` | `src/ads/tick.ts:49` `adsTick`, `src/ads/tick.ts:68` `runSection`, `src/ads/tick.ts:82` `playNode` | fixed |
| `1048:1e5a` | `ads_redrawThreads` | none (unreferenced) | match |
