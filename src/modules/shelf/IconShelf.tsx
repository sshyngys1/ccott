import type { ModuleIconProps } from "../../shared/types";
export function IconShelf({ size = 20, className = "ig-icon" }: ModuleIconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M3 12h4l1 2h4l1-2h4M3 12l2-8h10l2 8v5H3z" />
  </svg>;
}
