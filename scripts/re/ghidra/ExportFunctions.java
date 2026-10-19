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
