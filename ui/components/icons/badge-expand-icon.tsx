import React from 'react';

export function BadgeExpandIcon({ className = 'h-5 w-5' }: { className?: string }) {
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
      {/* Pill — narrower, leaving clear space for the plus */}
      <rect x="1" y="5.5" width="8" height="5" rx="2.5" ry="2.5" />
      {/* Plus — well separated from the pill */}
      <line x1="13" y1="6" x2="13" y2="10" />
      <line x1="11.5" y1="8" x2="14.5" y2="8" />
    </svg>
  );
}
