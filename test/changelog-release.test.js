// The Release workflow rolls the changelog with .github/scripts/changelog-release.mjs:
// the release commit goes straight to main, so what it writes must be right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-foscam';

test('the Unreleased section moves under the new version', () => {
  const before = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Cameras.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const after = rollChangelog(before, '1.0.0', '2026-10-16');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-16\n\n### Added\n\n- Cameras\./,
  );
  assert.match(after, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.HEAD`));
  assert.match(after, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('the next release compares with the previous tag', () => {
  const before = `## [Unreleased]\n\n- Fix.\n\n## [1.0.0] - 2026-10-16\n\n- First.\n\n[Unreleased]: ${REPO}/compare/v1.0.0...HEAD\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`;
  const after = rollChangelog(before, '1.0.1', '2026-10-20');
  assert.match(after, new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.v1\\.0\\.1`));
  assert.equal(rollChangelog(after, '1.0.1', '2026-10-20'), after, 'idempotent');
});

test('the real changelog has an Unreleased section and its link', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.match(text, /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-foscam\//m);
});
