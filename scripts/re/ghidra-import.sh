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
  -postScript ApplyJumpTables.java "$repo/scripts/re/jump-tables.json" "$out_dir" \
  -postScript ExportFunctions.java "$out_dir" \
  > "$log" 2>&1

if grep -E "JCR_FAIL|decompile does not exist|SCRIPT ERROR|Script Exception" "$log" >&2; then
  echo "ghidra-import failed, see $log" >&2
  exit 1
fi
echo "export written to $out_dir"
