#!/usr/bin/env bun

const escapeCharacter = String.fromCharCode(27);
const ansiPattern = new RegExp(`${escapeCharacter}\\[[0-9;]*m`, "g");
const dtsWarningPattern = /\bTS90\d+\b/g;
const genericWarningPattern =
  /(?:^|\s)(?:warn|warning|dts\s+warn|declaration\s+warning|▲ \[WARNING\]|⚠)/i;
const neutralWarningPattern = /check-dts-warnings|DTS warning check failed/i;

const separatorIndex = process.argv.indexOf("--");
const command =
  separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(separatorIndex + 1);

if (command.length === 0) {
  console.error("Usage: bun tooling/static-checks/check-dts-warnings.ts -- <build command>");
  process.exit(1);
}

const proc = Bun.spawn(command, {
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

process.stdout.write(stdout);
process.stderr.write(stderr);

if (exitCode !== 0) {
  process.exit(exitCode);
}

const output = `${stdout}\n${stderr}`.replace(ansiPattern, "");
const matches = [...output.matchAll(dtsWarningPattern)].map((match) => match[0] ?? "");
const warningLines = output
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .filter((line) => genericWarningPattern.test(line))
  .filter((line) => !neutralWarningPattern.test(line));
const findings = [...new Set([...matches, ...warningLines])].sort();

if (findings.length > 0) {
  console.error("DTS warning check failed. Build emitted declaration warnings:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}
