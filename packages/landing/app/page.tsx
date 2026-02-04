import Link from "next/link";

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type Release = {
  draft?: boolean;
  html_url?: string;
  assets?: ReleaseAsset[];
};

type Repo = {
  stargazers_count?: number;
};

const FALLBACK_RELEASE = "https://github.com/different-ai/openwork/releases";

const formatCompact = (value: number) => {
  try {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(value);
  } catch {
    return String(value);
  }
};

const selectAsset = (
  assets: ReleaseAsset[],
  extensions: string[],
  keywords: string[] = []
) => {
  const matches = assets.filter((asset) => {
    if (!asset?.name || !asset?.browser_download_url) return false;
    const name = asset.name.toLowerCase();
    const extensionMatch = extensions.some((ext) => name.endsWith(ext));
    const keywordMatch =
      keywords.length === 0 || keywords.some((key) => name.includes(key));
    return extensionMatch && keywordMatch;
  });

  if (matches.length === 0) return null;

  return (
    matches.find((asset) => asset.name?.toLowerCase().includes("adhoc")) ||
    matches.find((asset) => asset.name?.toLowerCase().includes("universal")) ||
    matches.find((asset) => asset.name?.toLowerCase().includes("aarch64")) ||
    matches[0]
  );
};

const fetchJson = async <T,>(url: string): Promise<T | null> => {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json"
      },
      next: { revalidate: 60 * 60 }
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const getGithubData = async () => {
  const [repo, releases] = await Promise.all([
    fetchJson<Repo>("https://api.github.com/repos/different-ai/openwork"),
    fetchJson<Release[]>(
      "https://api.github.com/repos/different-ai/openwork/releases?per_page=10"
    )
  ]);

  const stars =
    typeof repo?.stargazers_count === "number"
      ? formatCompact(repo.stargazers_count)
      : "—";

  const releaseList = Array.isArray(releases) ? releases : [];
  const pick = releaseList.find((release) => {
    if (!release || release.draft) return false;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    return assets.some((asset) => asset?.browser_download_url);
  });

  const assets = Array.isArray(pick?.assets) ? pick.assets : [];
  const dmg = selectAsset(assets, [".dmg"]);
  const exe = selectAsset(assets, [".exe", ".msi"], ["win", "windows"]);
  const appImage = selectAsset(assets, [".appimage"], ["linux"]);

  return {
    stars,
    releaseUrl: pick?.html_url || FALLBACK_RELEASE,
    downloads: {
      macos: dmg?.browser_download_url || FALLBACK_RELEASE,
      windows: exe?.browser_download_url || FALLBACK_RELEASE,
      linux: appImage?.browser_download_url || FALLBACK_RELEASE
    }
  };
};

