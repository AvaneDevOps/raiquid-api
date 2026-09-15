// Standalone obfuscation-payload scanner. No dependencies beyond Node's
// standard library and `git` itself.
//
// Exists because of a real incident: on 2026-09-11 a commit (25aa6b4) landed
// on origin/main with ~7,500 obfuscated characters appended, on the same
// line, after the last `}` of scripts/e2e-db.mjs, preceded by ~1,000 blank
// spaces so it wouldn't show in a normal diff. It leaked `require`/`module`/
// `__dirname`/`__filename` onto `global` under computed property names,
// reached the `Function` constructor indirectly through a function's own
// properties (to avoid the literal string "new Function("), and immediately
// invoked the result -- a textbook obfuscated loader, confirmed by a full
// git-history audit to be isolated to that one commit. See
// docs/RAIQUID_CONTEXT.md for the full incident writeup.
//
// This checks every file `git` tracks for the exact signature set that
// incident confirmed, plus one structural heuristic (a single very long
// line), and exits non-zero if anything matches. Run directly:
//   node scripts/scan-for-obfuscation.mjs
// Wired into .husky/pre-commit (before lint-staged) and CI so the same
// payload -- or a copy-paste of it -- can never land again without being
// caught before it reaches GitHub, and can never merge silently even if a
// hook is bypassed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_LINE_LENGTH = 2000;
const EXCERPT_LENGTH = 200;
const NUL = String.fromCharCode(0);

// Extensions that are legitimately binary or otherwise not worth scanning.
// Deliberately does NOT exclude package-lock.json or migration .sql files --
// both were checked empirically against this repo and neither produces a
// false positive at MAX_LINE_LENGTH.
const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
]);

// Description text below deliberately never spells out the exact trigger
// substrings byte-for-byte (the patterns speak for themselves) -- otherwise
// this file, describing its own rules, would trip its own rules. Same reason
// docs/RAIQUID_CONTEXT.md's incident writeup avoids reproducing them too.
const RULES = [
  {
    id: 'global-assign',
    description:
      'an assignment directly onto the global object using a single-letter property name, or a computed bracket-index assignment onto global whose key begins with an underscore-dollar sign -- the specific obfuscator-generated global leak confirmed in the 2026-09-11 incident (see docs/RAIQUID_CONTEXT.md)',
    pattern: /global\.o\s*=|global\s*\[\s*_\$/,
  },
  {
    id: 'charcode-127-decode',
    description:
      'a String.fromCharCode call constructing character code point 127 (the DEL control character) -- the delimiter used by the shuffle/decode stub confirmed in the 2026-09-11 incident',
    pattern: /String\.fromCharCode\(\s*127\s*\)/,
  },
  {
    id: 'indirect-function-ctor-chain',
    description:
      "a bracket-indexed function reference that is called, whose returned value is itself called again immediately -- the shape of reaching the Function constructor through a function's own properties, chosen specifically so the property name never appears as a literal string. Heuristic, not a semantic detector: it looks for the double-invocation shape, not the property name, since the whole point of the technique is that the name is never written literally.",
    pattern: /\w+\s*\[[^[\]]{1,80}\]\s*\([^()]{0,200}\)\s*\(/,
  },
];

function isBinaryLike(content) {
  return content.includes(NUL);
}

function getTrackedFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 64,
  });
  return out
    .toString('utf8')
    .split(NUL)
    .filter((f) => f.length > 0);
}

function scanFile(repoRoot, relPath) {
  const ext = path.extname(relPath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return [];

  let content;
  try {
    content = readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch {
    // Deleted-but-staged, a submodule pointer, or genuinely unreadable --
    // not this scanner's job to resolve, skip rather than crash the hook.
    return [];
  }
  if (isBinaryLike(content)) return [];

  const findings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.length > MAX_LINE_LENGTH) {
      findings.push({
        file: relPath,
        line: lineNo,
        rule: 'long-line',
        description: `line is ${line.length} characters, over the ${MAX_LINE_LENGTH} threshold`,
        excerpt: line.slice(0, EXCERPT_LENGTH),
        fullLength: line.length,
      });
    }

    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: relPath,
          line: lineNo,
          rule: rule.id,
          description: rule.description,
          excerpt: line.slice(0, EXCERPT_LENGTH),
          fullLength: line.length,
        });
      }
    }
  }
  return findings;
}

function main() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  const files = getTrackedFiles(repoRoot);
  const allFindings = [];
  for (const file of files) {
    allFindings.push(...scanFile(repoRoot, file));
  }

  if (allFindings.length === 0) {
    console.log(
      `scan-for-obfuscation: clean -- ${files.length} tracked files scanned, 0 findings.`,
    );
    process.exit(0);
  }

  console.error(
    `scan-for-obfuscation: ${allFindings.length} finding(s) across ${
      new Set(allFindings.map((f) => f.file)).size
    } file(s).\n`,
  );
  for (const f of allFindings) {
    const truncated =
      f.fullLength > EXCERPT_LENGTH
        ? `${f.excerpt}... (${f.fullLength} chars total, truncated)`
        : f.excerpt;
    console.error(`${f.file}:${f.line}  [${f.rule}]`);
    console.error(`  ${f.description}`);
    console.error(`  ${truncated}\n`);
  }
  process.exit(1);
}

main();
