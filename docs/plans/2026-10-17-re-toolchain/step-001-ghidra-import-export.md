# Step 1: Ghidra Import and Export

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

- Modify: `.gitignore` (add `re/`)
- Modify: `vitest.config.ts` (include `scripts/**/*.test.ts`)
- Create: `scripts/re/names.json`
- Create: `scripts/re/ghidra/ApplyNames.java`
- Create: `scripts/re/ghidra/ExportFunctions.java`
- Create: `scripts/re/ghidra-import.sh`
- Test: `scripts/re/export.data.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `scripts/re/ghidra-import.sh`: no args. Rebuilds `re/ghidra/` and `re/out/` from `public/data/SCRANTIC.SCR` and `scripts/re/names.json`. Exits non-zero on failure. Log at `re/ghidra-import.log`.
  - The `re/out/` layout described in the overview (`functions/`, `index.tsv`, `strings.tsv`, `imports.tsv`, `relocations.tsv`).
  - `scripts/re/names.json` in the overview's schema, with five runtime library entries.

- [x] **Action 1: Build the Ghidra decompiler for macOS ARM**

This changes the Ghidra install, not the repo. It downloads Gradle 9.7.1 on first run.

Run: `"$GHIDRA_INSTALL_DIR/support/gradle/gradlew" -p "$GHIDRA_INSTALL_DIR/support/gradle" buildNatives`
Expected: ends with `BUILD SUCCESSFUL`.

Then run: `ls -l "$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/build/os/mac_arm_64/decompile"`
Expected: the file exists and is executable.

If the build fails, record it in `step-999-leftovers.md` with the exact error and stop. Every later step needs the decompiler.

- [x] **Action 2: Ignore `re/`**

Append to `.gitignore`:

```
re/
```

- [x] **Action 3: Let Vitest find tests under `scripts/`**

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
```

- [x] **Action 4: Seed `scripts/re/names.json`**

The addresses and behavior come from reading the assembly (see "Binary facts" in the overview). `rtl_scopy` carries a signature and calling convention so the apply path gets exercised.

```json
{
  "functions": {
    "1000:0302": {
      "name": "rtl_lxmul",
      "subsystem": "rtl",
      "status": "named",
      "note": "Borland RTL 32-bit multiply: DX:AX * CX:BX -> DX:AX (low 32 bits)",
      "signature": null,
      "callingConvention": null
    },
    "1000:033a": {
      "name": "rtl_scopy",
      "subsystem": "rtl",
      "status": "named",
      "note": "Borland RTL far struct copy: CX bytes from far [BP+6] to far [BP+0xa], callee pops 8",
      "signature": "void rtl_scopy(void * src, void * dst)",
      "callingConvention": "__stdcall16far"
    },
    "1000:0488": {
      "name": "rtl_lxlsh",
      "subsystem": "rtl",
      "status": "named",
      "note": "Borland RTL 32-bit shift left of DX:AX by CL",
      "signature": null,
      "callingConvention": null
    },
    "1000:04a9": {
      "name": "rtl_lxrsh",
      "subsystem": "rtl",
      "status": "named",
      "note": "Borland RTL 32-bit arithmetic shift right of DX:AX by CL",
      "signature": null,
      "callingConvention": null
    },
    "1000:04c9": {
      "name": "rtl_lxursh",
      "subsystem": "rtl",
      "status": "named",
      "note": "Borland RTL 32-bit logical shift right of DX:AX by CL",
      "signature": null,
      "callingConvention": null
    }
  }
}
```

- [x] **Action 5: Write the failing export test**

Create `scripts/re/export.data.test.ts`. It skips when `re/out/` doesn't exist, the same way data tests skip without `public/data/`.

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OUT = fileURLToPath(new URL('../../re/out/', import.meta.url));
const NAMES = fileURLToPath(new URL('./names.json', import.meta.url));

type Row = Record<string, string>;

function readTsv(file: string): Row[] {
  const [header = '', ...rows] = readFileSync(OUT + file, 'utf8').trimEnd().split('\n');
  const keys = header.split('\t');
  return rows.map((row) => Object.fromEntries(row.split('\t').map((value, i) => [keys[i], value])));
}

