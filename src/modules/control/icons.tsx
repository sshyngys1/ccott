import type { ModuleIconProps } from "../../shared/types";
import type { ReactNode } from "react";

function Glyph({ size = 20, className, children }: ModuleIconProps & { children: ReactNode }) {
  return <svg className={`ig-icon ${className ?? ""}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">{children}</svg>;
}
export const IconControl = (props: ModuleIconProps) => <Glyph {...props}><path d="M4 3v4m0 4v6M10 3v8m0 4v2M16 3v2m0 4v8" /><path d="M2 7h4v4H2zM8 11h4v4H8zM14 5h4v4h-4z" /></Glyph>;
export const IconWifi = (props: ModuleIconProps) => <Glyph {...props}><path d="M2.5 7a11.5 11.5 0 0 1 15 0M5.3 10a7.2 7.2 0 0 1 9.4 0M8 13a3 3 0 0 1 4 0" /><circle cx="10" cy="16" r=".65" /></Glyph>;
export const IconBluetooth = (props: ModuleIconProps) => <Glyph {...props}><path d="m5.5 5 9 9-4.5 3V3l4.5 3-9 9" /></Glyph>;
