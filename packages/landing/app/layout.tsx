import "./globals.css";
import { JetBrains_Mono, Sora } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap"
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata = {
  title: "OpenWork — Local-first, open-source Cowork alternative",
  description:
    "OpenWork is the open-source Cowork alternative powered by OpenCode—run local-first workflows with any model, and extend with skills."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${jetbrains.variable}`}>
      <body className="antialiased text-ink">
        {children}
      </body>
    </html>
  );
}
