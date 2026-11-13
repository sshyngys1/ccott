import type { IconProps } from "../../design/icons";

export function IconInfo({ size = 20, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6v.1" />
  </svg>;
}