interface NameEntry {
  name: string;
  signature: string | null;
  callingConvention: string | null;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe.skipIf(!existsSync(OUT))('Ghidra export of SCRANTIC.SCR', () => {
  it('lists every function the analysis found', () => {
    expect(readTsv('index.tsv').length).toBeGreaterThanOrEqual(500);
  });

  it('applies every names.json entry', () => {
    const names: Record<string, NameEntry> = JSON.parse(readFileSync(NAMES, 'utf8')).functions;
    const byAddress = new Map(readTsv('index.tsv').map((row) => [row.address, row]));
    for (const [address, entry] of Object.entries(names)) {
      const row = byAddress.get(address);
      expect(row?.name, address).toBe(entry.name);
      if (entry.callingConvention) expect(row?.callingConvention, address).toBe(entry.callingConvention);
      if (entry.signature) expect(normalize(row?.signature ?? ''), address).toBe(normalize(entry.signature));
    }
  });

  it('writes pseudo-C and assembly for every function', () => {
    const files = new Set(readdirSync(OUT + 'functions'));
    for (const row of readTsv('index.tsv')) {
      const base = `${row.address!.replace(':', '_')}_${row.name!.replace(/[^A-Za-z0-9_]/g, '_')}`;
      expect(files.has(`${base}.c`), base).toBe(true);
      expect(files.has(`${base}.asm`), base).toBe(true);
    }
  });

  it('decompiles at least 95% of functions', () => {
    const cFiles = readdirSync(OUT + 'functions').filter((f) => f.endsWith('.c'));
    const failed = cFiles.filter((f) => readFileSync(OUT + 'functions/' + f, 'utf8').startsWith('/* DECOMPILE_FAILED'));
    expect(failed.length / cFiles.length).toBeLessThan(0.05);
  });

  it('links strings to the code that loads their offset', () => {
    const strings = readTsv('strings.tsv');
    const hitsFor = (text: string) => (strings.find((row) => row.text === text)?.scalarHits ?? '').split(',');
    expect(hitsFor('RESOURCE.MAP').some((hit) => hit.endsWith('@1018:1771'))).toBe(true);
    expect(hitsFor('JOHNCAST.PAL').some((hit) => hit.endsWith('@1008:143c'))).toBe(true);
    expect(strings.some((row) => row.text?.includes('ADS:RES:'))).toBe(true);
  });

  it('lists callers of imported Windows functions', () => {
    const row = readTsv('imports.tsv').find((r) => r.import?.endsWith('GETPRIVATEPROFILEINT'));
    expect(row?.callers).toMatch(/^[0-9a-f]{4}:[0-9a-f]{4}/);
  });

  it('exports one relocation per NE relocation record', () => {
    expect(readTsv('relocations.tsv')).toHaveLength(1346);
  });
});
```

- [x] **Action 6: Run the test, confirm it skips**

Run: `pnpm exec vitest run scripts/re/export.data.test.ts`
Expected: the suite is reported as skipped, 0 failures (`re/out/` doesn't exist yet).

- [x] **Action 7: Write `scripts/re/ghidra/ApplyNames.java`**

Arg 0: path to `names.json`. Prints `JCR_FAIL ...` lines on problems. The shell script treats those as failure.

```java
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ghidra.app.cmd.function.ApplyFunctionSignatureCmd;
import ghidra.app.script.GhidraScript;
import ghidra.app.services.DataTypeManagerService;
import ghidra.app.util.cparser.C.CParserUtils;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.FunctionDefinitionDataType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

public class ApplyNames extends GhidraScript {
  @Override
  public void run() throws Exception {
    JsonObject functions = JsonParser.parseString(Files.readString(Path.of(getScriptArgs()[0])))
        .getAsJsonObject()
        .getAsJsonObject("functions");
    for (Map.Entry<String, JsonElement> e : functions.entrySet()) {
      apply(e.getKey(), e.getValue().getAsJsonObject());
    }
  }

  private void apply(String key, JsonObject entry) throws Exception {
    Address address = toAddr(key);
    Function function = getFunctionAt(address);
    if (function == null) function = createFunction(address, null);
    if (function == null) {
      println("JCR_FAIL no function at " + key);
      return;
    }
    function.setName(entry.get("name").getAsString(), SourceType.USER_DEFINED);
    if (isSet(entry, "signature")) {
      FunctionDefinitionDataType definition = CParserUtils.parseSignature(
          (DataTypeManagerService) null, currentProgram, entry.get("signature").getAsString(), true);
      boolean applied = definition != null
          && new ApplyFunctionSignatureCmd(address, definition, SourceType.USER_DEFINED).applyTo(currentProgram);
      if (!applied) println("JCR_FAIL bad signature at " + key);
    }
    if (isSet(entry, "callingConvention")) {
      function.setCallingConvention(entry.get("callingConvention").getAsString());
    }
    function.setComment(entry.get("note").getAsString());
  }

