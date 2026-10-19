// The car's poses: shut, one front door open (the driver's is the right one where traffic keeps left), both open.
import type { StateSpec } from '../../../../core/geometry/shapes/package.ts';

export const states: Record<string, StateSpec> = {
  shut: { doorL: 0, doorR: 0 },
  leftOpen: { doorL: 65 },
  rightOpen: { doorR: -65 },
  open: { doorL: 65, doorR: -65 },
};
