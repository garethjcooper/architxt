import React from 'react';

export function ArchitxtIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Outer ring — like a document boundary or portal */}
      <circle cx="12" cy="12" r="9" />
      {/* Inner 'a' arc — a partial ellipse, geometric */}
      <path d="M15.5 12.5c0 1.9-1.6 3.5-3.5 3.5s-3.5-1.6-3.5-3.5 1.6-3.5 3.5-3.5c.8 0 1.5.3 2.1.7" />
      {/* Tail of the @ — an architectural line descending */}
      <path d="M15.5 12.5V16c0 2.5-2 4.5-4.5 4.5" />
    </svg>
  );
}
