import { useState, useEffect, useRef, useCallback } from "react";

const DEFAULT_RIGHT_SPLITS = { input: 0.5, output: 0.5 };
const DEFAULT_FIELD_SPLITS = { histogram: 0.62, fields: 0.38 };
const DEFAULT_SEQ_SPLITS = { fields: 0.5, sequences: 0.5 };
const DEFAULT_COLUMN_WIDTHS = { left: 0.34, middle: 0.33, right: 0.33 };
const MIN = 0.08;

type ColumnWidths = { left: number; middle: number; right: number };
type RightSplits = { input: number; output: number };
type FieldSplits = { histogram: number; fields: number };
type SeqSplits = { fields: number; sequences: number };

/**
 * Persisted resizer state for the trace-profile editor.
 *
 * Layout:
 *   - Three top-level columns (left profile data, middle build, right samples).
 *   - Right column stacks input sample and output sample.
 *
 * All handles use delta-based math against the actual measured size of the
 * container they affect, and a ResizeObserver keeps measurements current
 * through modal open/close animations.
 */
export function useTraceProfileResizers(storageKey = "traceProfileResizers") {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(DEFAULT_COLUMN_WIDTHS);
  const [rightSplits, setRightSplits] = useState<RightSplits>(DEFAULT_RIGHT_SPLITS);
  const [fieldSplits, setFieldSplits] = useState<FieldSplits>(DEFAULT_FIELD_SPLITS);
  const [seqSplits, setSeqSplits] = useState<SeqSplits>(DEFAULT_SEQ_SPLITS);
  const [resizing, setResizing] = useState<string | null>(null);

  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const rightColumnSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const fieldColumnSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const seqColumnSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const pendingColumnWidths = useRef<ColumnWidths | null>(null);
  const pendingRightSplits = useRef<RightSplits | null>(null);
  const pendingFieldSplits = useRef<FieldSplits | null>(null);
  const pendingSeqSplits = useRef<SeqSplits | null>(null);

  const resizeStartRef = useRef<{
    handleId: string;
    startX: number;
    startY: number;
    totalWidth: number;
    rightColumnHeight: number;
    fieldColumnHeight: number;
    seqColumnHeight: number;
    columnWidths: ColumnWidths;
    rightSplits: RightSplits;
    fieldSplits: FieldSplits;
    seqSplits: SeqSplits;
  } | null>(null);

  const flushRafRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.columnWidths) setColumnWidths(normalizeColumnWidths(parsed.columnWidths));
      if (parsed.rightSplits) {
        const rs = parsed.rightSplits;
        const input = Number(rs.input) || DEFAULT_RIGHT_SPLITS.input;
        const output = Number(rs.output) || DEFAULT_RIGHT_SPLITS.output;
        const total = input + output;
        setRightSplits({
          input: total > 0 ? input / total : DEFAULT_RIGHT_SPLITS.input,
          output: total > 0 ? output / total : DEFAULT_RIGHT_SPLITS.output,
        });
      }
      if (parsed.fieldSplits) {
        const fs = parsed.fieldSplits;
        const histogram = Number(fs.histogram) || DEFAULT_FIELD_SPLITS.histogram;
        const fields = Number(fs.fields) || DEFAULT_FIELD_SPLITS.fields;
        const total = histogram + fields;
        setFieldSplits({
          histogram: total > 0 ? histogram / total : DEFAULT_FIELD_SPLITS.histogram,
          fields: total > 0 ? fields / total : DEFAULT_FIELD_SPLITS.fields,
        });
      }
      if (parsed.seqSplits) {
        const ss = parsed.seqSplits;
        const fields = Number(ss.fields) || DEFAULT_SEQ_SPLITS.fields;
        const sequences = Number(ss.sequences) || DEFAULT_SEQ_SPLITS.sequences;
        const total = fields + sequences;
        setSeqSplits({
          fields: total > 0 ? fields / total : DEFAULT_SEQ_SPLITS.fields,
          sequences: total > 0 ? sequences / total : DEFAULT_SEQ_SPLITS.sequences,
        });
      }
    } catch {
      // ignore corrupt localStorage
    }
  }, [storageKey]);

  const persist = useCallback(
    (updates: Partial<{ columnWidths: ColumnWidths; rightSplits: RightSplits; fieldSplits: FieldSplits; seqSplits: SeqSplits }>) => {
      const next = {
        columnWidths: updates.columnWidths ?? columnWidths,
        rightSplits: updates.rightSplits ?? rightSplits,
        fieldSplits: updates.fieldSplits ?? fieldSplits,
        seqSplits: updates.seqSplits ?? seqSplits,
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [columnWidths, rightSplits, fieldSplits, seqSplits, storageKey]
  );

  const flushPending = useCallback(() => {
    flushRafRef.current = null;

    if (pendingColumnWidths.current) {
      setColumnWidths(pendingColumnWidths.current);
      persist({ columnWidths: pendingColumnWidths.current });
      pendingColumnWidths.current = null;
    }
    if (pendingRightSplits.current) {
      setRightSplits(pendingRightSplits.current);
      persist({ rightSplits: pendingRightSplits.current });
      pendingRightSplits.current = null;
    }
    if (pendingFieldSplits.current) {
      setFieldSplits(pendingFieldSplits.current);
      persist({ fieldSplits: pendingFieldSplits.current });
      pendingFieldSplits.current = null;
    }
    if (pendingSeqSplits.current) {
      setSeqSplits(pendingSeqSplits.current);
      persist({ seqSplits: pendingSeqSplits.current });
      pendingSeqSplits.current = null;
    }
  }, [persist]);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current != null) return;
    flushRafRef.current = requestAnimationFrame(() => {
      flushPending();
      if (
        pendingColumnWidths.current != null ||
        pendingRightSplits.current != null ||
        pendingFieldSplits.current != null ||
        pendingSeqSplits.current != null
      ) {
        scheduleFlush();
      }
    });
  }, [flushPending]);

  const measure = useCallback(() => {
    // Called by the consumer after the modal is fully visible so the first
    // ResizeObserver callback is not missed due to portal/animation quirks.
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      containerSizeRef.current = { width: rect.width, height: rect.height };
    }
    if (rightColumnRef.current) {
      const rect = rightColumnRef.current.getBoundingClientRect();
      rightColumnSizeRef.current = { width: rect.width, height: rect.height };
    }
    if (fieldColumnRef.current) {
      const rect = fieldColumnRef.current.getBoundingClientRect();
      fieldColumnSizeRef.current = { width: rect.width, height: rect.height };
    }
    if (seqColumnRef.current) {
      const rect = seqColumnRef.current.getBoundingClientRect();
      seqColumnSizeRef.current = { width: rect.width, height: rect.height };
    }
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const fieldColumnRef = useRef<HTMLDivElement | null>(null);
  const seqColumnRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const bindContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (!el) {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    containerSizeRef.current = { width: rect.width, height: rect.height };
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          containerSizeRef.current = { width: cr.width, height: cr.height };
        }
      });
    }
    resizeObserverRef.current.observe(el);
  }, []);

  const bindRightColumnRef = useCallback((el: HTMLDivElement | null) => {
    rightColumnRef.current = el;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    rightColumnSizeRef.current = { width: rect.width, height: rect.height };
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          rightColumnSizeRef.current = { width: cr.width, height: cr.height };
        }
      });
    }
    resizeObserverRef.current.observe(el);
  }, []);

  const bindFieldColumnRef = useCallback((el: HTMLDivElement | null) => {
    fieldColumnRef.current = el;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    fieldColumnSizeRef.current = { width: rect.width, height: rect.height };
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          fieldColumnSizeRef.current = { width: cr.width, height: cr.height };
        }
      });
    }
    resizeObserverRef.current.observe(el);
  }, []);

  const bindSeqColumnRef = useCallback((el: HTMLDivElement | null) => {
    seqColumnRef.current = el;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    seqColumnSizeRef.current = { width: rect.width, height: rect.height };
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          seqColumnSizeRef.current = { width: cr.width, height: cr.height };
        }
      });
    }
    resizeObserverRef.current.observe(el);
  }, []);

  const handleResizeMove = useCallback(
    (moveEvent: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const { handleId } = start;

      if (handleId === "col1") {
        const { totalWidth, columnWidths: widths, startX } = start;
        if (totalWidth <= 0) return;
        const delta = (moveEvent.clientX - startX) / totalWidth;
        const nextLeft = Math.max(MIN, Math.min(widths.left + delta, 1 - 2 * MIN));
        const remaining = 1 - nextLeft;
        const middleRatio = widths.middle / (widths.middle + widths.right);
        const nextMiddle = remaining * middleRatio;
        const nextRight = remaining - nextMiddle;
        pendingColumnWidths.current = { left: nextLeft, middle: nextMiddle, right: nextRight };
        scheduleFlush();
      } else if (handleId === "col2") {
        const { totalWidth, columnWidths: widths, startX } = start;
        if (totalWidth <= 0) return;
        const delta = (moveEvent.clientX - startX) / totalWidth;
        const nextMiddle = Math.max(MIN, Math.min(widths.middle + delta, 1 - widths.left - MIN));
        const nextRight = 1 - widths.left - nextMiddle;
        pendingColumnWidths.current = { left: widths.left, middle: nextMiddle, right: nextRight };
        scheduleFlush();
      } else if (handleId === "row4") {
        const { rightColumnHeight, rightSplits: splits, startY } = start;
        if (rightColumnHeight <= 0) return;
        const delta = (moveEvent.clientY - startY) / rightColumnHeight;
        const total = splits.input + splits.output;
        const nextInput = Math.max(MIN, Math.min(splits.input + delta, total - MIN));
        const nextOutput = total - nextInput;
        pendingRightSplits.current = { input: nextInput, output: nextOutput };
        scheduleFlush();
      } else if (handleId === "fieldRows") {
        const { fieldColumnHeight, fieldSplits: splits, startY } = start;
        if (fieldColumnHeight <= 0) return;
        const delta = (moveEvent.clientY - startY) / fieldColumnHeight;
        const total = splits.histogram + splits.fields;
        const nextHistogram = Math.max(MIN, Math.min(splits.histogram + delta, total - MIN));
        const nextFields = total - nextHistogram;
        pendingFieldSplits.current = { histogram: nextHistogram, fields: nextFields };
        scheduleFlush();
      } else if (handleId === "seqRows") {
        const { seqColumnHeight, seqSplits: splits, startY } = start;
        if (seqColumnHeight <= 0) return;
        const delta = (moveEvent.clientY - startY) / seqColumnHeight;
        const total = splits.fields + splits.sequences;
        const nextFields = Math.max(MIN, Math.min(splits.fields + delta, total - MIN));
        const nextSequences = total - nextFields;
        pendingSeqSplits.current = { fields: nextFields, sequences: nextSequences };
        scheduleFlush();
      }
    },
    [scheduleFlush]
  );

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
    resizeStartRef.current = null;
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    flushPending();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
  }, [flushPending, handleResizeMove]);

  const handleResizeStart = useCallback(
    (handleId: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      setResizing(handleId);

      const totalWidth = containerSizeRef.current.width;
      const rightColumnHeight = rightColumnSizeRef.current.height;
      const fieldColumnHeight = fieldColumnSizeRef.current.height;
      const seqColumnHeight = seqColumnSizeRef.current.height;

      resizeStartRef.current = {
        handleId,
        startX: e.clientX,
        startY: e.clientY,
        totalWidth,
        rightColumnHeight,
        fieldColumnHeight,
        seqColumnHeight,
        columnWidths,
        rightSplits,
        fieldSplits,
        seqSplits,
      };

      document.body.style.cursor = handleId === "row4" || handleId === "fieldRows" || handleId === "seqRows" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";

      window.addEventListener("mousemove", handleResizeMove);
      window.addEventListener("mouseup", handleResizeEnd);
    },
    [columnWidths, rightSplits, fieldSplits, seqSplits, handleResizeMove, handleResizeEnd]
  );

  const handleResizeReset = useCallback(
    (handleId: string) => {
      if (handleId === "row4") {
        const total = rightSplits.input + rightSplits.output;
        const next = { input: total / 2, output: total / 2 };
        setRightSplits(next);
        persist({ rightSplits: next });
      } else if (handleId === "fieldRows") {
        const total = fieldSplits.histogram + fieldSplits.fields;
        const next = { histogram: total * DEFAULT_FIELD_SPLITS.histogram / (DEFAULT_FIELD_SPLITS.histogram + DEFAULT_FIELD_SPLITS.fields), fields: total * DEFAULT_FIELD_SPLITS.fields / (DEFAULT_FIELD_SPLITS.histogram + DEFAULT_FIELD_SPLITS.fields) };
        setFieldSplits(next);
        persist({ fieldSplits: next });
      } else if (handleId === "seqRows") {
        const total = seqSplits.fields + seqSplits.sequences;
        const next = { fields: total / 2, sequences: total / 2 };
        setSeqSplits(next);
        persist({ seqSplits: next });
      } else if (["col1", "col2"].includes(handleId)) {
        const next = { ...DEFAULT_COLUMN_WIDTHS };
        setColumnWidths(next);
        persist({ columnWidths: next });
      }
    },
    [rightSplits, fieldSplits, seqSplits, persist]
  );

  return {
    columnWidths,
    rightSplits,
    fieldSplits,
    seqSplits,
    resizing,
    handleResizeStart,
    handleResizeReset,
    measure,
    bindContainerRef,
    bindRightColumnRef,
    bindFieldColumnRef,
    bindSeqColumnRef,
  };
}

function normalizeColumnWidths(value: unknown): ColumnWidths {
  const v = value as Partial<ColumnWidths> | undefined;
  const left = Number(v?.left) || DEFAULT_COLUMN_WIDTHS.left;
  const middle = Number(v?.middle) || DEFAULT_COLUMN_WIDTHS.middle;
  const right = Number(v?.right) || DEFAULT_COLUMN_WIDTHS.right;
  const total = left + middle + right;
  if (total <= 0) return { ...DEFAULT_COLUMN_WIDTHS };
  return { left: left / total, middle: middle / total, right: right / total };
}
