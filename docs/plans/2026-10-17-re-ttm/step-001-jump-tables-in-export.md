# Step 1: Jump Tables in the Export

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** none

**Files:**

- Create: `scripts/re/jump-tables.json`, `scripts/re/ghidra/ApplyJumpTables.java`
- Modify: `scripts/re/ghidra-import.sh`, `scripts/re/export.data.test.ts`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated), `docs/re/README.md`

**Interfaces:**

- Consumes: `scripts/re/ghidra-import.sh` (runs `analyzeHeadless` with post-scripts `ApplyNames.java <names.json>` then `ExportFunctions.java <re/out>`); `ApplyNames.java` creates a function at any `names.json` address that has none; `ExportFunctions.java` writes `re/out/functions/<ssss>_<oooo>_<name>.{c,asm}` from each function's body, plus `index.tsv`. The jump table list in the overview, `Missing case code`.
- Produces: `re/out/jump-tables.tsv` with header `jump	index	value	target` (one row per table entry, `value` as 4 lowercase hex digits, addresses as `ssss:oooo`); every case block inside the `.asm` (and, where Ghidra manages, the `.c`) of the function that jumps to it; `names.json` entries (status `named`) for every function in the overview's `Function scope of this chunk` plus the read-for-interface functions.

## Part A: Apply the jump tables in Ghidra

- [x] **Action 1: Write the table list**

Create `scripts/re/jump-tables.json`:

```json
{
  "tables": [
    { "jump": "1048:0354", "values": "1048:0383", "count": 35 },
    { "jump": "1048:10a8", "values": "1048:1142", "count": 18 },
    { "jump": "1048:12ab", "values": "1048:14bd", "count": 23 },
    { "jump": "1048:1554", "values": "1048:1875", "count": 44 },
    { "jump": "1058:0031", "values": "1058:00fc", "count": 18 },
    { "jump": "1058:0175", "values": "1058:03bc", "count": 20 },
    { "jump": "1058:059b", "values": "1058:138d", "count": 4 },
    { "jump": "1058:0602", "values": "1058:1379", "count": 5 },
    { "jump": "1058:06a5", "values": "1058:12bd", "count": 47 },
    { "jump": "1058:1088", "values": "1058:1275", "count": 18 },
    { "jump": "1058:1561", "values": "1058:1900", "count": 8 }
  ]
}
```

Check each row against the assembly before going on: in `re/out/functions/*.asm`, the instructions just before each `jump` address are `MOV CX,<count>` and `MOV BX,<values offset>`, and the jump itself is `JMP word ptr CS:[BX + <2 × count>]`.

Run: `rg -n -B8 "JMP word ptr CS:\[BX \+ 0x" re/out/functions/1048_*.asm re/out/functions/1058_*.asm`
Expected: eleven jumps, each matching one row.

- [x] **Action 2: Write the failing test**

Add to the `describe` block of `scripts/re/export.data.test.ts` (after `exports one relocation per NE relocation record`):

```ts
  it('puts every jump table case in the function that jumps to it', () => {
    const filesWith = new Map<string, Set<string>>();
    for (const file of readdirSync(OUT + 'functions').filter((f) => f.endsWith('.asm'))) {
      for (const line of readFileSync(OUT + 'functions/' + file, 'utf8').split('\n')) {
        const address = line.slice(0, 9);
        if (!/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(address)) continue;
        if (!filesWith.has(address)) filesWith.set(address, new Set());
        filesWith.get(address)!.add(file);
      }
    }
    const rows = readTsv('jump-tables.tsv');
    expect(rows).toHaveLength(240);
    expect(rows.find((row) => row.jump === '1058:06a5' && row.index === '0')).toMatchObject({ value: '0010', target: '1058:0a78' });
    expect(rows.find((row) => row.jump === '1058:1088' && row.index === '13')).toMatchObject({ value: 'a601', target: '1058:1158' });
    const wrong = rows.filter((row) => {
      const jumpFiles = filesWith.get(row.jump!) ?? new Set<string>();
      return ![...(filesWith.get(row.target!) ?? [])].some((file) => jumpFiles.has(file));
    });
    expect(wrong.map((row) => `${row.jump} -> ${row.target}`)).toEqual([]);
  });
```

