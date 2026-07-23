#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REPOSITORY="https://github.com/autotrace/autotrace.git"
UPSTREAM_COMMIT="${AUTOTRACE_UPSTREAM_COMMIT:-74c796282474f33553265abbef4fc340b18c0593}"
UPSTREAM_VERSION="${AUTOTRACE_UPSTREAM_VERSION:-0.40.0}"
WORK_ROOT="${RUNNER_TEMP:-/tmp}/print-upscale-autotrace-win64"
SOURCE_ROOT="$WORK_ROOT/source"
OUTPUT_ROOT="${GITHUB_WORKSPACE:-$(pwd)}/vendor/autotrace/win32-x64"
BIN_ROOT="$OUTPUT_ROOT/bin"
MINGW_BIN="/usr/x86_64-w64-mingw32/sys-root/mingw/bin"

DLLS=(
  iconv.dll
  libffi-8.dll
  libgcc_s_seh-1.dll
  libglib-2.0-0.dll
  libgobject-2.0-0.dll
  libintl-8.dll
  libpcre2-8-0.dll
  libpng16-16.dll
  libwinpthread-1.dll
  zlib1.dll
)

rm -rf "$WORK_ROOT" "$OUTPUT_ROOT"
mkdir -p "$WORK_ROOT" "$BIN_ROOT"

git clone --filter=blob:none --no-checkout "$UPSTREAM_REPOSITORY" "$SOURCE_ROOT"
git -C "$SOURCE_ROOT" checkout --detach "$UPSTREAM_COMMIT"

pushd "$SOURCE_ROOT" >/dev/null
./autogen.sh
mingw64-configure --without-magick --without-pstoedit
make -j"$(nproc)"

SOURCE_EXE="$(find "$SOURCE_ROOT" -type f -path '*/.libs/autotrace.exe' -print | head -n 1)"
if [[ -z "$SOURCE_EXE" || ! -f "$SOURCE_EXE" ]]; then
  echo "Không tìm thấy autotrace.exe sau khi cross-compile." >&2
  exit 1
fi

cp -f "$SOURCE_EXE" "$BIN_ROOT/autotrace.exe"
for dll in "${DLLS[@]}"; do
  if [[ ! -f "$MINGW_BIN/$dll" ]]; then
    echo "Thiếu DLL bắt buộc từ Fedora MinGW runtime: $MINGW_BIN/$dll" >&2
    exit 1
  fi
  cp -f "$MINGW_BIN/$dll" "$BIN_ROOT/$dll"
done
cp -f COPYING "$OUTPUT_ROOT/COPYING"
cp -f COPYING.LIB "$OUTPUT_ROOT/COPYING.LIB"

PE_DESCRIPTION="$(file "$BIN_ROOT/autotrace.exe")"
IMPORTS="$(x86_64-w64-mingw32-objdump -p "$BIN_ROOT/autotrace.exe" | sed -n 's/^[[:space:]]*DLL Name: //p' | sort -fu)"
if ! grep -qi 'PE32+.*x86-64' <<<"$PE_DESCRIPTION"; then
  echo "AutoTrace output không phải Windows x64 PE32+: $PE_DESCRIPTION" >&2
  exit 1
fi
for required in libgcc_s_seh-1.dll libwinpthread-1.dll; do
  if grep -qi "^${required}$" <<<"$IMPORTS" && [[ ! -f "$BIN_ROOT/$required" ]]; then
    echo "PE import yêu cầu $required nhưng runtime không bundle DLL này." >&2
    exit 1
  fi
done

PREPARED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DLL_COUNT="${#DLLS[@]}"
cat > "$OUTPUT_ROOT/runtime.json" <<JSON
{
  "version": "$UPSTREAM_VERSION",
  "target": "win32-x64",
  "preparedAt": "$PREPARED_AT",
  "bundled": true,
  "relocatable": true,
  "bundledLibraryCount": $DLL_COUNT,
  "sourceRepository": "$UPSTREAM_REPOSITORY",
  "sourceCommit": "$UPSTREAM_COMMIT",
  "buildMethod": "upstream-fedora-mingw64-cross-compile",
  "runtimeLayout": {
    "executable": "bin/autotrace.exe",
    "libraries": "bin/*.dll",
    "searchPaths": ["bin"]
  },
  "license": "GPL-2.0-or-later",
  "libraryLicense": "LGPL-2.1-or-later",
  "upstream": "https://github.com/autotrace/autotrace"
}
JSON

{
  printf '{\n'
  printf '  "sourceCommit": "%s",\n' "$UPSTREAM_COMMIT"
  printf '  "peDescription": "%s",\n' "${PE_DESCRIPTION//\"/\\\"}"
  printf '  "imports": [\n'
  mapfile -t IMPORT_ARRAY <<<"$IMPORTS"
  for index in "${!IMPORT_ARRAY[@]}"; do
    suffix=','
    if (( index == ${#IMPORT_ARRAY[@]} - 1 )); then suffix=''; fi
    printf '    "%s"%s\n' "${IMPORT_ARRAY[$index]//\"/\\\"}" "$suffix"
  done
  printf '  ],\n'
  printf '  "files": [\n'
  mapfile -t FILE_ARRAY < <(find "$OUTPUT_ROOT" -type f -printf '%P\n' | sort)
  for index in "${!FILE_ARRAY[@]}"; do
    suffix=','
    if (( index == ${#FILE_ARRAY[@]} - 1 )); then suffix=''; fi
    printf '    "%s"%s\n' "${FILE_ARRAY[$index]//\"/\\\"}" "$suffix"
  done
  printf '  ]\n'
  printf '}\n'
} > "$OUTPUT_ROOT/source-layout.json"

popd >/dev/null

echo "AutoTrace Windows x64 source-built runtime ready at $OUTPUT_ROOT"
echo "$PE_DESCRIPTION"
echo "$IMPORTS"
