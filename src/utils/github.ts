/**
 * GitHub Actions output utilities
 */

import { appendFileSync } from 'fs'

let githubOutputPath: string = ''

/**
 * Initialize GitHub output path
 */
export function initGitHubOutput(path: string): void {
  githubOutputPath = path
}

/**
 * Set GitHub Actions output
 */
export function setOutput(name: string, value: string): void {
  if (githubOutputPath) {
    appendFileSync(githubOutputPath, `${name}=${value}\n`)
  }
  console.log(`::set-output name=${name}::${value}`)
}
