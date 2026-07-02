export function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

export function hasEnv(...names: string[]): boolean {
  return Boolean(env(...names));
}

export function envNumber(defaultValue: number, ...names: string[]): number {
  const value = env(...names);
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function envBool(defaultValue: boolean, ...names: string[]): boolean {
  const value = env(...names);
  if (!value) return defaultValue;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

export function envList(...names: string[]): string[] {
  return env(...names)
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export class ProductionReadinessError extends Error {
  status = 503;
  constructor(message: string) {
    super(message);
    this.name = "ProductionReadinessError";
  }
}
