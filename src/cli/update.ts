import { accessSync, chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";

const DEFAULT_RELEASE_REPO = "eduardocruz/heartbeat";
const BINARY_NAME = "heartbeat";

type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  assets: GitHubReleaseAsset[];
};

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function normalizeVersion(version: string): string {
  return version.replace(/^v/i, "");
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

export function resolveReleasePlatform(platform = process.platform, arch = process.arch): string {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;

  if (!os) {
    throw new Error(`Unsupported operating system for updates: ${platform}`);
  }

  if (!cpu) {
    throw new Error(`Unsupported architecture for updates: ${arch}`);
  }

  return `${os}-${cpu}`;
}

export function getReleaseAssetName(platform: string): string {
  return `${BINARY_NAME}-${platform}`;
}

function getGitHubHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "heartbeat-cli",
  };
}

async function fetchLatestRelease(repo = DEFAULT_RELEASE_REPO): Promise<GitHubRelease | null> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: getGitHubHeaders(),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to resolve the latest release (${response.status})`);
  }

  return (await response.json()) as GitHubRelease;
}

function resolvePathCandidate(candidate: string): string | null {
  try {
    accessSync(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function findBinaryOnPath(binaryName: string): string | null {
  const pathValue = process.env.PATH ?? "";

  for (const segment of pathValue.split(delimiter)) {
    if (!segment) {
      continue;
    }

    const candidate = resolvePathCandidate(join(segment, binaryName));
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function resolveUpdateTargetPath(binaryName = BINARY_NAME): string {
  const execBaseName = basename(process.execPath).toLowerCase();
  if (execBaseName === binaryName || execBaseName.startsWith(`${binaryName}-`)) {
    return process.execPath;
  }

  const installedBinary = findBinaryOnPath(binaryName);
  if (installedBinary) {
    return installedBinary;
  }

  throw new Error(
    "Unable to locate the installed heartbeat binary. Run the updater from an installed release binary or ensure heartbeat is on PATH.",
  );
}

function findReleaseAsset(release: GitHubRelease, platform: string): GitHubReleaseAsset | null {
  const expectedName = getReleaseAssetName(platform);
  return release.assets.find((asset) => asset.name === expectedName) ?? null;
}

async function downloadAsset(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { "User-Agent": "heartbeat-cli" },
  });

  if (!response.ok) {
    throw new Error(`Failed to download update asset (${response.status})`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function commandUpdate(currentVersion: string): Promise<void> {
  console.log(`Current version: ${currentVersion}`);

  const release = await fetchLatestRelease();
  if (!release) {
    console.log("Latest version: unavailable");
    console.log("No published GitHub releases are available yet.");
    return;
  }

  const latestVersion = normalizeVersion(release.tag_name);
  console.log(`Latest version: ${latestVersion}`);

  if (compareVersions(currentVersion, latestVersion) >= 0) {
    console.log("HeartBeat is already up to date.");
    return;
  }

  const platform = resolveReleasePlatform();
  const asset = findReleaseAsset(release, platform);
  if (!asset) {
    throw new Error(`Release ${release.tag_name} does not include ${getReleaseAssetName(platform)}`);
  }

  const targetPath = resolveUpdateTargetPath();
  const tempPath = join(dirname(targetPath), `${basename(targetPath)}.tmp-${process.pid}`);
  const binaryContents = await downloadAsset(asset.browser_download_url);

  try {
    writeFileSync(tempPath, binaryContents);
    chmodSync(tempPath, 0o755);
    renameSync(tempPath, targetPath);
  } finally {
    if (resolvePathCandidate(tempPath)) {
      rmSync(tempPath, { force: true });
    }
  }

  console.log(`Updated ${targetPath} to ${latestVersion}`);
}
