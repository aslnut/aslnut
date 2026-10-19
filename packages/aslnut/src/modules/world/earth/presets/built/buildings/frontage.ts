// modules › world › earth › presets › built › buildings › frontage: an Earth house's frontage and plot, the defaults
// of the bake's stage 12 (buildings › compile) for suburban lots: the property line (the road reserve's edge) found
// within `reach` metres of the house, the plot its span along the line widened by `side` metres each way and back to
// `back` metres behind it; which buildings are houses (and get a plot); which are open at the ground (a path may run
// under them). Placement only: how a fence, a gate or a letterbox on the frontage looks is chosen when it is drawn.
//   house      what one detached house may be: `maxArea` m² of footprint, `maxSide` m along its longest side; an
//              outline labelled a house beyond either is a block of units or a merged outline (stage 12's check
//              'house-size': not a house, so no plot and no front fence, drawn as a building on its own outline)
//   frontWall  the most a house's foundation may show on its street side (m over the ground before it, stage 13's
//              check 'pad-front': the pad is set lower and cut into the slope behind)
export interface FrontageRules { reach: number; side: number; back: number; covered: ReadonlySet<string>; house: { maxArea: number; maxSide: number }; frontWall: number }
export const FRONTAGE: FrontageRules = {
  reach: 40, side: 1.5, back: 3,
  covered: new Set(['roof', 'shelter', 'carport', 'train_station', 'parking', 'pavilion']),
  house: { maxArea: 400, maxSide: 32 }, frontWall: 1,
};
