import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"

const root = resolve(new URL("..", import.meta.url).pathname)
const cli = join(root, "bin", "openwork.mjs")
const temp = mkdtempSync(join(tmpdir(), "openwork-bootstrap-test-"))

try {
  const installDir = join(temp, "install")
  const binDir = join(temp, "bin")
  const install = spawnSync(process.execPath, [cli, "install", "--install-dir", installDir, "--bin-dir", binDir, "--json"], {
    encoding: "utf8",
  })
  assert.equal(install.status, 0, install.stderr)
  const installJson = JSON.parse(install.stdout)
  assert.equal(installJson.ok, true)
  const executableName = process.platform === "win32" ? "openwork-bootstrap.cmd" : "openwork-bootstrap"
  assert.equal(installJson.install.executable, join(binDir, executableName))

  const doctor = spawnSync(join(binDir, executableName), ["doctor", "--install-dir", installDir, "--bin-dir", binDir, "--json"], {
    encoding: "utf8",
  })
  assert.equal(doctor.status, 0, doctor.stderr)
  const doctorJson = JSON.parse(doctor.stdout)
  assert.equal(doctorJson.ok, true)
  assert.equal(doctorJson.checks.every((check) => check.ok), true)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
