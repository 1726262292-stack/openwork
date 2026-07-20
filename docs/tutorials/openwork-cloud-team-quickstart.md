# OpenWork Cloud team quickstart

Set up a team on [app.openworklabs.com](https://app.openworklabs.com), publish your first skill, and trigger it from the desktop app — in about 15 minutes.

By the end of this walkthrough you will have:

1. Created an organization on OpenWork Cloud.
2. Invited a few teammates and organized them into teams.
3. Created a plugin with a simple test skill (Extensions → Plugins) and assigned it to a marketplace.
4. Given the relevant teams access to that marketplace.
5. Signed in to the org from the OpenWork desktop app and triggered the skill with a plain-language prompt.

> **Seats:** every workspace includes **5 free seats**. If you need more seats, SSO, or early access to analytics, [reach out](mailto:founders@openworklabs.com).

---

## 1. Create your organization

Head to [app.openworklabs.com](https://app.openworklabs.com). Enter your work email and press **Next** — OpenWork routes you to the right sign-in step automatically.

![Start using OpenWork — email step](images/cloud-team-quickstart/01-signin-email.png)

New emails get the **Create your account.** step. Pick a name and password, then **Sign up**.

![Create your account](images/cloud-team-quickstart/02-create-account.png)

Right after sign-up, OpenWork asks you to **name your team**. This creates your organization — you can rename it later, and no credit card is required.

![Name your team](images/cloud-team-quickstart/03-name-your-team.png)

You land in the admin dashboard with a short setup checklist. You can follow it now or come back later — this tutorial covers the important parts.

![Setup checklist](images/cloud-team-quickstart/04-onboarding-checklist.png)

## 2. Invite teammates and create teams

Open **Members** in the sidebar. Click **Add member**, enter your teammate's email, pick a role (Member or Admin), and hit **Send invite**.

![Invite a teammate](images/cloud-team-quickstart/05-invite-member-form.png)

Repeat for a few teammates. Invited people show up as **Pending** until they accept. From the row menu (⋯) you can **Copy invite link**, **Resend invite**, or **Cancel invite**.

![Members list with pending invites](images/cloud-team-quickstart/06-members-pending.png)

Your teammate opens the invite link, sets a password, and joins with one click:

![Join screen — what your teammate sees](images/cloud-team-quickstart/07-join-org-amy.png)

![Welcome after joining](images/cloud-team-quickstart/08-amy-welcome.png)

Now organize people into teams. Switch to the **Teams** tab, click **Create Team**, name it (for example `Sales`), and tap the members who belong in it.

![Create the Sales team](images/cloud-team-quickstart/09-create-team-sales.png)

Teams show up with their members at a glance:

![Teams list](images/cloud-team-quickstart/10-teams-list.png)

## 3. Create a plugin with a test skill

Skills are step-by-step instructions the agent loads when a task matches — think of them as runbooks your whole team can share. Skills ship inside **plugins**, and plugins are distributed through **marketplaces**.

Open **Extensions → Plugins**. You'll see OpenWork's built-in plugins; click **Create plugin** to add your own.

![Extensions → Plugins](images/cloud-team-quickstart/11-plugins-overview.png)

First, give your plugin a home: under **Extensions → Marketplaces**, click **New marketplace** and create one for your team — for example `Sales Enablement`.

![New marketplace](images/cloud-team-quickstart/12-new-marketplace-dialog.png)

Back in **Plugins → Create plugin**, fill in the name and description, then click **+ Skill**:

![Create a plugin](images/cloud-team-quickstart/13-create-plugin-top.png)

Write the skill like a great runbook:

- **Name** — e.g. `Prep a sales call`
- **Description** — when should the agent use this? e.g. *"Use when someone asks to prepare for a sales call or customer meeting."*
- **Instructions** — plain markdown with the steps you want the agent to follow.

In the **Share** section, keep *Share with everyone in the organization* checked and pick your **Marketplace** — this is what publishes the plugin so members find it in the OpenWork app. Click **Create plugin**.

![Skill and marketplace assignment](images/cloud-team-quickstart/14-create-plugin-skill-share.png)

The plugin page confirms what's inside and which marketplace it's published to:

![Plugin detail](images/cloud-team-quickstart/15-plugin-detail.png)

## 4. Give teams access to the marketplace

Open **Extensions → Marketplaces → Sales Enablement** and switch to the **Members** tab. This is where you control who sees the marketplace: everyone in the org, specific **teams**, or individual people.

Changing workspace access is sensitive, so OpenWork asks you to confirm your password first:

![Security check](images/cloud-team-quickstart/16-security-check.png)

Add the relevant teams under **Teams** — here the `Sales` team gets access. Admins always keep access.

![Marketplace access by team](images/cloud-team-quickstart/17-marketplace-team-access.png)

That's the whole admin loop: **plugin → marketplace → teams**. Anyone you add later inherits the right extensions automatically.

## 5. Trigger the skill from the desktop app

Now switch to the [OpenWork desktop app](https://openworklabs.com). On the welcome screen, click **Joining a team? Sign in** and sign in with the same account.

![Desktop welcome](images/cloud-team-quickstart/18-desktop-welcome.png)

Pick your organization:

![Choose your organization](images/cloud-team-quickstart/19-desktop-choose-org.png)

OpenWork shows what your org gives you access to — including your marketplaces:

![Org resources](images/cloud-team-quickstart/20-desktop-org-resources.png)

You can confirm the connection any time under **Settings → Account**:

![Signed in to Acme Labs](images/cloud-team-quickstart/21-desktop-account-connected.png)

Your team's marketplace syncs automatically. Under **Settings → Marketplace**, the `Sales Call Prep` plugin from your org shows up as **Active · runs in cloud** — no manual install needed:

![Marketplace synced to desktop](images/cloud-team-quickstart/22-desktop-marketplace-plugin.png)

Now just ask for the thing the skill knows how to do. Type a prompt that matches the skill's description and hit **Run task**:

> *Prep me for tomorrow's sales call with Northwind Traders. 30 minutes with their operations lead, goal is a paid pilot.*

![Prompt that triggers the skill](images/cloud-team-quickstart/23-desktop-prompt.png)

The agent picks up the skill and follows your runbook — research, a timed agenda, discovery questions, objection handling, and a clear next step, saved as a doc in your workspace:

![The skill in action](images/cloud-team-quickstart/24-desktop-skill-result.png)

## What's next

- Add more skills to the plugin as your team's playbooks grow — everyone gets updates automatically.
- Import existing plugins from GitHub (**Extensions → Plugins → Import from GitHub**), including Anthropic-compatible plugin repos.
- Wire up **Sources** to keep marketplaces in sync with a repository.

> **Need more?** The first 5 users in your organization are free; additional users are $10 per user per month. For SSO or early analytics access, [contact us](mailto:founders@openworklabs.com).

---

*The screenshots in this tutorial were produced with the repo's agent-first screenshot pipeline and framed with `.opencode/skills/agent-first-screenshots/scripts/beautify.mjs` (gradient background, rounded corners, window chrome).*
