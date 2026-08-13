import { ArtifactDetailScreen } from "../../../_components/artifact-detail-screen";

export default async function ArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return <ArtifactDetailScreen artifactId={artifactId} />;
}
