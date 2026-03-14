import Image from "next/image";
import { CloudControlPanel } from "../components/cloud-control";

export default function HomePage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[var(--dls-app-bg)] text-[var(--dls-text-primary)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <span className="absolute -left-24 top-[-8rem] h-[24rem] w-[24rem] rounded-full bg-slate-200/70 blur-[120px]" />
        <span className="absolute right-[-6rem] top-20 h-[20rem] w-[20rem] rounded-full bg-indigo-100/40 blur-[120px]" />
        <span className="absolute bottom-[-10rem] left-1/3 h-[18rem] w-[18rem] rounded-full bg-slate-100 blur-[120px]" />
      </div>

      <header className="relative z-10 flex w-full items-center gap-3 px-4 pt-4 md:px-6 md:pt-5">
        <div className="inline-flex items-center gap-3">
          <Image
            src="/openwork-mark.svg"
            alt=""
            aria-hidden="true"
            width={834}
            height={649}
            className="h-[26px] w-auto"
            priority
            unoptimized
          />
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--dls-text-primary)]">OpenWork</div>
            <div className="text-[12px] text-[var(--dls-text-secondary)]">Den onboarding</div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-[calc(100vh-72px)] min-h-[calc(100dvh-72px)] w-full px-3 pb-3 pt-4 md:px-6 md:pb-6 md:pt-5">
        <CloudControlPanel />
      </div>
    </main>
  );
}
