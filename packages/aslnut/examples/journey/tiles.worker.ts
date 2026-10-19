// Kuta's street level tiles built off the main thread: the same look as the page's (street-level.ts).
import { serve } from '../../src/core/runtime/workers.ts';
import { streetsWorker } from '../../src/modules/world/earth/street.ts';
import { LOOK } from './street-level.ts';

serve(streetsWorker(LOOK));
