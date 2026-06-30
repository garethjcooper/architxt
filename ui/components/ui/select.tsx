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
      'flex h-10 w-full items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
    <ChevronDown className="h-4 w-4 opacity-50 ml-2" />
  </SelectUI.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectPopup = React.forwardRef<
  React.ElementRef<typeof SelectUI.Popup>,
  React.ComponentPropsWithoutRef<typeof SelectUI.Popup>
>(({ className, ...props }, ref) => (
  <SelectUI.Positioner>
    <SelectUI.Popup
      ref={ref}
      className={cn(
        'relative z-50 min-w-[8rem] overflow-hidden rounded-md border border-white/10 bg-[oklch(0.21_0_0)] p-1 text-white shadow-md data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className
      )}
      {...props}
    />
  </SelectUI.Positioner>
));
SelectPopup.displayName = 'SelectPopup';

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectUI.Item>,
  React.ComponentPropsWithoutRef<typeof SelectUI.Item>
>(({ className, children, ...props }, ref) => (
  <SelectUI.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-white/10',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectUI.ItemIndicator className="h-2 w-2 bg-emerald-500 rounded-full" />
    </span>
    <SelectUI.ItemText>{children}</SelectUI.ItemText>
  </SelectUI.Item>
));
SelectItem.displayName = 'SelectItem';

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectUI.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectUI.Separator>
>(({ className, ...props }, ref) => (
  <SelectUI.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-white/10', className)} {...props} />
));
SelectSeparator.displayName = 'SelectSeparator';

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectPopup,
  SelectItem,
  SelectSeparator,
};
