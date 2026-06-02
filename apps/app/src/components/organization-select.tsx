import { DenOrgSummary } from "@/app/lib/den";
import { Field } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { Building2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrganizationSelectProps {
  className?: string;
  organizations: DenOrgSummary[];
  value: DenOrgSummary | null;
  onValueChange: (organization: DenOrgSummary | null) => void;
  disabled?: boolean;
}

export function OrganizationSelect({ className, organizations, value, onValueChange, disabled }: OrganizationSelectProps) {
  if (organizations.length === 0) {
    return <EmptyOrganizationSelect className={className} />;
  }

  return (
    <Field className={className}>
      <Select
        disabled={disabled}
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) onValueChange(nextValue);
        }}
      >
        <SelectTrigger className="h-18! w-full rounded-xl border-dls-border bg-dls-surface px-4 py-3 text-left hover:bg-dls-hover *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:line-clamp-none">
          <SelectValue>
            {(item: DenOrgSummary | null) => (
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Building2 size={18} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item?.name ?? "Select organization"}
                  </span>
                  {item ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {item.slug}
                    </span>
                  ) : null}
                </span>
                {item ? <Check size={16} className="shrink-0 text-green-11" /> : null}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectLabel>Organizations</SelectLabel>
            {organizations.map((organization) => (
                <SelectItem
                  key={organization.id}
                  value={organization}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left last:mb-0 [&>span:first-child]:min-w-0 [&>span:first-child]:flex-1 [&>span:last-child]:end-4 [&>span:last-child_svg]:text-green-11 hover:[&>span:last-child_svg]:text-green-11",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <Building2 size={18} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {organization.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {organization.slug}
                      </span>
                    </span>
                  </span>
                </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

interface EmptyOrganizationSelectProps {
  className?: string;
}

export function EmptyOrganizationSelect({ className }: EmptyOrganizationSelectProps) {
  return (
    <Field className={className}>
      <div className="flex h-18 w-full items-center gap-3 rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-left">
        <Building2 size={18} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            No organizations
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            Create an organization to get started
          </span>
        </span>
      </div>
    </Field>
  );
}

