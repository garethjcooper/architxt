'use client';

import { useState, useEffect } from 'react';
import { X, Trash2, Undo2 } from 'lucide-react';

interface ImageReviewModalProps {
  documentId: number;
  imageId: string;
  description: string;
  isDeleted: boolean;
  isOpen: boolean;
  onClose: () => void;
  onToggleDelete: () => void;
}

export function ImageReviewModal({
  documentId,
  imageId,
  description,
  isDeleted,
  isOpen,
  onClose,
  onToggleDelete,
}: ImageReviewModalProps) {
  const [imgError, setImgError] = useState(false);

  // Trap Escape key — only close this modal, don't bubble to parent
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    // Use capture phase to intercept before the shadcn Dialog sees it
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const imgSrc = `/api/v1/documents/${documentId}/images/${imageId}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[oklch(0.18_0_0)] border border-white/10 rounded-lg w-[900px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-medium text-white/90">
            Preview: [IMAGE:{imageId}]
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-white/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — top (image) / bottom (description) */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Image */}
          <div className="flex-shrink-0 p-4 flex items-center justify-center overflow-hidden bg-black/20 min-h-[180px]">
            {imgError ? (
              <div className="text-white/40 text-sm text-center">
                <p>Failed to load image</p>
                <p className="text-[11px] mt-1 opacity-60">{imgSrc}</p>
              </div>
            ) : (
              <img
                src={imgSrc}
                alt={imageId}
                className="max-w-full max-h-[45vh] object-contain rounded"
                onError={() => setImgError(true)}
              />
            )}
          </div>

          {/* Description */}
          <div className="flex-1 min-h-0 border-t border-white/10 p-4 overflow-y-auto">
            <p className="text-[11px] uppercase text-white/50 font-medium mb-2">
              Description
            </p>
            <div className="text-[13px] text-white/70 whitespace-pre-wrap font-mono">
              {description || <span className="italic text-white/30">No description</span>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => {
              onToggleDelete();
              onClose();
            }}
            className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
              isDeleted
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-red-400 hover:bg-red-500/10'
            }`}
          >
            {isDeleted ? (
              <>
                <Undo2 className="h-4 w-4" />
                <span>Restore</span>
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                <span>Remove from document</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Parse the inner description text from a multi-line image block. */
export function extractImageDescription(raw: string): string {
  const lines = raw.split('\n');
  const descLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('[/IMAGE:')) break;
    descLines.push(lines[i]);
  }
  return descLines.join('\n');
}
