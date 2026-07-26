"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenTextarea } from "../../_components/ui/textarea";
import { getEditSkillRoute, getNewSkillRoute, getSkillRoute, getSkillsRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  createSkill,
  deleteSkill,
  skillQueryKeys,
  updateSkill,
  useSkill,
  useSkills,
} from "./skill-data";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function SkillsScreen() {
  const { orgSlug } = useOrgDashboard();
  const { data: skills = [], isLoading, error } = useSkills();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? skills.filter((skill) => `${skill.name}\n${skill.description}\n${skill.body}`.toLowerCase().includes(normalized))
      : skills;
  }, [query, skills]);

  return (
    <DashboardPageTemplate
      icon={FileText}
      title="Skills"
      description="Create and manage the complete instructions agents can load for your organization."
      colors={["#ECFDF5", "#065F46", "#10B981", "#A7F3D0"]}
    >
      <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DenInput icon={Search} type="search" placeholder="Search skills..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <Link href={getNewSkillRoute(orgSlug)} className={buttonVariants({ variant: "primary" })}>
          <Plus className="h-4 w-4" /> Create skill
        </Link>
      </div>
      {error ? <ErrorBanner message={error instanceof Error ? error.message : "Failed to load skills."} /> : null}
      {isLoading ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 text-sm text-gray-500">Loading skills…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="font-medium text-gray-900">{skills.length === 0 ? "No skills yet." : "No skills match that search."}</p>
          <p className="mt-2 text-sm text-gray-500">{skills.length === 0 ? "Create a reusable instruction set for your agents." : "Try a different search term."}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((skill) => (
            <Link key={skill.id} href={getSkillRoute(orgSlug, skill.id)} className="rounded-2xl border border-gray-100 bg-white px-5 py-4 transition hover:border-gray-200 hover:shadow-sm">
              <h2 className="text-[14px] font-semibold text-gray-900">{skill.name}</h2>
              <p className="mt-1 text-[13px] leading-6 text-gray-500">{skill.description}</p>
              <p className="mt-3 text-[11px] text-gray-400">{skill.sourceMode === "connector" ? "Managed by connected source" : "Organization skill"}</p>
            </Link>
          ))}
        </div>
      )}
    </DashboardPageTemplate>
  );
}

export function SkillEditorScreen({ skillId }: { skillId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orgSlug, runReauthableAction } = useOrgDashboard();
  const skillQuery = useSkill(skillId ?? "");
  const skill = skillId ? skillQuery.data : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!skill) return;
    setName(skill.name);
    setDescription(skill.description);
    setBody(skill.body);
  }, [skill]);

  async function save() {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!SKILL_NAME_PATTERN.test(trimmedName) || trimmedName.length > 64) {
      setSaveError("Name must use 1–64 lowercase letters, numbers, and single hyphens.");
      return;
    }
    if (!trimmedDescription || trimmedDescription.length > 1024) {
      setSaveError("Description is required and must be 1,024 characters or fewer.");
      return;
    }
    if (!body.trim()) {
      setSaveError("Write the skill instructions before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let savedId = skillId;
      await runReauthableAction(skillId ? "update-skill" : "create-skill", async () => {
        const saved = skillId
          ? await updateSkill(skillId, { name: trimmedName, description: trimmedDescription, body })
          : await createSkill({ name: trimmedName, description: trimmedDescription, body });
        savedId = saved.id;
      });
      await queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
      if (!savedId) throw new Error("The skill was saved, but no id was returned.");
      router.push(getSkillRoute(orgSlug, savedId));
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save the skill.");
    } finally {
      setSaving(false);
    }
  }

  if (skillId && skillQuery.isLoading && !skill) return <CenteredMessage>Loading skill…</CenteredMessage>;
  if (skillId && !skill) return <CenteredMessage error>{skillQuery.error instanceof Error ? skillQuery.error.message : "That skill could not be found."}</CenteredMessage>;
  if (skill?.sourceMode === "connector") {
    return <CenteredMessage>This skill is managed by a connected source. Edit it at the source.</CenteredMessage>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href={skillId ? getSkillRoute(orgSlug, skillId) : getSkillsRoute(orgSlug)} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{skillId ? `Edit ${skill?.name ?? "skill"}` : "Create a skill"}</h1>
        <p className="mt-2 text-sm text-gray-500">Metadata lives in SKILL.md frontmatter; the complete body is stored without truncation.</p>
        <div className="mt-7 space-y-5">
          <label className="block text-[13px] font-medium text-gray-700">Name
            <DenInput className="mt-2" placeholder="e.g. customer-research" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block text-[13px] font-medium text-gray-700">Description
            <DenInput className="mt-2" placeholder="When should an agent use this skill?" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="block text-[13px] font-medium text-gray-700">Skill body
            <DenTextarea className="mt-2 min-h-[360px] resize-y font-mono text-[13px] leading-6" rows={16} placeholder={"# Instructions\n\n- First step\n- Second step\n\n```sh\necho ready\n```"} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
        </div>
        {saveError ? <div className="mt-5"><ErrorBanner message={saveError} /></div> : null}
        <div className="mt-6 flex justify-end"><DenButton loading={saving} onClick={() => void save()}>{skillId ? "Save changes" : "Create skill"}</DenButton></div>
      </div>
    </div>
  );
}

