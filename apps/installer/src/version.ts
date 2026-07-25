// Release builds are stamped by the release workflow (--define); running from
// source or compiling locally falls back to the committed package version.
import packageJson from "../package.json"

export const INSTALLER_VERSION = process.env.OPENWORK_INSTALLER_VERSION?.trim() || packageJson.version
