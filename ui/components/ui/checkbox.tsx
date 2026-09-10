"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // Unchecked state or base
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-white/30 transition-colors outline-none cursor-pointer",
        // Hover state
        "hover:border-white/50",
        // Focus state
        "focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle",
        // Checked state - accent background
        "data-[checked]:border-accent-primary-bd data-[checked]:bg-accent-primary-solid",
        // Disabled state  
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Custom background for unchecked
        "bg-surface-card",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="h-3.5 w-3.5 text-white" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
