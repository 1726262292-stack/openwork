/**
 * Automations ships with complete English copy in every locale while the
 * first translation pass is in progress. Keeping one shared map prevents a
 * partially translated locale from hiding the preview boundary.
 */
export const automationsEnglish = {
  "automations.preferences_title": "Automations",
  "automations.preferences_section_desc": "Preview repeatable work that runs remotely in Den on a schedule.",
  "automations.preferences_toggle": "Automations (preview)",
  "automations.preferences_toggle_desc": "Show Automations in the app. They run in Den with your OpenWork Connect integrations, even while this computer is offline.",
} as const;
