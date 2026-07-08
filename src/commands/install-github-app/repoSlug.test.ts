import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('Gitlawb/portal'), 'Gitlawb/portal')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/Gitlawb/portal'),
    'Gitlawb/portal',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/Gitlawb/portal.git'),
    'Gitlawb/portal',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:Gitlawb/portal.git'),
    'Gitlawb/portal',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/Gitlawb/portal'),
    'Gitlawb/portal',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/Gitlawb/SomeRepo'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/Gitlawb'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/Gitlawb/SomeRepo'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/Gitlawb/SomeRepo'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/Gitlawb/SomeRepo'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/Gitlawb/SomeRepo'),
    null,
  )
})