  private static boolean isSet(JsonObject entry, String field) {
    return entry.has(field) && !entry.get(field).isJsonNull();
  }
}
```

The calling convention is set after the signature on purpose: applying a signature resets it.

- [x] **Action 8: Write `scripts/re/ghidra/ExportFunctions.java`**

Arg 0: output folder (`re/out`). Writes the files described under "`re/out/` export layout" in the overview.

```java
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.reloc.Relocation;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.Symbol;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class ExportFunctions extends GhidraScript {
  private static final int DECOMPILE_TIMEOUT_SECONDS = 120;
  private static final int MIN_STRING_LENGTH = 4;

  @Override
  public void run() throws Exception {
    Path out = Path.of(getScriptArgs()[0]);
    Path functionsDir = out.resolve("functions");
    deleteRecursively(functionsDir);
    Files.createDirectories(functionsDir);
    exportFunctions(out, functionsDir);
    exportStrings(out);
    exportImports(out);
    exportRelocations(out);
  }

  private void exportFunctions(Path out, Path functionsDir) throws Exception {
    DecompInterface decompiler = new DecompInterface();
    decompiler.setOptions(new DecompileOptions());
    if (!decompiler.openProgram(currentProgram)) {
      println("JCR_FAIL decompiler unavailable: " + decompiler.getLastMessage());
      return;
    }
    List<String> index = new ArrayList<>();
    index.add("address\tname\tsize\tcallingConvention\tsignature\tcallers\tcallees");
    for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
      String address = f.getEntryPoint().toString();
      String base = address.replace(':', '_') + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_");
      DecompileResults result = decompiler.decompileFunction(f, DECOMPILE_TIMEOUT_SECONDS, monitor);
      String c;
      if (result.decompileCompleted()) {
        c = result.getDecompiledFunction().getC();
      } else {
        c = "/* DECOMPILE_FAILED: " + result.getErrorMessage() + " */\n";
        println("JCR_WARN decompile failed at " + address);
      }
      Files.writeString(functionsDir.resolve(base + ".c"), c);
      Files.writeString(functionsDir.resolve(base + ".asm"), assembly(f));
      index.add(String.join("\t",
          address,
          f.getName(),
          Long.toString(f.getBody().getNumAddresses()),
          f.getCallingConventionName(),
          f.getSignature().getPrototypeString(),
          entries(f.getCallingFunctions(monitor)),
          entries(f.getCalledFunctions(monitor))));
    }
    decompiler.dispose();
    Files.write(out.resolve("index.tsv"), index);
  }

  private String assembly(Function f) throws Exception {
    StringBuilder sb = new StringBuilder();
    for (Instruction i : currentProgram.getListing().getInstructions(f.getBody(), true)) {
      sb.append(i.getAddress()).append("  ").append(hex(i.getBytes())).append("  ").append(i).append('\n');
    }
    return sb.toString();
  }

  private void exportStrings(Path out) throws Exception {
    Map<Long, List<String>> hitsByValue = scalarHitsByValue();
    List<String> rows = new ArrayList<>(List.of("address\ttext\tscalarHits"));
    for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
      if (block.isExecute() || !block.isInitialized() || !block.getName().startsWith("Data")) continue;
      byte[] bytes = new byte[(int) block.getSize()];
      block.getBytes(block.getStart(), bytes);
      int start = -1;
      for (int i = 0; i <= bytes.length; i++) {
        boolean printable = i < bytes.length && bytes[i] >= 0x20 && bytes[i] < 0x7f;
        if (printable && start < 0) start = i;
        if (printable || start < 0) continue;
        if (i - start >= MIN_STRING_LENGTH) {
          Address address = block.getStart().add(start);
          long offset = ((SegmentedAddress) address).getSegmentOffset();
          String text = new String(bytes, start, i - start, StandardCharsets.ISO_8859_1)
              .replace("\\", "\\\\")
              .replace("\t", "\\t");
          rows.add(address + "\t" + text + "\t" + String.join(",", hitsByValue.getOrDefault(offset, List.of())));
        }
        start = -1;
      }
    }
    Files.write(out.resolve("strings.tsv"), rows);
  }

  private Map<Long, List<String>> scalarHitsByValue() {
    Map<Long, List<String>> hits = new HashMap<>();
    for (Instruction i : currentProgram.getListing().getInstructions(true)) {
      Function f = getFunctionContaining(i.getAddress());
      String where = i.getAddress() + "@" + (f == null ? "none" : f.getEntryPoint());
      Set<Long> values = new LinkedHashSet<>();
      for (int k = 0; k < i.getNumOperands(); k++) {
        for (Object o : i.getOpObjects(k)) {
          if (o instanceof Scalar s) values.add(s.getUnsignedValue());
        }
      }
      for (long v : values) hits.computeIfAbsent(v, x -> new ArrayList<>()).add(where);
    }
    return hits;
  }

  private void exportImports(Path out) throws Exception {
    MemoryBlock external = currentProgram.getMemory().getBlock("EXTERNAL");
    if (external == null) {
      println("JCR_FAIL no EXTERNAL block");
      return;
    }
    List<String> rows = new ArrayList<>(List.of("slot\timport\tcallers"));
    AddressIterator slots = currentProgram.getReferenceManager()
        .getReferenceDestinationIterator(new AddressSet(external.getStart(), external.getEnd()), true);
    while (slots.hasNext()) {
      Address slot = slots.next();
      Symbol symbol = getSymbolAt(slot);
      Set<String> callers = new TreeSet<>();
      for (Reference r : getReferencesTo(slot)) {
        Function f = getFunctionContaining(r.getFromAddress());
        callers.add(f == null ? r.getFromAddress() + "@none" : f.getEntryPoint().toString());
      }
      rows.add(slot + "\t" + (symbol == null ? "?" : symbol.getName(true)) + "\t" + String.join(",", callers));
    }
    Files.write(out.resolve("imports.tsv"), rows);
  }

  private void exportRelocations(Path out) throws Exception {
    List<String> rows = new ArrayList<>(List.of("address\ttype\tvalues"));
    Iterator<Relocation> it = currentProgram.getRelocationTable().getRelocations();
    while (it.hasNext()) {
      Relocation r = it.next();
      String values = Arrays.stream(r.getValues()).mapToObj(Long::toString).collect(Collectors.joining(","));
      rows.add(r.getAddress() + "\t" + r.getType() + "\t" + values);
    }
    Files.write(out.resolve("relocations.tsv"), rows);
  }

  private static String entries(Set<Function> functions) {
    return functions.stream()
        .map(f -> f.getEntryPoint().toString())
        .sorted()
        .collect(Collectors.joining(","));
  }

  private static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder();
    for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
    return sb.toString();
  }

  private static void deleteRecursively(Path dir) throws IOException {
    if (!Files.exists(dir)) return;
    try (Stream<Path> paths = Files.walk(dir)) {
      for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(p);
    }
  }
}
```

- [x] **Action 9: Write `scripts/re/ghidra-import.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
binary="$repo/public/data/SCRANTIC.SCR"
project_dir="$repo/re/ghidra"
out_dir="$repo/re/out"
log="$repo/re/ghidra-import.log"

