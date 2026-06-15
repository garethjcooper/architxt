# architxt UI Style Guide

Visual patterns for consistent interface design aligned with Hindsight Control Plane.

## Dark Theme Colors

| Element | Value | Notes |
|---------|-------|-------|
| Main content background | `oklch(0.17_0_0)` | Deepest dark |
| Sidebar background | `oklch(0.22_0_0)` | Slightly elevated |
| Table/cards | `oklch(0.23_0_0)` | Surface elevation |
| Inactive nav text | `text-white/70` | Secondary content |
| Table headers | `text-white/60` | Tertiary labels |
| Borders | `border-white/10` | Subtle separation |
| Hover states | `bg-white/5` | Minimal feedback |

## Accent Color (Green Identity)

```
Separator: bg-gradient-to-r from-emerald-700 via-green-500 to-green-400
Active tab: text-emerald-500 border-emerald-500 font-bold
Inactive tab: text-white/70 hover:text-white font-medium
```

This green gradient distinguishes architxt from Hindsight's cyan/blue.

## Typography Hierarchy

| Level | Classes | Use Case |
|-------|---------|----------|
| H1 | `text-3xl font-bold tracking-tight` | Page titles |
| H2 | `text-lg font-semibold` | Section headers |
| Body | `text-sm` | Data, content |
| Tab | `text-sm` + `font-bold` (active) or `font-medium` | Navigation |

## Layout Patterns

Use `PageShell` component for consistent page structure:

```tsx
<PageShell
  title="Page Name"
  subtitle="Human-readable description"
  count={items.length}
  countLabel="item"
  tabs={[...]}
  activeTab={active}
  onTabChange={setActive}
  loading={isLoading}
>
  {pageContent}
</PageShell>
```

PageShell provides:
- Header with title/subtitle
- Tab navigation (optional)
- Row count between tabs and content
- Consistent spacing and colors

## Component Defaults

**Buttons**
- Primary: implicit (no variant) with gradient background
- Ghost: `variant="ghost"` for icon buttons

**Tables**
- Header: uppercase, `text-white/60`, `py-1.5`
- Rows: `border-b border-white/5`, `hover:bg-white/5`
- Borders: minimal, `border-white/10` for headers

**Cards**
- Background: `bg-[oklch(0.23_0_0)]`
- Border: `border-white/[0.08]`
- Rounded: `rounded-md`

## Spacing

| Element | Spacing |
|---------|---------|
| Header to content | `mt-4` |
| Tabs to count | no gap |
| Count to table | `mt-2` |
| Table internal | `py-1.5` rows |
| Sidebar nav | `space-y-1`, `py-3` items |

## Responsive

Sidebar collapses to icon-only at `w-16`. Navigation items center icons when collapsed.

## Migration Notes

When creating new pages:
1. Import `PageShell` from `@/app/components/page-shell`
2. Define `TABS` constant with `{ value, label }` shape
3. Pass `count`, `countLabel` for row count display
4. Wrap content in `PageShell`, use provided spacing
5. Use `text-white/70` for secondary text, not `text-muted-foreground`

---
Last updated: 2026-05-31
