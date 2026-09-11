import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toast } from "sonner"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Sanitize a string so it can be used as a file name base. */
export function sanitizeFilenameBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9\\-_]/g, '_').slice(0, 50);
}

/** Trigger a markdown download with a sanitized filename and a success toast. */
export function downloadMarkdown(markdown: string, title: string) {
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sanitizeFilenameBase(title)}-${date}.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded as ${filename}`);
}