- [x] **Action 3: Run it to make sure it fails**

Run: `fnm use`, then `pnpm exec vitest run scripts/re/export.data.test.ts`
Expected: the new test fails (no `re/out/jump-tables.tsv`); the others pass.

- [x] **Action 4: Write the Ghidra script**

Create `scripts/re/ghidra/ApplyJumpTables.java`:

```java
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.listing.Function;
import ghidra.program.model.pcode.JumpTable;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class ApplyJumpTables extends GhidraScript {
  @Override
  public void run() throws Exception {
    Path tables = Path.of(getScriptArgs()[0]);
    Path out = Path.of(getScriptArgs()[1]);
    List<String> rows = new ArrayList<>(List.of("jump\tindex\tvalue\ttarget"));
    for (JsonElement element : JsonParser.parseString(Files.readString(tables)).getAsJsonObject().getAsJsonArray("tables")) {
      JsonObject table = element.getAsJsonObject();
      Address jump = toAddr(table.get("jump").getAsString());
      Address values = toAddr(table.get("values").getAsString());
      int count = table.get("count").getAsInt();
      Function function = getFunctionContaining(jump);
      if (function == null) {
        println("JCR_FAIL no function contains jump " + jump);
        continue;
      }
      int segment = ((SegmentedAddress) jump).getSegment();
      ArrayList<Address> targets = new ArrayList<>();
      for (int i = 0; i < count; i++) {
        int value = getShort(values.add(2L * i)) & 0xffff;
        int offset = getShort(values.add(2L * count + 2L * i)) & 0xffff;
        Address target = toAddr(String.format("%04x:%04x", segment, offset));
        new DisassembleCommand(target, null, true).applyTo(currentProgram, monitor);
        currentProgram.getReferenceManager().addMemoryReference(jump, target, RefType.COMPUTED_JUMP, SourceType.USER_DEFINED, 0);
        targets.add(target);
        rows.add(jump + "\t" + i + "\t" + String.format("%04x", value) + "\t" + target);
      }
      new JumpTable(jump, targets, true).writeOverride(function);
      CreateFunctionCmd.fixupFunctionBody(currentProgram, function, monitor);
    }
    Files.write(out.resolve("jump-tables.tsv"), rows);
  }
}
```

If a Ghidra API name does not compile (the log shows `Script Exception` or a compile error), look the class up in `$GHIDRA_INSTALL_DIR/docs/GhidraAPI_javadoc.zip` (or with `unzip -l` on it) and fix the call; keep the behavior: disassemble every target, add a computed-jump reference from the jump to it, write a jump-table override on the function, then grow the function body over the new code.

- [x] **Action 5: Run it from the import**

In `scripts/re/ghidra-import.sh`, add a post-script between `ApplyNames.java` and `ExportFunctions.java`:

