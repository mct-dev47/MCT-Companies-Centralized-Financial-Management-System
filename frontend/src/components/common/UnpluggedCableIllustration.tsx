import * as React from 'react'

export interface UnpluggedCableIllustrationProps {
  className?: string
  width?: number | string
  height?: number | string
}

export const UnpluggedCableIllustration: React.FC<UnpluggedCableIllustrationProps> = ({
  className = 'w-56 sm:w-72 h-auto',
  width = 280,
  height = 140,
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 140"
      width={width}
      height={height}
      fill="none"
      role="img"
      aria-label="Disconnected power cable"
      className={className}
    >
      <defs>
        {/* Soft drop shadow */}
        <filter id="plug-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#8E0F00" floodOpacity="0.12" />
        </filter>

        {/* Plug Body Gradient */}
        <linearGradient id="plug-maroon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A81502" />
          <stop offset="60%" stopColor="#8E0F00" />
          <stop offset="100%" stopColor="#690900" />
        </linearGradient>

        {/* Cable Gradient Left */}
        <linearGradient id="cable-grad-left" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>

        {/* Cable Gradient Right */}
        <linearGradient id="cable-grad-right" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#94A3B8" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>

        {/* Metal Prongs Gradient */}
        <linearGradient id="prong-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F1F5F9" />
          <stop offset="50%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>

        {/* Spark Glow */}
        <radialGradient id="spark-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#EF4444" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Spark glow in center */}
      <circle cx="140" cy="70" r="28" fill="url(#spark-glow)" />

      {/* LEFT SIDE: Cable trailing from bottom-left */}
      <path
        d="M 12 118 C 36 118, 56 70, 88 70"
        stroke="url(#cable-grad-left)"
        strokeWidth="7"
        strokeLinecap="round"
      />

      {/* LEFT SIDE: Strain relief sleeve */}
      <path
        d="M 80 66 L 90 66 L 90 74 L 80 74 Z"
        fill="#475569"
        rx="2"
      />

      {/* LEFT SIDE: Male Plug Body */}
      <g filter="url(#plug-shadow)">
        <rect
          x="88"
          y="52"
          width="28"
          height="36"
          rx="6"
          fill="url(#plug-maroon-grad)"
        />
        {/* Subtle ridge details on plug handle */}
        <line x1="94" y1="58" x2="94" y2="82" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="99" y1="58" x2="99" y2="82" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="104" y1="58" x2="104" y2="82" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.3" strokeLinecap="round" />
      </g>

      {/* LEFT SIDE: Metal Prongs extending towards right */}
      <rect
        x="116"
        y="58"
        width="15"
        height="6"
        rx="1.5"
        fill="url(#prong-grad)"
        stroke="#64748B"
        strokeWidth="0.5"
      />
      <rect
        x="116"
        y="76"
        width="15"
        height="6"
        rx="1.5"
        fill="url(#prong-grad)"
        stroke="#64748B"
        strokeWidth="0.5"
      />

      {/* CENTER: Disconnection Sparks / Lightning Indicator */}
      <g>
        {/* Main electric bolt */}
        <path
          d="M 143 56 L 137 68 L 143 68 L 137 82"
          stroke="#8E0F00"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Small spark dots / dashes */}
        <circle cx="134" cy="58" r="1.5" fill="#DC2626" />
        <circle cx="147" cy="80" r="1.5" fill="#DC2626" />
        <path
          d="M 132 72 Q 131 70, 130 68"
          stroke="#EF4444"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M 149 66 Q 150 68, 151 70"
          stroke="#EF4444"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>

      {/* RIGHT SIDE: Female Socket Receptacle Slots */}
      <rect
        x="151"
        y="56"
        width="3"
        height="10"
        rx="1"
        fill="#1E293B"
      />
      <rect
        x="151"
        y="74"
        width="3"
        height="10"
        rx="1"
        fill="#1E293B"
      />

      {/* RIGHT SIDE: Female Socket Body */}
      <g filter="url(#plug-shadow)">
        <rect
          x="153"
          y="50"
          width="32"
          height="40"
          rx="6"
          fill="url(#plug-maroon-grad)"
        />
        {/* Subtle ridge details on socket */}
        <line x1="162" y1="57" x2="162" y2="83" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="167" y1="57" x2="167" y2="83" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="172" y1="57" x2="172" y2="83" stroke="#FFFFFF" strokeWidth="1.5" strokeOpacity="0.3" strokeLinecap="round" />
      </g>

      {/* RIGHT SIDE: Strain relief sleeve */}
      <path
        d="M 185 66 L 195 66 L 195 74 L 185 74 Z"
        fill="#475569"
        rx="2"
      />

      {/* RIGHT SIDE: Cable trailing to bottom-right */}
      <path
        d="M 192 70 C 224 70, 244 118, 268 118"
        stroke="url(#cable-grad-right)"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </svg>
  )
}
