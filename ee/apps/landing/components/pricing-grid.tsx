import { ArrowUpRight, Cloud, Download, Monitor, Shield } from "lucide-react";

type PricingGridProps = {
  windowsCheckoutUrl: string;
  callUrl: string;
  showHeader?: boolean;
};

type PricingCard = {
  id: string;
  eyebrow: string;
  title: string;
  price: string;
  priceSub: string;
  description: string;
  ctaLabel: string;
  href: string;
  external?: boolean;
  features: string[];
  footer: string;
  icon: typeof Download;
  accent: string;
};

function PricingAction(props: { href: string; label: string; external?: boolean }) {
  return (
    <a
      href={props.href}
      {...(props.external ? { rel: "noreferrer", target: "_blank" as const } : {})}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#011627] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#16293f]"
    >
      {props.label}
      <ArrowUpRight size={15} />
    </a>
  );
}

function PricingCardView(card: PricingCard) {
  const Icon = card.icon;

  return (
    <article
      id={card.id}
      className="group relative flex h-full flex-col overflow-hidden rounded-[28px] border border-dotted border-gray-300/80 bg-[#efefef] p-6 transition duration-300 hover:-translate-y-1 hover:border-gray-400/80 hover:shadow-[0_28px_60px_-30px_rgba(15,23,42,0.35)]"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100"
        style={{ background: card.accent }}
      />

      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-8 rounded-[22px] border border-white/70 bg-white/80 p-5 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.3)] transition group-hover:border-white/20 group-hover:bg-white/10 group-hover:shadow-none">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500 transition group-hover:text-white/70">
                {card.eyebrow}
              </div>
              <h3 className="text-xl font-medium tracking-tight text-[#011627] transition group-hover:text-white">
                {card.title}
              </h3>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white/80 p-2.5 text-gray-600 transition group-hover:border-white/20 group-hover:bg-white/10 group-hover:text-white/90">
              <Icon size={18} />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <span className="text-3xl font-semibold tracking-tight text-[#011627] transition group-hover:text-white">
              {card.price}
            </span>
            <span className="pb-1 text-xs font-medium text-gray-500 transition group-hover:text-white/70">
              {card.priceSub}
            </span>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-gray-600 transition group-hover:text-white/80">
            {card.description}
          </p>

          <div className="mt-6">
            <PricingAction href={card.href} label={card.ctaLabel} external={card.external} />
          </div>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="mb-3 inline-flex items-center gap-1.5 border-b border-dotted border-gray-300/90 pb-3 text-[12px] font-medium text-gray-500 transition group-hover:border-white/20 group-hover:text-white/70">
            Included
          </div>

          <div className="flex flex-1 flex-col">
            {card.features.map((feature) => (
              <div
                key={feature}
                className="border-b border-dotted border-gray-300/80 py-3 text-[13px] font-medium text-gray-700 transition last:border-b-0 group-hover:border-white/15 group-hover:text-white/88"
              >
                {feature}
              </div>
            ))}
          </div>

          <div className="mt-8 text-sm font-medium text-gray-700 transition group-hover:text-white/88">
            {card.footer}
          </div>
        </div>
      </div>
    </article>
  );
}

export function PricingGrid(props: PricingGridProps) {
  const cards: PricingCard[] = [
    {
      id: "solo",
      eyebrow: "Solo",
      title: "Free forever",
      price: "$0",
      priceSub: "open source",
      description:
        "Start on desktop for free with macOS and Linux downloads, local models, and bring-your-own-provider workflows.",
      ctaLabel: "Download free",
      href: "/download",
      features: [
        "Open source desktop app",
        "macOS and Linux downloads",
        "Bring your own keys and local models"
      ],
      footer: "Best for individual builders and local-first workflows.",
      icon: Download,
      accent: "linear-gradient(135deg, #4b5563 0%, #111827 100%)"
    },
    {
      id: "windows-support",
      eyebrow: "Windows",
      title: "Windows support",
      price: "$99",
      priceSub: "per year · 1 seat",
      description:
        "Annual Windows access includes the binary plus one year of updates. In phase one we send the build link manually after purchase.",
      ctaLabel: "Purchase Windows support",
      href: props.windowsCheckoutUrl,
      external: /^https?:\/\//.test(props.windowsCheckoutUrl),
      features: [
        "1 Windows seat",
        "Binary access",
        "1 year of updates"
      ],
      footer: "Manual fulfillment first, hosted delivery later.",
      icon: Monitor,
      accent: "linear-gradient(135deg, #7c3aed 0%, #1f2937 100%)"
    },
    {
      id: "cloud-workers",
      eyebrow: "Cloud workers",
      title: "One worker at a time",
      price: "$50",
      priceSub: "per month · per worker",
      description:
        "Workers stay disabled by default. Buy worker access when you want a hosted OpenWork worker for your account.",
      ctaLabel: "Purchase worker",
      href: "https://app.openworklabs.com/checkout",
      external: true,
      features: [
        "Hosted OpenWork worker",
        "Monthly billing",
        "Purchase required before launch"
      ],
      footer: "Designed for cloud usage without forcing hosted billing on solo desktop users.",
      icon: Cloud,
      accent: "linear-gradient(135deg, #2563eb 0%, #0f172a 100%)"
    },
    {
      id: "enterprise-license",
      eyebrow: "Enterprise",
      title: "Talk to us",
      price: "Custom",
      priceSub: "licensing",
      description:
        "Enterprise licensing includes Windows support, rollout help, and managed or self-hosted deployment paths for larger teams.",
      ctaLabel: "Talk to us",
      href: props.callUrl,
      external: /^https?:\/\//.test(props.callUrl),
      features: [
        "Includes Windows support",
        "Deployment and rollout guidance",
        "Custom commercial terms"
      ],
      footer: "Use this when you need org-wide rollout, controls, or custom terms.",
      icon: Shield,
      accent: "linear-gradient(135deg, #fb923c 0%, #111827 100%)"
    }
  ];

  return (
    <section className="grid gap-8">
      {props.showHeader !== false ? (
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-500">
              Pricing
            </div>
            <h2 className="text-3xl font-medium leading-[1.1] tracking-tight text-[#011627] md:text-4xl lg:text-5xl">
              Gray by default. Clear when you hover.
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-gray-600 md:text-right md:text-base">
            Solo stays free forever. Windows is annual. Cloud workers are monthly. Enterprise starts with a conversation.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-4 md:grid-cols-2">
        {cards.map((card) => (
          <PricingCardView key={card.id} {...card} />
        ))}
      </div>

      <p className="text-center text-[12px] font-medium text-gray-500">
        Prices exclude taxes. Windows delivery is manual in phase one.
      </p>
    </section>
  );
}
