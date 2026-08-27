// Carried parcels ride their carrier, so mid-move coordinates can be fractional.
export const key = (x: number, y: number): string =>
  `${Math.round(x)},${Math.round(y)}`;
