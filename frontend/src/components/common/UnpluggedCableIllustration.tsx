import * as React from 'react'

export interface UnpluggedCableIllustrationProps {
  className?: string
  width?: number | string
  height?: number | string
}

/**
 * Premium standalone Unplugged Cable Illustration conforming to MCT OneUI standards.
 * Features disconnected power plugs in brand maroon (#960C01) with metallic prongs,
 * smooth flowing cables, and an electric disconnect spark.
 * Rendered directly on the canvas without clunky enclosing boxes.
 */
export const UnpluggedCableIllustration: React.FC<UnpluggedCableIllustrationProps> = ({
  className = 'w-64 sm:w-80 h-auto',
  width = 320,
  height = 140,
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 140"
      width={width}
      height={height}
      fill="none"
      role="img"
      aria-label="Disconnected power cables"
      className={`select-none ${className}`}
    >
      <defs>
        {/* Soft shadow for plug heads */}
        <filter id="plug-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#960C01" floodOpacity="0.22" />
        </filter>

        {/* Brand Maroon Linear Gradient for Plugs */}
        <linearGradient id="plug-maroon" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#AD1408" />
          <stop offset="60%" stopColor="#960C01" />
          <stop offset="100%" stopColor="#750900" />
        </linearGradient>

        {/* Metallic Prongs Gradient */}
        <linearGradient id="prongs-metal" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#E2E8F0" />
          <stop offset="50%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>

        {/* Wire Gradient */}
        <linearGradient id="wire-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E2E8F0" />
          <stop offset="50%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#94A3B8" />
        </linearGradient>

        {/* Disconnect Glow */}
        <radialGradient id="spark-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#EF4444" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient Disconnect Aura Glow in center */}
      <circle cx="160" cy="70" r="32" fill="url(#spark-glow)" />

      {/* LEFT SIDE: Cable wire sweeping smoothly from bottom-left */}
      <path
        d="M 24 116 C 56 116, 76 70, 114 70"
        stroke="url(#wire-gradient)"
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* LEFT SIDE: Rubber Strain Relief Boot */}
      <path
        d="M 104 64 L 118 64 L 118 76 L 104 76 Z"
        fill="#475569"
        rx="2.5"
      />

      {/* LEFT SIDE: Male Plug Body */}
      <g filter="url(#plug-soft-shadow)">
        <rect
          x="116"
          y="48"
          width="32"
          height="44"
          rx="7"
          fill="url(#plug-maroon)"
        />
        {/* Subtle ergonomic grip ridges */}
        <line x1="123" y1="56" x2="123" y2="84" stroke="#FFFFFF" strokeWidth="1.75" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="129" y1="56" x2="129" y2="84" stroke="#FFFFFF" strokeWidth="1.75" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="135" y1="56" x2="135" y2="84" stroke="#FFFFFF" strokeWidth="1.75" strokeOpacity="0.3" strokeLinecap="round" />
      </g>

      {/* LEFT SIDE: Metallic Contact Prongs */}
      <rect
        x="148"
        y="55"
        width="16"
        height="7"
        rx="2"
        fill="url(#prongs-metal)"
        stroke="#64748B"
        strokeWidth="0.5"
      />
      <rect
        x="148"
        y="78"
        width="16"
        height="7"
        rx="2"
        fill="url(#prongs-metal)"
        stroke="#64748B"
        strokeWidth="0.5"
      />

      {/* CENTER: Disconnection Electric Spark / Bolt */}
      <g>
        <path
          d="M 163 52 L 156 68 L 164 68 L 157 86"
          stroke="#960C01"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="151" cy="54" r="1.75" fill="#DC2626" />
        <circle cx="169" cy="84" r="1.75" fill="#DC2626" />
        <circle cx="167" cy="56" r="1.25" fill="#F87171" />
        <circle cx="153" cy="82" r="1.25" fill="#F87171" />
      </g>

      {/* RIGHT SIDE: Female Socket Receptacle Slots */}
      <rect x="171" y="54" width="3.5" height="9" rx="1.5" fill="#0F172A" />
      <rect x="171" y="77" width="3.5" height="9" rx="1.5" fill="#0F172A" />

      {/* RIGHT SIDE: Female Socket Body */}
      <g filter="url(#plug-soft-shadow)">
        <rect
          x="173"
          y="46"
          width="36"
          height="48"
          rx="7"
          fill="url(#plug-maroon)"
        />
        {/* Subtle ergonomic grip ridges */}
        <line x1="183" y1="55" x2="183" y2="85" stroke="#FFFFFF" strokeWidth="1.75" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="189" y1="55" x2="189" y2="85" stroke="#FFFFFF" strokeWidth="1.75" strokeOpacity="0.3" strokeLinecap="round" />
        <line x1="195" y1="55" x2="195" y2="85" stroke="#FFFFFF" strokeWidth="1.75" strokeOpacity="0.3" strokeLinecap="round" />
      </g>

      {/* RIGHT SIDE: Rubber Strain Relief Boot */}
      <path
        d="M 207 64 L 221 64 L 221 76 L 207 76 Z"
        fill="#475569"
        rx="2.5"
      />

      {/* RIGHT SIDE: Cable wire sweeping smoothly to bottom-right */}
      <path
        d="M 218 70 C 256 70, 276 116, 308 116"
        stroke="url(#wire-gradient)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default UnpluggedCableIllustration
