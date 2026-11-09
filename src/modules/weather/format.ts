export const temperature = (c: number, units: "c" | "f") => `${Math.round(units === "f" ? c * 9 / 5 + 32 : c)}°`;
export const wind = (kmh: number, units: "c" | "f") => Math.round(units === "f" ? kmh / 1.609344 : kmh);
