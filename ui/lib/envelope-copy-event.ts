export type EnvelopeCopyEvent =
  | { type: 'narrative'; payload: string; label?: string }
  | { type: 'graph'; payload: string; label?: string }
  | { type: 'tables'; payload: string; label?: string }
  | { type: 'diagrams'; payload: string; label?: string };
