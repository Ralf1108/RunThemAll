#!/bin/bash
# Runs inside ubuntu:24.04. /src = Boxedwine checkout (read only), /repro = accept-null, /out = results.
# Builds upstream master and master + fix (fix-native-accept) for Linux and runs accept-null in both.
# Results go to /out (build-*.log, run-*.log). Run from this folder (Boxedwine/ = the checkout):
#
#   docker volume create bwwork
#   docker run --rm -v bwwork:/work -v "$PWD/Boxedwine:/src:ro" -v "$PWD:/repro:ro" -v "$PWD/out:/out" \
#     ubuntu:24.04 bash -c "apt-get update -qq && apt-get install -y -qq git && \
#       git config --global --add safe.directory '*' && bash /repro/linux-test.sh"
#
# Result on 27.11.2026: master 0fa70a84 stops with "KMemory::performOnMemory failed to get ram",
# master + fix 0d4f13fc prints "OK: accept returned 0x00000005".
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential git libsdl2-dev libwayland-dev libssl-dev libminizip-dev libcurl4-openssl-dev zlib1g-dev libgl-dev libglu1-mesa-dev libegl-dev >/dev/null
[ -d /work/bw ] || git clone -q /src /work/bw
cd /work/bw
git checkout -q --detach 2>/dev/null || true
git fetch -q -f /src master:upstream-master fix-native-accept:fix
mkdir -p /work/root
cp /repro/accept-null /work/root/accept-null
chmod 755 /work/root/accept-null
for variant in upstream-master fix; do
  git checkout -q "$variant"
  echo "=== $variant: $(git log --oneline -1)"
  (cd project/linux && make -j"$(nproc)" release > /out/build-$variant.log 2>&1) || { echo "build failed"; tail -30 /out/build-$variant.log; exit 1; }
  bin=$(ls project/linux/Build/Release/boxedwine* | head -1)
  echo "binary: $bin"
  set +e
  SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy timeout 60 "$bin" -root /work/root /accept-null > /out/run-$variant.log 2>&1
  echo "exit code: $?"
  set -e
  grep -E "accept|OK|error|KMemory|failed" /out/run-$variant.log | head -10
done
