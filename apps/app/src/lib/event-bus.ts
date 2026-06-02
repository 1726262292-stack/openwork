import type { DenSettings, DenUser } from "@/app/lib/den";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";

export function createEventBus<TEvents extends object>() {
  const target = new EventTarget();

  return {
    on<TType extends keyof TEvents & string>(
      type: TType,
      listener: (event: CustomEvent<TEvents[TType]>) => void,
      options?: AddEventListenerOptions,
    ) {
      const wrapped: EventListenerObject = {
        handleEvent(event: CustomEvent<TEvents[TType]>) {
          listener(event);
        },
      };

      target.addEventListener(type, wrapped, options);

      return () => {
        target.removeEventListener(type, wrapped, options);
      };
    },

    emit<TType extends keyof TEvents & string>(
      type: TType,
      detail?: TEvents[TType],
      options?: Omit<CustomEventInit<TEvents[TType]>, "detail">,
    ) {
      return target.dispatchEvent(
        new CustomEvent(type, {
          ...options,
          detail,
        }),
      );
    },
  };
}

type NewProviderInfo = {
  id: string;
  name: string;
  providerId: string;
  firstModelId?: string;
  firstModelName?: string;
};


interface AppEvents {
  "openwork-den-session-updated": {
    status?: "success" | "error" | "signed_out";
    baseUrl?: string | null;
    token?: string | null;
    user?: DenUser | null;
    email?: string | null;
    message?: string | null;
  };
  "openwork-den-settings-changed": { settings: DenSettings };
  "openwork-new-providers-available": {
    providers: NewProviderInfo[];
    newProviderCount?: number;
    newModelCount?: number;
    source: "cloud_sync" | "local_config" | "models_refresh" | "sign_in";
  };
  "openwork-openwork-models-promo-changed": undefined;
  "openwork-open-model-picker": { newProviderIds?: string[]; initialTab?: "default" | "available" } | undefined;
  "openwork-org-onboarding-visibility": { visible?: boolean };
  "openwork-server-settings-changed": undefined;
  "openwork:focusPrompt": undefined;
  "openwork:flushPromptDraft": undefined;
  "openwork:voice-transcript": { text: string };
  "openwork-open-accessible-target": OpenTarget;
  "openwork-hide-accessible-target": OpenTarget;
  "openwork-close-right-pane": undefined;
}

export type InferAppEvent<TType extends keyof AppEvents & string> = CustomEvent<AppEvents[TType]>;
export type InferAppEventDetails<TType extends keyof AppEvents & string> = AppEvents[TType];

export const events = createEventBus<AppEvents>();
