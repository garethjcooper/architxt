import React from 'react';

interface HindsightIconProps extends React.SVGAttributes<SVGSVGElement> {
  className?: string;
}

export const HindsightIcon = React.forwardRef<SVGSVGElement, HindsightIconProps>(
  ({ className, ...props }, ref) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
      >
        {/* Central eye / almond shape */}
        <path
          d="M2 12C4.5 7 8 5 12 5C16 5 19.5 7 22 12C19.5 17 16 19 12 19C8 19 4.5 17 2 12Z"
          fill="currentColor"
          fillOpacity="0.15"
        />
        {/* Pupil */}
        <circle cx="12" cy="12" r="2.5" fill="currentColor" />
        
        {/* Six radiating tentacle arms with nodes */}
        {/* Top */}
        <path d="M12 5V2.5" />
        <circle cx="12" cy="1.8" r="1" />
        {/* Bottom */}
        <path d="M12 19V21.5" />
        <circle cx="12" cy="22.2" r="1" />
        {/* Top-left */}
        <path d="M7.5 7L5.3 4.8" />
        <circle cx="4.6" cy="4.1" r="1" />
        {/* Top-right */}
        <path d="M16.5 7L18.7 4.8" />
        <circle cx="19.4" cy="4.1" r="1" />
        {/* Bottom-left */}
        <path d="M7.5 17L5.3 19.2" />
        <circle cx="4.6" cy="19.9" r="1" />
        {/* Bottom-right */}
        <path d="M16.5 17L18.7 19.2" />
        <circle cx="19.4" cy="19.9" r="1" />
      </svg>
    );
  }
);

HindsightIcon.displayName = 'HindsightIcon';
