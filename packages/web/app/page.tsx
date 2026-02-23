import { CloudControlPanel } from "../components/cloud-control";
import { PaperMeshBackground } from "../components/paper-mesh-background";

export default function HomePage() {
  return (
    <main className="ow-shell">
      <div className="ow-ambient" aria-hidden>
        <PaperMeshBackground opacity={0.85} />
        <span className="ow-blob ow-blob-one" />
        <span className="ow-blob ow-blob-two" />
        <span className="ow-blob ow-blob-three" />
      </div>

      <header className="ow-brand">
        <span className="ow-brand-icon" aria-hidden>
          <span className="ow-brand-icon-core" />
        </span>
        <span className="ow-brand-text">OpenWork</span>
      </header>

      <CloudControlPanel />
    </main>
  );
}
