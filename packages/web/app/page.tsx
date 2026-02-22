import { CloudControlPanel } from "../components/cloud-control";

const quickFlow = [
  {
    title: "1) Log in",
    copy: "Use email and password. If needed, create an account from the same form."
  },
  {
    title: "2) Handle paywall",
    copy: "If checkout is required, pay in Polar and return to this same page."
  },
  {
    title: "3) Launch + connect",
    copy: "After launch, copy Worker URL and Worker API key into the OpenWork app."
  }
];

const reminders = [
  "Worker IDs can be reused later for status checks.",
  "You can generate a new worker API key any time from the launch card.",
  "Launch log entries help you understand every step in this flow."
];

export default function HomePage() {
  return (
    <main className="relative overflow-hidden pb-16 pt-8 sm:pt-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-6 lg:px-8">
        <header className="surface fade-up p-6 sm:p-8">
          <p className="eyebrow">OpenWork Cloud Worker Setup</p>
          <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-tight text-brandInk sm:text-5xl">
            Sign in, launch your cloud worker, and connect with worker credentials.
          </h1>
          <p className="fade-up fade-delay mt-4 max-w-3xl text-base leading-relaxed text-[#534a62] sm:text-lg">
            This app runs on <span className="mono">app.openwork.software</span> and safely proxies
            requests to <span className="mono">api.openwork.software</span>.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {quickFlow.map((item) => (
            <article key={item.title} className="feature-card p-5">
              <h2 className="text-lg font-semibold text-brandInk">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#594f69]">{item.copy}</p>
            </article>
          ))}
        </section>

        <CloudControlPanel />

        <section className="surface p-6 sm:p-7">
          <h2 className="text-xl font-semibold text-brandInk">Keep these details</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {reminders.map((item, index) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-xl border border-[#e3d6c8] bg-white/85 px-4 py-3"
              >
                <span className="mono inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#d4c6b7] bg-[#fff6eb] text-xs font-semibold text-[#593a2a]">
                  {index + 1}
                </span>
                <p className="text-sm text-[#4b4259]">{item}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
