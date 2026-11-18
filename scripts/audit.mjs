// Runs `npm audit` over all locked dependencies and fails on every advisory of any severity,
// except the explicitly allowed ones below. Uses Node built-ins only: the manual audit
// workflow runs this without installing packages.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * Advisories that have no patched version and cannot affect the shipped package.
 * Remove an entry as soon as a fix ships: upgrade the dependency, then delete the entry.
 * The audit fails on an entry that npm no longer reports, so stale entries cannot linger.
 */
/** @type {{ id: string, packageName: string, reason: string }[]} */
const allowed = [];

const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
/**
 * @typedef {{ name: string, title: string, url?: string, source: number, severity: string }} Advisory
 * @typedef {{ error?: { summary?: string }, vulnerabilities?: Record<string, { via: (string | Advisory)[] }> }} AuditReport
 */
/** @type {AuditReport} */
let report;
try {
  report = /** @type {AuditReport} */ (JSON.parse(result.stdout));
} catch {
  console.error(result.stderr || result.stdout || 'npm audit produced no output.');
  process.exit(1);
}
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  process.exit(1);
}

/** @type {Map<string, { id: string, packageName: string, severity: string, title: string, url: string | undefined }>} */
const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== 'object') continue;
    const id = via.url?.split('/').pop() ?? String(via.source);
    advisories.set(`${via.name} ${id}`, {
      id,
      packageName: via.name,
      severity: via.severity,
      title: via.title,
      url: via.url,
    });
  }
}

/** @param {{ id: string, packageName: string }} advisory */
const isAllowed = (advisory) =>
  allowed.some((entry) => entry.id === advisory.id && entry.packageName === advisory.packageName);
const blocking = [...advisories.values()].filter((advisory) => !isAllowed(advisory));
const stale = allowed.filter(
  (entry) => ![...advisories.values()].some((a) => a.id === entry.id && a.packageName === entry.packageName),
);

for (const advisory of advisories.values()) {
  if (isAllowed(advisory))
    console.warn(`Allowed: ${advisory.packageName} ${advisory.id} (${advisory.severity}) ${advisory.title}`);
}
for (const advisory of blocking) {
  console.error(
    `Vulnerable: ${advisory.packageName} ${advisory.id} (${advisory.severity}) ${advisory.title} ${advisory.url ?? ''}`,
  );
}
for (const entry of stale) {
  console.error(
    `Stale allowlist entry: ${entry.packageName} ${entry.id} is no longer reported; remove it from scripts/audit.mjs.`,
  );
}
if (blocking.length > 0 || stale.length > 0) process.exit(1);
console.log(`npm audit passed (${advisories.size - blocking.length} allowed advisories).`);
