import { useState, useCallback } from 'react';

/**
 * Custom hook for managing multi-select state
 * Handles selection state, toggle logic, and all-select functionality
 * Works with any item type that has an `id` property
 */
export function useMultiSelect<T extends { id: number }>(items: T[] = []) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  /**
   * Toggle selection of a single item
   */
  const toggleSelection = useCallback((id: number) => {
    setSelected((prevSelected) => {
      const newSelected = new Set(prevSelected);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  /**
   * Toggle select all / deselect all
   * If all items are selected, deselect all
   * Otherwise, select all items
   */
  const toggleAll = useCallback(() => {
    setSelected((prevSelected) => {
      if (prevSelected.size === items.length && items.length > 0) {
        return new Set();
      } else {
        return new Set(items.map((item) => item.id));
      }
    });
  }, [items]);

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  /**
   * Check if an item is selected
   */
  const isSelected = useCallback(
    (id: number) => selected.has(id),
    [selected]
  );

  /**
   * Check if all items are selected
   */
  const isAllSelected = items.length > 0 && selected.size === items.length;

  /**
   * Get count of selected items
   */
  const selectionCount = selected.size;

  /**
   * Get array of selected IDs
   */
  const selectedIds = Array.from(selected);

  return {
    selected,
    setSelected,
    toggleSelection,
    toggleAll,
    clearSelection,
    isSelected,
    isAllSelected,
    selectionCount,
    selectedIds,
  };
}
