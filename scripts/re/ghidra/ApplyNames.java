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
