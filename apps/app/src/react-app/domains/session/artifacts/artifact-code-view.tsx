/** @jsxImportSource react */
import { File } from "@pierre/diffs/react";

const OPENWORK_CODE_CSS = `
  :host {
    --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --diffs-font-size: 12px;
    --diffs-line-height: 20px;
    display: block;
    min-height: 100%;
    background: var(--background);
  }
  [data-file] { min-height: 100%; }
`;

type ArtifactCodeViewProps = {
  name: string;
  path: string;
  content: string;
};

export function ArtifactCodeView({ name, path, content }: ArtifactCodeViewProps) {
  return (
    <div className="h-full overflow-auto bg-background" data-artifact-code-view={path}>
      <File
        file={{ name, contents: content, cacheKey: path }}
        options={{
          theme: { light: "github-light", dark: "github-dark" },
          disableFileHeader: true,
          overflow: "scroll",
          unsafeCSS: OPENWORK_CODE_CSS,
        }}
      />
    </div>
  );
}
