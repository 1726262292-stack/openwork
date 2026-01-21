import { For, Show, createMemo } from "solid-js";

import type { SkillCard } from "../types";

import Button from "../components/button";
import { FolderOpen, Package, Upload } from "lucide-solid";
import { currentLocale, t } from "../../i18n";

export type SkillsViewProps = {
  busy: boolean;
  mode: "host" | "client" | null;
  refreshSkills: (options?: { force?: boolean }) => void;
  skills: SkillCard[];
  skillsStatus: string | null;
  importLocalSkill: () => void;
  installSkillCreator: () => void;
  revealSkillsFolder: () => void;
};

export default function SkillsView(props: SkillsViewProps) {
  // Translation helper that uses current language from i18n
  const translate = (key: string) => t(key, currentLocale());

  const skillCreatorInstalled = createMemo(() =>
    props.skills.some((skill) => skill.name === "skill-creator")
  );

  return (
    <section class="space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-gray-11 uppercase tracking-wider">{translate("skills.title")}</h3>
        <Button variant="secondary" onClick={() => props.refreshSkills({ force: true })} disabled={props.busy}>
          {translate("skills.refresh")}
        </Button>
      </div>

      <div class="bg-gray-2/30 border border-gray-6/50 rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm font-medium text-gray-12">{translate("skills.add_title")}</div>
          <Show when={props.mode !== "host"}>
            <div class="text-xs text-gray-10">{translate("skills.host_mode_only")}</div>
          </Show>
        </div>

        <div class="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800/60">
          <div class="text-sm font-medium text-gray-12">{translate("skills.install_skill_creator")}</div>
          <Button
            variant={skillCreatorInstalled() ? "outline" : "secondary"}
            onClick={() => {
              if (skillCreatorInstalled()) return;
              props.installSkillCreator();
            }}
            disabled={props.busy || skillCreatorInstalled()}
          >
            <Package size={16} />
            {skillCreatorInstalled() ? translate("skills.installed_label") : translate("skills.install")}
          </Button>
        </div>

        <div class="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800/60">
          <div class="text-sm font-medium text-gray-12">{translate("skills.import_local")}</div>
          <Button
            variant="secondary"
            onClick={props.importLocalSkill}
            disabled={props.busy}
          >
            <Upload size={16} />
            {translate("skills.import")}
          </Button>
        </div>

        <div class="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800/60">
          <div class="text-sm font-medium text-gray-12">{translate("skills.reveal_folder")}</div>
          <Button variant="secondary" onClick={props.revealSkillsFolder} disabled={props.busy}>
            <FolderOpen size={16} />
            {translate("skills.reveal_button")}
          </Button>
        </div>

        <Show when={props.skillsStatus}>
          <div class="rounded-xl bg-gray-1/20 border border-gray-6 p-3 text-xs text-gray-11 whitespace-pre-wrap break-words">
            {props.skillsStatus}
          </div>
        </Show>
      </div>

      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-medium text-gray-12">{translate("skills.installed")}</div>
          <div class="text-xs text-gray-10">{props.skills.length}</div>
        </div>

        <Show
          when={props.skills.length}
          fallback={
            <div class="bg-gray-2/30 border border-gray-6/50 rounded-2xl p-6 text-sm text-zinc-500">
              {translate("skills.no_skills")}
            </div>
          }
        >
          <div class="grid gap-3">
            <For each={props.skills}>
              {(s) => (
                <div class="bg-gray-2/30 border border-gray-6/50 rounded-2xl p-5">
                  <div class="flex items-center gap-2">
                    <Package size={16} class="text-gray-11" />
                    <div class="font-medium text-gray-12">{s.name}</div>
                  </div>
                  <Show when={s.description}>
                    <div class="mt-1 text-sm text-gray-10">{s.description}</div>
                  </Show>
                  <div class="mt-2 text-xs text-gray-7 font-mono">{s.path}</div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