export function SkillDetailScreen({ skillId }: { skillId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { orgSlug, runReauthableAction } = useOrgDashboard();
  const { data: skill, isLoading, error } = useSkill(skillId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove() {
    if (!skill) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await runReauthableAction("delete-skill", () => deleteSkill(skill.id));
      await queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
      router.push(getSkillsRoute(orgSlug));
      router.refresh();
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "Failed to delete the skill safely.");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (isLoading && !skill) return <CenteredMessage>Loading skill…</CenteredMessage>;
  if (!skill) return <CenteredMessage error>{error instanceof Error ? error.message : "That skill could not be found."}</CenteredMessage>;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={getSkillsRoute(orgSlug)} className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800"><ArrowLeft className="h-4 w-4" /> Back to skills</Link>
        {skill.sourceMode !== "connector" ? (
          <div className="flex gap-2">
            <Link href={getEditSkillRoute(orgSlug, skill.id)} className={buttonVariants({ variant: "secondary", size: "sm" })}><Pencil className="h-3.5 w-3.5" /> Edit</Link>
            <DenButton variant="destructive" size="sm" icon={Trash2} onClick={() => setConfirmingDelete(true)}>Delete</DenButton>
          </div>
        ) : null}
      </div>
      {deleteError ? <div className="mt-5"><ErrorBanner message={deleteError} /></div> : null}
      {skill.sourceMode === "connector" ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">This skill is managed by a connected source. Edit or delete it at the source.</div> : null}
      <article className="mt-6 overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <header className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{skill.name}</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">{skill.description}</p>
        </header>
        <section className="px-6 py-6">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Complete skill body</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-gray-950 p-5 font-mono text-[13px] leading-6 text-gray-100">{skill.body}</pre>
        </section>
      </article>
      {confirmingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-skill-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="delete-skill-title" className="text-lg font-semibold text-gray-950">Delete “{skill.name}”?</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">Only this exact skill will be deleted. This cannot delete referenced or source-managed skills.</p>
            <div className="mt-6 flex justify-end gap-2">
              <DenButton variant="secondary" onClick={() => setConfirmingDelete(false)}>Cancel</DenButton>
              <DenButton variant="destructive" loading={deleting} onClick={() => void remove()}>Delete “{skill.name}”</DenButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{message}</div>;
}

function CenteredMessage({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div className={`mx-auto mt-10 max-w-3xl rounded-2xl border px-5 py-8 text-sm ${error ? "border-red-100 bg-red-50 text-red-700" : "border-gray-100 bg-white text-gray-500"}`}>{children}</div>;
}
