#!/bin/bash
# measure the gates on a pack: run.sh <pack dir> <place geojson> <out json> [x0 z0 x1 z1]
cd "$(dirname "$0")/../../.." && ASLNUT_SRC=${ASLNUT_SRC:-packages/baker/out/main-ref/packages/aslnut/src} node packages/baker/gates/measure.ts "$1" "$2" ${4:-} ${5:-} ${6:-} ${7:-} > "$3" 2> "${3%.json}.log"
