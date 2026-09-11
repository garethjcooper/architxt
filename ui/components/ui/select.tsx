'use client';

import * as React from 'react';
import { Select as SelectUI } from '@base-ui/react/select';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const Select = SelectUI.Root;
const SelectGroup = SelectUI.Group;
const SelectValue = SelectUI.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectUI.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectUI.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectUI.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-border-default bg-surface-card px-3 py-2 text-sm placeholder:text-foreground-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring-subtle focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
    <ChevronDown className="h-4 w-4 opacity-50 ml-2 pointer-events-none" />
  </SelectUI.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

function SelectPopup({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectUI.Popup>) {
  return (
    <SelectUI.Portal>
      <SelectUI.Positioner align="start" sideOffset={4}>
        <SelectUI.Popup
          className={cn(
            'relative z-50 min-w-[8rem] overflow-hidden rounded-md border border-border-default bg-surface-panel p-1 text-foreground-default shadow-md',
            className
          )}
          {...props}
        />
      </SelectUI.Positioner>
    </SelectUI.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof SelectUI.Item>) {
  return (
    <SelectUI.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-surface-panel data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-surface-panel',
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectUI.ItemIndicator className="h-2 w-2 bg-accent-primary-solid rounded-full" />
      </span>
      <SelectUI.ItemText>{children}</SelectUI.ItemText>
    </SelectUI.Item>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectUI.Separator>) {
  return <SelectUI.Separator className={cn('-mx-1 my-1 h-px bg-surface-panel', className)} {...props} />;
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectPopup,
  SelectItem,
  SelectSeparator,
};