: "${GHIDRA_INSTALL_DIR:?set GHIDRA_INSTALL_DIR to the Ghidra install folder}"
if [[ ! -f "$binary" ]]; then
  echo "missing $binary" >&2
  exit 1
fi

mkdir -p "$project_dir" "$out_dir"
"$GHIDRA_INSTALL_DIR/support/analyzeHeadless" "$project_dir" scrantic \
  -import "$binary" -overwrite \
  -scriptPath "$repo/scripts/re/ghidra" \
  -postScript ApplyNames.java "$repo/scripts/re/names.json" \
  -postScript ExportFunctions.java "$out_dir" \
  > "$log" 2>&1

if grep -E "JCR_FAIL|decompile does not exist|SCRIPT ERROR|Script Exception" "$log" >&2; then
  echo "ghidra-import failed, see $log" >&2
  exit 1
fi
echo "export written to $out_dir"
```

Run: `chmod +x scripts/re/ghidra-import.sh`

- [x] **Action 10: Run the import**

Run: `scripts/re/ghidra-import.sh` (allow up to 10 minutes)
Expected: prints `export written to .../re/out`, exit code 0.

If it fails, read `re/ghidra-import.log` around the matched line. Common causes:
- `decompile does not exist`: action 1 didn't take effect. Check the file from action 1 again.
- `JCR_FAIL bad signature`: the signature string didn't parse. It must have no calling convention keyword.
- A Java compile error: Ghidra compiles scripts itself. The error names the line.

- [x] **Action 11: Run the export test, confirm it passes**

Run: `pnpm exec vitest run scripts/re/export.data.test.ts`
Expected: 7 tests pass.

If `links strings to the code` fails, open `re/out/strings.tsv` and check the `RESOURCE.MAP` row. Expected hit: `1018:179b@1018:1771`. If `lists callers of imported Windows functions` fails, open `re/out/imports.tsv` and check the `import` column format, then fix the exporter, not the test's intent.

- [x] **Action 12: Spot-check the pseudo-C**

Run: `ls re/out/functions/1000_0302_rtl_lxmul.c re/out/functions/1000_033a_rtl_scopy.c`
Then read `re/out/functions/1000_033a_rtl_scopy.c`.
Expected: both files exist. The copy function shows the name `rtl_scopy` and the two parameters.

- [x] **Action 13: Run the full suite and type check**

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 14: Confirm nothing under `re/` is staged, then commit**

Run: `git status --short`
Expected: no paths under `re/`.

```bash
git add .gitignore vitest.config.ts scripts/re/names.json scripts/re/ghidra/ApplyNames.java scripts/re/ghidra/ExportFunctions.java scripts/re/ghidra-import.sh scripts/re/export.data.test.ts
git commit -m "feat(re): Ghidra headless import, names, and export of SCRANTIC.SCR"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
