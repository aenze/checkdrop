#!/usr/bin/env bash
# Installs the newest Checkdrop release on this server. Everything after the options is passed to
# `checkdrop install`, for example:
#   curl -fsSL https://raw.githubusercontent.com/aenze/checkdrop/main/install.sh \
#     | sudo bash -s -- --domain checks.example.com --json
# Options: --dir <path> (default /opt/checkdrop), --version <x.y.z> (default: newest release).
set -Eeuo pipefail
REPO="${CHECKDROP_REPO:-aenze/checkdrop}"
DIR="${CHECKDROP_DIR:-/opt/checkdrop}"
VERSION=""
PASS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    --version) VERSION="${2:?--version needs x.y.z}"; shift 2 ;;
    *) PASS+=("$1"); shift ;;
  esac
done
fail() { printf '{"status":"error","error":"%s","message":"%s"}\n' "$1" "$2"; exit 1; }
command -v curl >/dev/null || fail curl_missing "curl is required."
command -v openssl >/dev/null || fail openssl_missing "openssl is required."

base="https://github.com/$REPO/releases"
if [ -n "$VERSION" ]; then manifest_url="$base/download/v$VERSION/release.json"
else manifest_url="$base/latest/download/release.json"; fi
manifest="$(curl -fsSL --max-time 30 "$manifest_url")" || fail release_unreachable "Could not download $manifest_url"
version="$(printf '%s' "$manifest" | sed -n 's/.*"version":"\([0-9][0-9.]*[0-9]\)".*/\1/p')"
[ -n "$version" ] || fail invalid_manifest "The release description has no version."
sum_of() { printf '%s' "$manifest" | sed -n "s/.*\"$1\":\"\\([a-f0-9]\\{64\\}\\)\".*/\\1/p"; }

mkdir -p "$DIR"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for file in checkdrop compose.yaml; do
  curl -fsSL --max-time 60 -o "$work/$file" "$base/download/v$version/$file" || fail download_failed "Could not download $file"
  [ "$(openssl dgst -sha256 -r "$work/$file" | cut -d' ' -f1)" = "$(sum_of "$file")" ] \
    || fail checksum_mismatch "$file does not match the release checksum."
done
install -m 755 "$work/checkdrop" "$DIR/checkdrop"
install -m 644 "$work/compose.yaml" "$DIR/compose.yaml"
# ${PASS[@]+…} keeps bash 3.2 with set -u happy when no options were given.
CHECKDROP_INSTALL_VERSION="$version" CHECKDROP_REPO="$REPO" exec "$DIR/checkdrop" install ${PASS[@]+"${PASS[@]}"}
