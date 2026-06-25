#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const VERSION = "0.1.0"
const here = dirname(fileURLToPath(import.meta.url))
const selfPath = fileURLToPath(import.meta.url)

function parseArgs(argv) {
  const positionals = []
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const raw = arg.slice(2)
    const eq = raw.indexOf("=")
    if (eq >= 0) {
      flags.set(raw.slice(0, eq), raw.slice(eq + 1))
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(raw, next)
      index += 1
    } else {
      flags.set(raw, true)
    }
  }
  return { positionals, flags }
}

function getFlag(flags, name, fallback = undefined) {
  const value = flags.get(name)
  return value === undefined || value === true ? fallback : String(value)
}

function hasFlag(flags, name) {
  return flags.get(name) === true || flags.get(name) === "true"
}

function jsonOut(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2))
  } else if (value.message) {
    console.log(value.message)
  } else {
    console.log(JSON.stringify(value, null, 2))
  }
}

function printHelp() {
  console.log([
    "openwork bootstrap",
    "",
    "Usage:",
    "  openwork install [--bin-dir <path>] [--install-dir <path>] [--source <path>] [--json]",
    "  openwork doctor [--bin-dir <path>] [--install-dir <path>] [--base-url <url>] [--json]",
    "  openwork cloud onboard --base-url <url> --owner-email <email> --owner-password <password> --org-name <name> --invite-email <email> [--skill-name <name>] [--json]",
    "",
    "Commands:",
    "  install          Install the lightweight openwork CLI into a user bin dir",
    "  doctor           Check CLI installation and optional Den API health",
    "  cloud onboard    Sign up, create an org, invite a teammate, and create a skill",
    "",
    "Options:",
    "  --json           Print machine-readable JSON",
    "  --version        Print version",
    "  --help           Show help",
  ].join("\n"))
}

function defaultInstallDir() {
  return process.env.OPENWORK_INSTALL_DIR || join(process.env.HOME || process.cwd(), ".openwork", "bootstrap")
}

function defaultBinDir() {
  return process.env.OPENWORK_BIN_DIR || join(process.env.HOME || process.cwd(), ".local", "bin")
}

function runInstall(args) {
  const installDir = resolve(getFlag(args.flags, "install-dir", defaultInstallDir()))
  const binDir = resolve(getFlag(args.flags, "bin-dir", defaultBinDir()))
  const source = resolve(getFlag(args.flags, "source", selfPath))
  const json = hasFlag(args.flags, "json")

  if (!existsSync(source)) {
    throw new Error(`source_not_found: ${source}`)
  }

  mkdirSync(installDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  const installedCli = join(installDir, "openwork.mjs")
  copyFileSync(source, installedCli)
  chmodSync(installedCli, 0o755)

  const executable = join(binDir, process.platform === "win32" ? "openwork.cmd" : "openwork")
  if (process.platform === "win32") {
    writeFileSync(executable, `@echo off\r\nnode "${installedCli}" %*\r\n`)
  } else {
    writeFileSync(executable, `#!/usr/bin/env sh\nexec node "${installedCli}" "$@"\n`)
  }
  chmodSync(executable, 0o755)

  const manifest = {
    version: VERSION,
    installedAt: new Date().toISOString(),
    installDir,
    binDir,
    executable,
    cli: installedCli,
  }
  writeFileSync(join(installDir, "install.json"), JSON.stringify(manifest, null, 2))

  jsonOut({ ok: true, message: `OpenWork CLI installed at ${executable}`, install: manifest }, json)
}

async function runDoctor(args) {
  const installDir = resolve(getFlag(args.flags, "install-dir", defaultInstallDir()))
  const binDir = resolve(getFlag(args.flags, "bin-dir", defaultBinDir()))
  const baseUrl = getFlag(args.flags, "base-url")
  const json = hasFlag(args.flags, "json")
  const checks = []

  checks.push({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 20, value: process.versions.node })
  checks.push({ name: "installDir", ok: existsSync(installDir), value: installDir })
  checks.push({ name: "binDir", ok: existsSync(binDir), value: binDir })

  const executable = join(binDir, process.platform === "win32" ? "openwork.cmd" : "openwork")
  const executableOk = existsSync(executable) && statSync(executable).isFile()
  checks.push({ name: "openworkExecutable", ok: executableOk, value: executable })

  const manifestPath = join(installDir, "install.json")
  let manifest = null
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    checks.push({ name: "manifest", ok: true, value: manifestPath })
  } else {
    checks.push({ name: "manifest", ok: false, value: manifestPath })
  }

  if (baseUrl) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`)
      const body = await response.json().catch(() => null)
      checks.push({ name: "denApiHealth", ok: response.ok && body?.ok === true, value: { status: response.status, body } })
    } catch (error) {
      checks.push({ name: "denApiHealth", ok: false, value: error instanceof Error ? error.message : String(error) })
    }
  }

  const ok = checks.every((check) => check.ok)
  jsonOut({ ok, message: ok ? "OpenWork doctor: ok" : "OpenWork doctor: failed", version: VERSION, manifest, checks }, json)
  if (!ok) process.exitCode = 1
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

async function signupAndSignin(baseUrl, input) {
  const signup = await request(baseUrl, "/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: input.name, email: input.email, password: input.password }),
  })
  if (signup.status !== 200 && signup.status !== 400) {
    throw new Error(`signup_failed: ${signup.status} ${JSON.stringify(signup.body)}`)
  }

  const signin = await request(baseUrl, "/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: input.email, password: input.password }),
  })
  if (signin.status !== 200 || !signin.body?.token) {
    throw new Error(`signin_failed: ${signin.status} ${JSON.stringify(signin.body)}`)
  }
  return { signup, signin, token: signin.body.token, user: signin.body.user }
}

function skillText(name) {
  return `---\nname: ${name}\ndescription: Starter skill created by openwork bootstrap.\n---\n\n# ${name}\n\nUse this skill to confirm OpenWork cloud onboarding can create skills directly.`
}

