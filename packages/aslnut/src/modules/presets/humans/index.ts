// modules › presets › humans: people, ready-made and built with the public API (core › entities › body: a skeleton,
// a skin blended by dual quaternions, clips baked into rows). A generated body (sliders → its 1,520 vertices and its
// joints), a face drawn from numbers, hair styles re-fitted to each head, clothes by colour or by garment, still poses,
// gaits; and people from seeds, alone or as a crowd walking a walking network. Its own import:
//   import { person, crowd, humanFigure, loadTemplate } from 'aslnut/modules/presets/humans'
// The template (faces, weights, hair: a pack of ~110 KB gzipped) is data, loaded once.
export { generate, params, BASE, MORPHS, MORPH_ORDER, PART_NAMES, bodyRings, headRings, vertexParts, buildPositions, designMesh, joints, type Morph, type Joint, type BodyRings } from './body/generator.ts';
export { loadTemplate, parseTemplate, type Template, type SkinPiece, type CorrectiveRule } from './body/template.ts';
export { loadFit, parseFit, fitBody, type BodyFit } from './body/fit.ts';
export { humanFigure, figureKey, type FigureSpec, type HumanFigure } from './body/figure.ts';
export { headMeasures } from './body/features.ts';
export { FACE_DEFAULTS, FACE_MATERIAL, IRIS, packFace, type Face } from './face/index.ts';
export { EMOTIONS, express, blink } from './expressions/index.ts';
export { HAIR_STYLES, type HairStyle } from './hair/styles.ts';
export { generateHair, scalpOf, mergePieces, HAIR_PARAMS, hairDefaults, type HairParams, type Scalp } from './hair/generate.ts';
export { fitHair } from './hair/fit.ts';
export { GARMENTS, buildGarment, garmentParams, OUTFITS, PALETTE, palette, type Outfit, type Garment, type GarmentType, type GarmentPiece } from './clothing/index.ts';
export { POSES, HumanRig, type Pose, type PoseOps } from './poses/index.ts';
export { GAITS, cycle, idle, strideOf, type GaitStyle } from './gaits/index.ts';
export { person, restyle, paletteOf, toned, decalOf, personEntity, crowd, farPerson, farAt, seedOf, PEOPLE, SKIN_TONES, HAIR_COLORS, GREYS, DYED, type Person, type PersonOptions, type Age, type Crowd, type CrowdOptions, type Tone } from './people.ts';
