import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.listing.Function;
import ghidra.program.model.pcode.EquateSymbol;
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
      new JumpTable(jump, targets, true, EquateSymbol.FORMAT_DEFAULT).writeOverride(function);
      CreateFunctionCmd.fixupFunctionBody(currentProgram, function, monitor);
    }
    Files.write(out.resolve("jump-tables.tsv"), rows);
  }
}