export default async function Home() {
  const github = await getGithubData();
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="#" className="text-lg font-bold tracking-tight">
              OpenWork
            </Link>
            <div className="hidden items-center gap-6 text-[14px] text-gray-500 md:flex">
              <Link href="#install" className="transition hover:text-black">
                Getting started
              </Link>
              <Link href="#capabilities" className="transition hover:text-black">
                Features
              </Link>
              <Link href="#faq" className="transition hover:text-black">
                FAQ
              </Link>
              <Link href="#" className="transition hover:text-black">
                Blog
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[14px]">
            <a
              href="https://github.com/different-ai/openwork"
              className="flex items-center gap-1 text-gray-500 transition hover:text-black"
              rel="noreferrer"
              target="_blank"
              aria-label="OpenWork GitHub stars"
            >
              <svg
                className="h-4 w-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.041-1.416-4.041-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              {github.stars}
            </a>
          </div>
        </div>
      </nav>

      <main className="px-6 pb-24 pt-20">
        <div className="content-max-width">
          <div className="animate-fade-up">
            <h1 className="mb-2 text-4xl font-bold tracking-tight">
              Not just suggestions. Automate your work.
            </h1>
            <p className="mb-8 flex flex-wrap items-center gap-1.5 text-lg font-normal text-gray-500">
              OpenWork is your open-source
              <span className="word-cycle">
                <span>Cowork</span>
                <span>Codex</span>
              </span>
              alternative for teams.
              <span className="sr-only">
                OpenWork is your open-source Cowork alternative for teams.
              </span>
            </p>
          </div>

          <div className="mb-10 space-y-4 text-[15px] leading-relaxed text-gray-700">
            <p>
              OpenWork is a desktop app for working on automation threads in
              parallel, with built-in support for your local tools, files, and
              browser.
            </p>
            <p>
              Start for free with local models, connect your ChatGPT account, or
              use any of the 50 other{" "}
              <a
                href="https://opencode.ai/docs/providers/"
                target="_blank"
                rel="noreferrer"
                className="text-black underline underline-offset-4"
              >
                providers
              </a>
              .
            </p>
          </div>

          <div className="group relative mb-6 rounded-2xl border border-gray-100 bg-gradient-to-br from-blue-50 to-orange-50 p-10 shadow-sm">
            <div className="flex aspect-video flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-2xl transition-transform duration-500 group-hover:scale-[1.01]">
              <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-gray-200"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-gray-200"></div>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  OpenWork Console
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-4 p-6">
                <div className="rounded-md border border-gray-100 bg-gray-50 p-4 text-sm italic text-gray-600">
                  "Open Chrome and find me a green couch on Facebook Marketplace."
                </div>
                <div className="border-l-2 border-green-500 py-1 pl-4">
                  <div className="mb-2 text-[10px] font-bold uppercase text-green-600">
                    Active Task
                  </div>
                  <div className="mono space-y-1 text-xs text-gray-500">
                    <div>[1] Launching Chrome...</div>
                    <div>[2] Navigating to marketplace...</div>
                    <div>[3] Searching: "green couch"</div>
                    <div>[4] Found 12 matches. Filtering for color...</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-16 flex flex-wrap items-center gap-2 text-[13px] text-gray-500">
            <span className="font-semibold text-gray-900">Powered by</span>
            <a
              href="https://opencode.ai"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center"
              aria-label="opencode.ai"
            >
              <svg
                viewBox="0 0 234 42"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="h-3 w-auto"
              >
                <g clipPath="url(#clip0_1311_95049)">
                  <path d="M18 30H6V18H18V30Z" fill="#CFCECD" />
                  <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="#656363" />
                  <path d="M48 30H36V18H48V30Z" fill="#CFCECD" />
                  <path d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" fill="#656363" />
                  <path d="M84 24V30H66V24H84Z" fill="#CFCECD" />
                  <path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" fill="#656363" />
                  <path d="M108 36H96V18H108V36Z" fill="#CFCECD" />
                  <path d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" fill="#656363" />
                  <path d="M144 30H126V18H144V30Z" fill="#CFCECD" />
                  <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="#211E1E" />
                  <path d="M168 30H156V18H168V30Z" fill="#CFCECD" />
                  <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="#211E1E" />
                  <path d="M198 30H186V18H198V30Z" fill="#CFCECD" />
                  <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="#211E1E" />
                  <path d="M234 24V30H216V24H234Z" fill="#CFCECD" />
                  <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="#211E1E" />
                </g>
                <defs>
                  <clipPath id="clip0_1311_95049">
                    <rect width="234" height="42" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </a>
            <span>Everything from opencode just works.</span>
          </div>

          <section id="install">
            <h2 className="mb-6 text-2xl font-bold">Getting started</h2>
            <p className="mb-8 text-sm text-gray-500">
              The OpenWork app is available on macOS, Windows, and Linux.
            </p>

            <div className="space-y-12">
              <div className="flex gap-6">
                <div className="step-circle shrink-0">1</div>
                <div className="space-y-4">
                  <h3 className="text-[15px] font-bold">
                    Download and install the OpenWork app
                  </h3>
                  <p className="text-[14px] text-gray-600">
                    Stable release for macOS. Windows and Linux builds are
                    available in alpha.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={github.downloads.macos}
                      className="doc-button"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Download for macOS
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                    </a>
                    <div className="ml-2 flex gap-4">
                      <a
                        href={github.downloads.windows}
                        className="text-[13px] text-gray-400 transition hover:text-black"
                        rel="noreferrer"
                        target="_blank"
                      >
                        Windows <span className="alpha-tag ml-1">Alpha</span>
                      </a>
                      <a
                        href={github.downloads.linux}
                        className="text-[13px] text-gray-400 transition hover:text-black"
                        rel="noreferrer"
                        target="_blank"
                      >
                        Linux <span className="alpha-tag ml-1">Alpha</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="step-circle shrink-0">2</div>
                <div className="w-full space-y-4">
                  <h3 className="text-[15px] font-bold">Send your first message</h3>
                  <p className="text-[14px] text-gray-600">
                    Start instantly. No registration is required to begin using
                    basic models on your machine. Try these examples:
                  </p>

                  <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-600 shadow-sm">
                        <svg
                          viewBox="0 0 64 64"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          aria-hidden="true"
                        >
                          <rect x="10" y="26" width="44" height="18" rx="4" />
                          <rect x="14" y="18" width="12" height="10" rx="3" />
                          <rect x="38" y="18" width="12" height="10" rx="3" />
                          <path d="M16 44v6" />
                          <path d="M48 44v6" />
                        </svg>
                      </span>
                      <p className="text-[12px] font-medium italic leading-relaxed text-gray-600">
                        "Open Chrome and find me a green couch on Facebook
                        Marketplace."
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-600 shadow-sm">
                        <svg
                          viewBox="0 0 64 64"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          aria-hidden="true"
                        >
                          <path d="M10 44h44" />
                          <path d="M16 38l10-18 12 14 10-20" />
                          <circle cx="26" cy="20" r="3" />
                          <circle cx="38" cy="34" r="3" />
                        </svg>
                      </span>
                      <p className="text-[12px] font-medium italic leading-relaxed text-gray-600">
                        "Go on Notion and update this CRM entry for me."
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-gray-600 shadow-sm">
                        <svg
                          viewBox="0 0 64 64"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          aria-hidden="true"
                        >
                          <rect x="16" y="14" width="32" height="36" rx="4" />
                          <path d="M22 24h20" />
                          <path d="M22 32h20" />
                          <path d="M22 40h14" />
                        </svg>
                      </span>
                      <p className="text-[12px] font-medium italic leading-relaxed text-gray-600">
                        "Update the CRM with this information."
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <hr />

          <section id="capabilities" className="py-12">
            <h2 className="mb-10 text-2xl font-bold">Work with the OpenWork app</h2>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
              <div className="feature-card">
                <h4 className="mb-2 text-[14px] font-bold">
                  Multitask across projects
                </h4>
                <p className="text-[13px] leading-relaxed text-gray-500">
                  Run multiple independent threads in parallel and switch
                  context instantly between browser tasks and local file work.
                </p>
              </div>
              <div className="feature-card">
                <h4 className="mb-2 text-[14px] font-bold">Automations</h4>
                <p className="text-[13px] leading-relaxed text-gray-500">
                  Run any prompt on a schedule or trigger it automatically. Set
                  it once and let it handle itself.
                </p>
              </div>
              <div className="feature-card">
                <h4 className="mb-2 text-[14px] font-bold">Skills support</h4>
                <p className="text-[13px] leading-relaxed text-gray-500">
                  Turn any complex workflow into a reusable skill. Share them
                  with your team so they can run automations with one click.
                </p>
              </div>
            </div>
          </section>

          <hr />

          <section id="faq" className="py-12">
            <h2 className="mb-10 text-2xl font-bold">FAQ</h2>
            <div className="space-y-12">
              <div>
                <h4 className="mb-2 text-[15px] font-bold">
                  What&apos;s the difference between OpenWork and regular chat?
                </h4>
                <p className="text-[14px] leading-relaxed text-gray-600">
                  Regular chat gives you text answers. OpenWork can perform
                  actions like creating files, editing folders, and running
                  browser commands on your local machine, after you approve
                  them.
                </p>
              </div>
              <div>
                <h4 className="mb-2 text-[15px] font-bold">Is it free?</h4>
                <p className="text-[14px] leading-relaxed text-gray-600">
                  Yes. OpenWork is open source. You can download and use it for
                  free with local models. You only pay for API usage if you
                  choose to connect paid cloud models.
                </p>
              </div>
              <div>
                <h4 className="mb-2 text-[15px] font-bold">
                  Can I share automations with my team?
                </h4>
                <p className="text-[14px] leading-relaxed text-gray-600">
                  Yes. Package any workflow as a skill and share it. Your
                  coworkers can install and run it on their own machines
                  instantly.
                </p>
              </div>
              <div>
                <h4 className="mb-2 text-[15px] font-bold">Is it safe?</h4>
                <p className="text-[14px] leading-relaxed text-gray-600">
                  OpenWork runs locally. It cannot access files or run commands
                  without your permission. You see a clear plan before any
                  action is taken.
                </p>
              </div>
              <div>
                <h4 className="mb-2 text-[15px] font-bold">
                  Can I use it with Telegram or WhatsApp?
                </h4>
                <p className="text-[14px] leading-relaxed text-gray-600">
                  Yes. Once it is running somewhere, you can keep requests
                  flowing from Telegram or WhatsApp and let OpenWork carry them
                  out.
                </p>
              </div>
            </div>
          </section>

          <footer className="mt-12 flex flex-col items-center justify-between gap-6 border-t border-gray-100 pb-12 pt-24 text-[13px] text-gray-400 md:flex-row">
            <div className="flex gap-6">
              <Link href="#" className="transition hover:text-black">
                Safety guide
              </Link>
              <Link href="#" className="transition hover:text-black">
                Terms
              </Link>
              <Link href="#" className="transition hover:text-black">
                Privacy
              </Link>
            </div>
            <span>© 2026 OpenWork Project.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