```bash
  -postScript ApplyNames.java "$repo/scripts/re/names.json" \
  -postScript ApplyJumpTables.java "$repo/scripts/re/jump-tables.json" "$out_dir" \
  -postScript ExportFunctions.java "$out_dir" \
```

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to /Users/gil/dev/jc-reborn-web/re/out`.

Run: `rg -c "^1058:06a9" re/out/functions/1058_040c_*.asm`
Expected: `1` (the `0x2002` case is now part of the function).

Run: `pnpm exec vitest run scripts/re/export.data.test.ts`
Expected: all pass. If `decompiles at least 95% of functions` now fails, the override broke the decompiler for some function: list the failures with `rg -l "DECOMPILE_FAILED" re/out/functions`, and drop the override (keep the disassembly, the reference, and the body fix) for the tables whose functions fail.

Open `re/out/functions/1058_040c_*.c` and check whether the decompiler now shows the cases (a `switch` with numbered cases). Either way the assembly is the reference; note in Action 8 which functions decompile with their cases.

- [x] **Action 6: Commit**

```bash
git add scripts/re/jump-tables.json scripts/re/ghidra/ApplyJumpTables.java scripts/re/ghidra-import.sh scripts/re/export.data.test.ts
git commit -m "feat(re): export the switch cases Ghidra cannot follow"
```

## Part B: Names

- [x] **Action 7: Name every function in scope**

Add these entries to `scripts/re/names.json`, each with `"status": "named"`, `"signature": null`, `"callingConvention": null`, in address order among the existing entries. Read each function in `re/out/functions/` (now with its cases) before adding it; if the note below is wrong, write what the code does instead. `ApplyNames.java` creates the functions at `1050:0000`, `1058:13a9`, and `1058:197c`, which Ghidra did not find.

| Address | Name | Note |
| --- | --- | --- |
| `1000:195a` | `rtl_strcpy` | Near strcpy(dst, src); returns dst |
| `1010:00fc` | `story_setTtmOffset` | Sets the TTM island offset 1068:46e4/46e2 from the island position (1068:30c4 + 1, or + 0x111 when the argument is set; 1068:30c2); both 0 when 1068:30b2 is 2 |
| `1018:1e60` | `story_random` | Additive lagged-Fibonacci generator over the 56-word table at 1068:1ce8 (indices 1068:1ce4 and 1068:1ce6); returns the new word |
| `1030:07c3` | `gfx_selectFontStub` | Empty: returns 1; the TTM font and text opcodes call it with a font handle |
| `1030:07d4` | `gfx_deleteFontStub` | Empty: returns DS; TTM opcodes 0x0090 and 0xf04f and 1050:080c call it with a font handle |
| `1040:0c13` | `gfx_paletteLevelStub` | Empty: returns DS; the TTM palette fade opcodes call it |
| `1040:0c21` | `gfx_paletteCycleStub` | Empty: returns 0; TTM opcodes 0x0400 and 0x2402 reach it |
| `1040:0c31` | `gfx_paletteEmptyStub` | Empty: returns DS; nothing calls it |
| `1048:0b3e` | `ads_resetThread` | Resets a thread node: slots 0, page = tag page, no next page, colors 15, delay 0, clip on over the whole screen |
| `1048:196e` | `ads_advancePage` | When the thread's delay is due (or 0): next due time = now + delay, clears the ran flag, moves to the next page or the goto page; returns 1, else 0 |
| `1048:1acb` | `ads_tick` | One ADS tick: runs every active thread's current page, applies delay, goto and purge, then activates the pending palette and resets the clip |
| `1048:1e5a` | `ads_redrawThreads` | Re-runs the last page of every thread with the ran flag set; no direct caller found |
| `1050:0000` | `ttm_measureSlotImages` | Stores the widest image of the thread's BMP slot in 1068:463c and clears 1068:463e; TTM opcode 0xb000 |
| `1050:0061` | `ttm_scrollSlotImages` | Draws the BMP slot's images stacked upward from 1068:463e, marks them dirty, advances the scroll, and raises the purge flag when none was drawn; TTM opcode 0xb013 |
| `1050:0152` | `ttm_initDirtyPool` | Grows the dirty-rect pool by 100 nodes; sets 1068:2641 to 2 in color mode 12 |
| `1050:074a` | `ttm_runPageChecked` | Runs page n of the current TTM with 1058:040c when the page exists; returns 0 otherwise |
| `1050:0799` | `ttm_activatePendingPalette` | Makes the pending palette 1068:4646 active and clears it |
| `1050:07c6` | `ttm_unloadAll` | Unloads every TTM (1050:080c) and frees every thread node |
| `1050:080c` | `ttm_unload` | Frees one TTM record: matrix, fonts, bitmaps (not the shared walk list), palettes, zone buffers, page table, bytecode |
| `1050:0a6e` | `ttm_shutdown` | Frees the dirty-rect pool and unloads every TTM |
| `1050:0a85` | `ttm_markDrawn` | Marks a drawn rect dirty: B to A at ages 0 and 1, and C to B at age 0 unless 1068:27c0 is set |
| `1050:0b31` | `ttm_screenToBackground` | Sets 1068:4640, copies all of B into C, drops the C-to-B dirty list |
| `1050:0b74` | `ttm_copyToBackground` | Copies a rect of B into C, keeping the copy source and draw target |
| `1058:0000` | `ttm_soundOpcode` | Dispatches 0xCxxx opcodes: 0xc051 plays a sample, the rest reach return-0 stubs or copy strings |
| `1058:0144` | `ttm_drawOpcode` | Dispatches 0xAxxx opcodes to the primitives, sprites, effects (1058:1510) and text |
| `1058:040c` | `ttm_runPage` | Runs one TTM page until 0x0FF0: frames each instruction, applies offsets, dispatches, marks drawings dirty |
| `1058:13a9` | `ttm_pageOfTag` | Returns the first page whose first instruction is 0x1101 or 0x1111 with the tag, or 0xFFFF |
| `1058:141f` | `ttm_copyStringArg` | Copies a string argument (or n bytes) into 1068:464a and returns it |
| `1058:147a` | `ttm_fontSlotPointer` | Returns a pointer to the thread's font handle in the TTM record (+0x18) |
| `1058:14a8` | `ttm_paletteRangeEffect` | Calls the empty 1040:0c21 for a color range stored by opcodes 0x2302..0x2322 |
| `1058:14e0` | `ttm_surfaceByNumber` | Maps 0 to A, 1 to B, 2 to C, anything else to B |
| `1058:1510` | `ttm_effectOpcode` | Runs the 0xa014..0xa094 and 0xa0b5 effects with target A: zone 0 save and restore, slides, strips, wipes |
| `1058:1920` | `ttm_effectPause` | Calls 1058:1949 with an empty rect 100 times (a busy wait) |
| `1058:1949` | `ttm_effectCopy` | gfx_copyRect when width and height are both above 2 |
| `1058:197c` | `ttm_emptyMirrorHook` | Empty function; TTM opcode 0x2012 calls it |
| `1058:198a` | `ttm_dissolveEffect` | Opcode 0xa0b5: copies a rect of B to A; with 1068:1ebf set (never) dissolves it pixel by pixel in LFSR order |
| `1058:1ad0` | `ttm_timerExpired` | Returns 1 when a timer record (start, duration) has run out, or when 1068:45e2 is 0 |
| `1058:1b1f` | `ttm_timerLerp` | Interpolates between two values by the elapsed share of a timer record |
| `1058:1be1` | `ttm_startTimer` | Fills a timer record with the clock 1068:2e70/2e72 and a duration |
| `1058:1c06` | `ttm_expireTimer` | Fills a timer record that has already run out |

Run: `node scripts/re/function-map.mjs`
Expected: no validation errors; `docs/re/function-map.md` regenerated.

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to ...`.

Run: `pnpm exec vitest run scripts/re`
Expected: all pass (the `applies every names.json entry` test checks the new names).

- [x] **Action 8: Document the export addition**

In `docs/re/README.md`, add a row to the `Rebuild the decompile` table:

```markdown
| `re/out/jump-tables.tsv` | Every entry of the switch tables listed in `scripts/re/jump-tables.json`: jump address, index, opcode value, case address. The cases are disassembled into the function that jumps to them |
```

and one paragraph under it:

```markdown
Borland compiles a `switch` on many values as a linear search over a value table followed by an indirect jump, which Ghidra cannot follow. `scripts/re/ghidra/ApplyJumpTables.java` disassembles the cases listed in `scripts/re/jump-tables.json` and grows the function over them. Add a table there when a new `JMP word ptr CS:[BX + n]` shows up after a `LOOP` over `CS:[BX]`.
```

If Action 5 found that some functions decompile with their cases and others only show them in the assembly, add one sentence naming which.

- [x] **Action 9: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/README.md
git commit -m "docs(re): name the TTM interpreter functions"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
