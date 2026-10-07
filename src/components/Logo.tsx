// Знак Melo: буква «m», последняя ножка которой превращается в ноту.
// Точка-нота окрашивается в акцентный цвет из настроек.
export function Logo({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`logo ${className}`} width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <rect x="32" y="32" width="960" height="960" rx="230" className="logo-bg" />
      <g transform="translate(0,-22)">
        <path
          className="logo-m"
          d="M262 700 V430 a105 105 0 0 1 210 0 V640 M472 430 a105 105 0 0 1 210 0 V610"
          fill="none" strokeWidth="84" strokeLinecap="round" strokeLinejoin="round"
        />
        <circle className="logo-dot" cx="712" cy="690" r="92" />
      </g>
    </svg>
  );
}
