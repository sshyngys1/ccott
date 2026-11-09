import type { ModuleIconProps, WeatherCode } from "../../shared/types";

export function WeatherIcon({ code = "partly", isDay = true, size = 20, className }: ModuleIconProps & { code?: WeatherCode; isDay?: boolean }) {
  const cloud = !["clear", "fog"].includes(code);
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
    {(["clear", "partly"].includes(code)) && (isDay ? <><circle cx={cloud ? 7 : 10} cy={cloud ? 7 : 10} r="3.25" />
      <path d={cloud ? "M7 1v1M2 3l1 1M1 8h1M11 3l1-1" : "M10 1v2m0 14v2M1 10h2m14 0h2M3.6 3.6l1.5 1.5m9.8 9.8 1.5 1.5M3.6 16.4l1.5-1.5m9.8-9.8 1.5-1.5"} /></> : <path d="M14 3a7 7 0 1 0 3 10A6 6 0 0 1 14 3Z" />)}
    {cloud && <path d="M5 13.5a3.25 3.25 0 0 1-.2-6.5 4.5 4.5 0 0 1 8.4-1.2 3.9 3.9 0 1 1 1.3 7.7H5Z" />}
    {code === "fog" && <path d="M3 6h14M2 10h16M4 14h12" />}
    {(["rain", "drizzle", "sleet"].includes(code)) && <path d="m6 16-.7 2m5-2-.7 2m5-2-.7 2" strokeDasharray={code === "drizzle" ? "1 2" : undefined} />}
    {code === "snow" && <path d="M6 16v3m-1.3-2.2 2.6 1.4m0-1.4-2.6 1.4M14 16v3m-1.3-2.2 2.6 1.4m0-1.4-2.6 1.4" />}
    {code === "thunder" && <path d="m11 13-3 4h3l-1 2 4-4h-3l1-2" />}
  </svg>;
}
