import React from 'react';

export function BadgeCompactIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Pill — narrower, leaving clear space for the dots */}
      <rect x="1" y="5.5" width="8" height="5" rx="2.5" ry="2.5" />
      {/* Three dots — well separated from the pill */}
      <circle cx="12.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
