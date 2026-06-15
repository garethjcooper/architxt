import React from 'react';

export function MetadataIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      className={className}
    >
      <text
        x="12"
        y="12"
        dominantBaseline="central"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        fontSize="16"
        fontWeight="700"
      >
        {'{ }'}
      </text>
    </svg>
  );
}
