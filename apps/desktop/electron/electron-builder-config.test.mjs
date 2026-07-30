import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const dirname = path.dirname(fileURLToPath(import.meta.url));

async function readConfig(name) {
  return YAML.parse(await readFile(path.resolve(dirname, "..", name), "utf8"));
}

describe("Electron distribution configs", () => {
  it("uses a stable Linux desktop identity and ships integration icons", async () => {
    const packageMetadata = JSON.parse(
      await readFile(path.resolve(dirname, "..", "package.json"), "utf8"),
    );
    const config = await readConfig("electron-builder.base.yml");
    assert.equal(packageMetadata.desktopName, "com.differentai.openwork");
    assert.equal(config.linux.syncDesktopName, true);
    assert.equal(config.linux.icon, "resources/icons/linux");
    assert.deepEqual(config.linux.extraResources[0], {
      from: "resources/icons/linux",
      to: "icons/linux",
      filter: ["*.png"],
    });
  });

  it("declares every runtime package used by the embedded server", async () => {
    const packageMetadata = JSON.parse(
      await readFile(path.resolve(dirname, "..", "package.json"), "utf8"),
    );
    const serverPackageMetadata = JSON.parse(
      await readFile(path.resolve(dirname, "..", "..", "server", "package.json"), "utf8"),
    );
    for (const [packageName, version] of Object.entries(serverPackageMetadata.dependencies)) {
      assert.equal(packageMetadata.dependencies[packageName], version, packageName);
    }
  });

  it("keeps embedded-server workspace packages on built JavaScript in Node", async () => {
    for (const packageName of ["app-contract", "app-tools"]) {
      const packageMetadata = JSON.parse(
        await readFile(path.resolve(dirname, "..", "..", "..", "packages", packageName, "package.json"), "utf8"),
      );
      assert.equal(packageMetadata.exports["."].node, "./dist/index.js");
      assert.equal(packageMetadata.exports["."].default, "./dist/index.js");
    }
  });

  it("builds embedded-server workspace packages before the server", async () => {
    const buildScript = await readFile(
      path.resolve(dirname, "..", "scripts", "electron-build.mjs"),
      "utf8",
    );
    const contractBuild = buildScript.indexOf('"@openwork/app-contract", "@openwork/app-tools"');
    const workspaceBuild = buildScript.indexOf('["--filter", packageName, "build"]');
    const serverBuild = buildScript.indexOf('["--filter", "openwork-server", "build"]');
    assert.notEqual(contractBuild, -1);
    assert.notEqual(workspaceBuild, -1);
    assert.notEqual(serverBuild, -1);
    assert.ok(contractBuild < workspaceBuild);
    assert.ok(workspaceBuild < serverBuild);
  });

  it("gates pre-alpha publication on an import from the packaged server", async () => {
    const packageMetadata = JSON.parse(
      await readFile(path.resolve(dirname, "..", "package.json"), "utf8"),
    );
    assert.equal(
      packageMetadata.scripts["verify:packaged-server"],
      "node ./scripts/verify-packaged-server.mjs",
    );
    const verifier = await readFile(
      path.resolve(dirname, "..", "scripts", "verify-packaged-server.mjs"),
      "utf8",
    );
    assert.match(verifier, /mkdtempSync/);
    assert.match(verifier, /cpSync\(appBundle, isolatedAppBundle/);

    const workflow = await readFile(
      path.resolve(dirname, "..", "..", "..", ".github", "workflows", "pre-alpha-macos-aarch64.yml"),
      "utf8",
    );
    const verifyStep = workflow.indexOf("Verify packaged server runtime");
    const releaseStep = workflow.indexOf("Create immutable channel prerelease");
    assert.notEqual(verifyStep, -1);
    assert.notEqual(releaseStep, -1);
    assert.ok(verifyStep < releaseStep);
  });

  it("keeps the public artifact and protocol unchanged", async () => {
    const config = await readConfig("electron-builder.yml");
    assert.equal(config.extends, "./electron-builder.base.yml");
    assert.equal(config.appId, "com.differentai.openwork");
    assert.equal(config.productName, "OpenWork");
    assert.equal(config.protocols[0].schemes[0], "openwork");
    assert.equal(config.artifactName, "openwork-${os}-${arch}-${version}.${ext}");
  });

  it("defines an enterprise flavor with the standard app identity and release provider", async () => {
    const config = await readConfig("electron-builder.enterprise.yml");
    assert.equal(config.extends, "./electron-builder.base.yml");
    assert.equal(config.appId, "com.differentai.openwork");
    assert.equal(config.productName, "OpenWork Enterprise");
    assert.equal(config.extraMetadata.openworkDistribution, "enterprise");
    assert.equal(config.protocols[0].schemes[0], "openwork");
    assert.equal(config.publish[0].provider, "github");
    assert.equal(config.publish[0].owner, "different-ai");
    assert.equal(config.publish[0].repo, "openwork");
    assert.equal(config.publish[0].channel, "enterprise");
    assert.equal(
      config.artifactName,
      "openwork-enterprise-${os}-${arch}-${version}.${ext}",
    );
  });

  it("defines a Cloud flavor with its own artifacts and updater channel", async () => {
    const config = await readConfig("electron-builder.cloud.yml");
    assert.equal(config.extends, "./electron-builder.base.yml");
    assert.equal(config.appId, "com.differentai.openwork");
    assert.equal(config.productName, "OpenWork Cloud");
    assert.equal(config.extraMetadata.openworkDistribution, "cloud");
    assert.equal(config.protocols[0].schemes[0], "openwork");
    assert.equal(config.publish[0].channel, "cloud");
    assert.equal(
      config.artifactName,
      "openwork-cloud-${os}-${arch}-${version}.${ext}",
    );
  });
});
