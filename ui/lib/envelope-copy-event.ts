export type EnvelopeCopyEvent =
  | { type: 'narrative'; payload: string; label?: string; evidence?: string[]; id?: string }
  | { type: 'graph'; payload: string; label?: string; evidence?: string[]; id?: string }
  | { type: 'tables'; payload: string; label?: string; evidence?: string[]; id?: string }
  | { type: 'diagrams'; payload: string; label?: string; evidence?: string[]; id?: string };