async function runCloudOnboard(args) {
  const subcommand = args.positionals[1]
  if (subcommand !== "onboard") {
    printHelp()
    process.exitCode = 1
    return
  }

  const json = hasFlag(args.flags, "json")
  const baseUrl = getFlag(args.flags, "base-url")?.replace(/\/$/, "")
  const ownerEmail = getFlag(args.flags, "owner-email")
  const ownerPassword = getFlag(args.flags, "owner-password")
  const orgName = getFlag(args.flags, "org-name")
  const inviteEmail = getFlag(args.flags, "invite-email")
  const skillName = getFlag(args.flags, "skill-name", "First OpenWork Skill")

  for (const [name, value] of Object.entries({ baseUrl, ownerEmail, ownerPassword, orgName, inviteEmail })) {
    if (!value) throw new Error(`missing_required_flag: --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
  }

  const health = await request(baseUrl, "/health", { method: "GET" })
  if (health.status !== 200 || health.body?.ok !== true) {
    throw new Error(`den_api_unhealthy: ${health.status} ${JSON.stringify(health.body)}`)
  }

  const owner = await signupAndSignin(baseUrl, {
    name: "OpenWork Owner",
    email: ownerEmail,
    password: ownerPassword,
  })
  const auth = { authorization: `Bearer ${owner.token}` }

  const org = await request(baseUrl, "/v1/org", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: orgName }),
  })
  if (org.status !== 201 || !org.body?.organization?.id) {
    throw new Error(`org_create_failed: ${org.status} ${JSON.stringify(org.body)}`)
  }

  const invite = await request(baseUrl, "/v1/invitations", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ email: inviteEmail, role: "member" }),
  })
  if (invite.status !== 201 || !invite.body?.invitationId) {
    throw new Error(`invite_failed: ${invite.status} ${JSON.stringify(invite.body)}`)
  }

  const skill = await request(baseUrl, "/v1/skills", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ skillText: skillText(skillName), shared: "org" }),
  })
  if (skill.status !== 201 || !skill.body?.skill?.id) {
    throw new Error(`skill_create_failed: ${skill.status} ${JSON.stringify(skill.body)}`)
  }

  jsonOut({
    ok: true,
    message: "OpenWork cloud onboarding complete",
    user: { id: owner.user.id, email: owner.user.email, emailVerified: owner.user.emailVerified },
    organization: org.body.organization,
    invitation: invite.body,
    skill: skill.body.skill,
  }, json)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (hasFlag(args.flags, "help") || args.positionals[0] === "help") {
    printHelp()
    return
  }
  if (hasFlag(args.flags, "version")) {
    console.log(VERSION)
    return
  }

  const command = args.positionals[0] || "help"
  if (command === "install") {
    runInstall(args)
    return
  }
  if (command === "doctor") {
    await runDoctor(args)
    return
  }
  if (command === "cloud") {
    await runCloudOnboard(args)
    return
  }

  printHelp()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
