#!/bin/sh
# The speech models the measurements use, from sherpa-onnx's releases, unpacked into DIR (default ./models).
set -eu
dir="${1:-models}"; mkdir -p "$dir"; cd "$dir"
base=https://github.com/k2-fsa/sherpa-onnx/releases/download
for u in asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 \
         asr-models/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2 \
         asr-models/silero_vad.onnx \
         tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2 \
         tts-models/kokoro-multi-lang-v1_0.tar.bz2 \
         tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2; do
  f=$(basename "$u"); d=${f%.tar.bz2}
  [ -e "$d" ] && continue
  curl -fsSL -o "$f" "$base/$u"
  case "$f" in *.tar.bz2) tar xjf "$f" && rm "$f";; esac
done
