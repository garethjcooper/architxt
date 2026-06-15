# Hooks

Custom React hooks used throughout the application.

## useMultiSelect

A custom hook for managing multi-select state across list pages.

### Overview

The `useMultiSelect` hook encapsulates all selection logic needed for pages with checkboxes and bulk actions. It handles:

- Individual item selection/deselection
- Select/deselect all functionality
- Selection state tracking
- Clearing selections

### Usage

```typescript
import { useMultiSelect } from '@/hooks/useMultiSelect';

export default function MyListPage() {
  const [items, setItems] = useState<Item[]>([]);
  
  // Initialize the hook with your items array
  const { 
    selected, 
    toggleSelection, 
    toggleAll, 
    clearSelection, 
    isSelected,
    isAllSelected,
    selectionCount,
    selectedIds
  } = useMultiSelect(items);

  return (
    <>
      {/* Select all checkbox */}
      <Checkbox
        checked={isAllSelected}
        onCheckedChange={toggleAll}
      />
      
      {/* Individual item checkboxes */}
      {items.map(item => (
        <Checkbox
          key={item.id}
          checked={isSelected(item.id)}
          onCheckedChange={() => toggleSelection(item.id)}
        />
      ))}
      
      {/* Display selection count */}
      <span>Selected: {selectionCount}</span>
      
      {/* Bulk action with selected IDs */}
      <Button 
        onClick={() => handleBulkAction(selectedIds)}
        disabled={selectionCount === 0}
      >
        Delete ({selectionCount})
      </Button>
    </>
  );
}
```

### API

#### Parameters

- `items?: T[]` - Array of items with `id: number` property (default: `[]`)

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `selected` | `Set<number>` | Set of selected item IDs |
| `setSelected` | `(value: Set<number>) => void` | Manually set the selected items |
| `toggleSelection` | `(id: number) => void` | Toggle selection of a single item |
| `toggleAll` | `() => void` | Toggle select/deselect all |
| `clearSelection` | `() => void` | Clear all selections |
| `isSelected` | `(id: number) => boolean` | Check if specific item is selected |
| `isAllSelected` | `boolean` | True if all items are selected |
| `selectionCount` | `number` | Number of selected items |
| `selectedIds` | `number[]` | Array of selected item IDs |

### Features

✅ **Generic**: Works with any item type that has an `id` property  
✅ **Performant**: Uses `useCallback` to prevent unnecessary re-renders  
✅ **Type-safe**: Full TypeScript support with generics  
✅ **Simple API**: Clean, intuitive method names  
✅ **Reusable**: Eliminates ~200 lines of duplicate selection logic across 5 pages  

### Pages Using This Hook

- `/app/documents/page.tsx`
- `/app/tags/page.tsx`
- `/app/contexts/page.tsx`
- `/app/metadata/page.tsx`
- `/app/servers/page.tsx`
