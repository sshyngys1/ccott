// Strict SemVer 2.0 parsing; an optional v prefix is accepted for stored release labels.
interface Semver {
  core: [number, number, number];
  prerelease: string[];
}

function details(version: string): Semver | null {
  if (typeof version !== "string") return null;
  const match = version.trim().replace(/^v/i, "").match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) return null;
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!core.every(Number.isSafeInteger)) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some(id => /^\d+$/.test(id) && id.length > 1 && id.startsWith("0"))) return null;
  return { core, prerelease };
}

export function parseSemver(version: string): [number, number, number] | null {
  return details(version)?.core ?? null;
}

export function normalizeSemver(version: string): string | null {
  return details(version) ? version.trim().replace(/^v/i, "") : null;
}

export function compareSemver(left: string, right: string): number {
  const a = details(left);
  const b = details(right);
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x);
    const numericY = /^\d+$/.test(y);
    if (numericX !== numericY) return numericX ? -1 : 1;
    if (numericX && x.length !== y.length) return x.length > y.length ? 1 : -1;
    return x > y ? 1 : -1;
  }
  return 0;
}
