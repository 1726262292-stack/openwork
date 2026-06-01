/** @jsxImportSource react */
import {
  Page,
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { KeyRoundIcon, SkipForwardIcon, SparklesIcon } from "lucide-react";

type ProviderSelectionStepProps = {
  onOpenWorkModels: () => void;
  onBringYourOwn: () => void;
  onSkip: () => void;
};

export function ProviderSelectionStep({
  onOpenWorkModels,
  onBringYourOwn,
  onSkip,
}: ProviderSelectionStepProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <PageBackground />
      <PageTitlebarRegion />

      <div className="relative z-10 w-full max-w-md px-6">
        <PageHeader className="mb-8 text-center">
          <PageTitle>Choose your AI models</PageTitle>
          <PageDescription>
            Pick how you want to power your workspace.
          </PageDescription>
        </PageHeader>

        <div className="space-y-3">
          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-blue-7/50 bg-blue-2/30 p-4 text-left transition-colors hover:bg-blue-3/40"
            onClick={onOpenWorkModels}
          >
            <SparklesIcon className="mt-0.5 size-5 shrink-0 text-blue-10" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Get started with OpenWork Models
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Sign up for OpenWork Cloud to access managed AI models.
              </div>
            </div>
          </button>

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Bring your own API key
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Connect an existing provider like Anthropic, OpenAI, or Google.
              </div>
            </div>
          </button>

          <div className="pt-1 text-center">
            <Button variant="ghost" size="sm" onClick={onSkip}>
              <SkipForwardIcon className="mr-1.5 size-3.5" />
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
