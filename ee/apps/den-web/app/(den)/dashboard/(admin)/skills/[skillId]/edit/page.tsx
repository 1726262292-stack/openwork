import { SkillEditorScreen } from "../../../../_components/skills-screen";

export default async function EditSkillPage({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params;
  return <SkillEditorScreen skillId={skillId} />;
}
