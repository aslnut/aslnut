// The trees of this twin, from aslnut's species library: Melbourne's street trees as three kinds, weighted as they are
// planted: plane trees (and the elms like them), eucalypts and poplars (a phone draws each kind's variants apart: three
// kinds keep the street level's draws as they were). The street level draws them for every real tree (its height and
// crown from the open data); the heat model takes their crowns and the share of the sun their leaves let through. The
// crowns fuller than the library's (more and larger leaf cards): a phone's small view showed them see-through.
import { SPECIES, type Species, type TreeLook } from '../../src/index.ts';

/** a library species with fuller leaves (cards × size, density × more) */
const fuller = (s: Species, size: number, more: number) => ({ ...s.spec, leaves: { ...s.spec.leaves, size: (s.spec.leaves?.size ?? 2.5) * size, density: (s.spec.leaves?.density ?? 3) * more } });
export const MELBOURNE_TREES: TreeLook = {
  variants: 2,
  species: {
    plane: { weight: 4, spec: fuller(SPECIES.plane, 1, 1.15) },
    eucalypt: { weight: 3, spec: SPECIES.eucalypt.spec },
    poplar: { weight: 1, spec: fuller(SPECIES.poplar, 1, 1.5) },
  },
};
