/**
 * Commit-message rules, enforced locally by the Husky `commit-msg` hook and
 * again in CI. We extend the Conventional Commits preset
 * (https://www.conventionalcommits.org) and only tighten one thing: the scope
 * must be one of our area names, so history stays greppable by area.
 *
 * Format:  type(scope): subject      e.g.  feat(investor): add marketplace filter
 *
 * Allowed types come from @commitlint/config-conventional
 * (feat, fix, chore, docs, refactor, test, build, ci, perf, revert, style).
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scope is required and must be from this list (mirrors the frontend repo's
    // area-based scopes, adjusted to this repo's module names).
    'scope-enum': [
      2,
      'always',
      [
        'business',
        'buyer',
        'investor',
        'admin',
        'auth',
        'prisma',
        'infra',
        'docs',
        'deps',
      ],
    ],
    'scope-empty': [2, 'never'],
  },
};
