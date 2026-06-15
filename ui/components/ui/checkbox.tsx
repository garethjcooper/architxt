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
        "focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50",
        // Checked state - emerald/green background
        "data-[checked]:border-emerald-500 data-[checked]:bg-emerald-500",
        // Disabled state  
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Custom background for unchecked
        "bg-[oklch(0.23_0_0)]",
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
