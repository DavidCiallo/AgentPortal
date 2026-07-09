/**
 * Systematically remove process.env.USER_TYPE dead code patterns.
 *
 * Strategy: 3 safe passes that handle different pattern types.
 *
 * Usage: bun run scripts/derebrand-remove-ant-dce.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const SRC_DIR = join(import.meta.dir, '..', 'src')

function collectFiles(dir: string): string[] {
  const result: string[] = []
  const entries = new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: dir, absolute: true })
  for (const f of entries) result.push(f)
  return result.sort()
}

function findMatching(text: string, start: number, open: string, close: string): number {
  let depth = 1, i = start
  while (i < text.length && depth > 0) {
    if (text[i] === open) depth++
    else if (text[i] === close) depth--
    if (depth > 0) i++
  }
  return depth === 0 ? i : -1
}

// ---------------------------------------------------------------------------
// Pass A: Handle spread patterns with USER_TYPE
// ---------------------------------------------------------------------------
function transformSpreads(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Pattern: `...(process.env.USER_TYPE === 'ant' && EXPR)`
    const spreadAndMatch = trimmed.match(/^\.\.\.\(process\.env\.USER_TYPE\s*===\s*'ant'\s*&&/)
    if (spreadAndMatch) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      // Find the closing `)` matching the one after ...(
      const parenStart = trimmed.indexOf('(') + 1
      const restOfTrimmed = trimmed.slice(parenStart)
      let depth = 0
      let closeParen = -1
      for (let ci = 0; ci < restOfTrimmed.length; ci++) {
        if (restOfTrimmed[ci] === '(') depth++
        else if (restOfTrimmed[ci] === ')') {
          if (depth === 0) { closeParen = parenStart + ci; break }
          depth--
        }
      }

      if (closeParen > 0) {
        // Check if there's a trailing comma after the spread
        const afterClose = trimmed.slice(closeParen + 1)
        const hasComma = afterClose.trimStart().startsWith(',')
        // The entire spread (including comma if present) is dead
        // Just skip this line
        i++
      } else {
        result.push(line); i++
      }
      continue
    }

    // Pattern: `...(process.env.USER_TYPE === 'ant' ? A : B)`
    const spreadTernaryMatch = trimmed.match(/^\.\.\.\(process\.env\.USER_TYPE\s*===\s*'ant'\s*\?\s*/)
    if (spreadTernaryMatch) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      // Find the matching paren for the entire ...() expression
      const openParen = trimmed.indexOf('(')
      const closeParen = findMatching(trimmed, openParen + 1, '(', ')')
      if (closeParen > 0) {
        // The entire `...(A : B)` expression. Extract B (after colon).
        // Find the colon at depth 0
        let depth = 0
        let colonPos = -1
        for (let ci = openParen + 1; ci < closeParen; ci++) {
          if (trimmed[ci] === '(' || trimmed[ci] === '[' || trimmed[ci] === '{') depth++
          else if (trimmed[ci] === ')' || trimmed[ci] === ']' || trimmed[ci] === '}') depth--
          else if (depth === 0 && trimmed[ci] === ':') { colonPos = ci; break }
        }
        if (colonPos > 0) {
          const extBranch = trimmed.slice(colonPos + 1, closeParen).trim()
          const afterClose = trimmed.slice(closeParen + 1).trimStart()
          const hasComma = afterClose.startsWith(',')
          const commaOffset = hasComma ? afterClose.indexOf(',') + 1 : 0
          // Emit the external branch as a spread
          const nextLine = indent + `...(${extBranch})${hasComma ? ',' : ''}`
          result.push(nextLine)
          i++
          continue
        }
      }
    }

    // Pattern: multi-line spread `...(process.env.USER_TYPE === 'ant'`
    // Check if this line starts a multi-line spread
    if (trimmed.startsWith('...(') && trimmed.includes("process.env.USER_TYPE === 'ant'") && !trimmed.endsWith(')')) {
      // Multi-line spread — merge lines until we find matching )
      let merged = line
      let j = i + 1
      let openCnt = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
      while (j < lines.length && openCnt > 0) {
        merged += '\n' + lines[j]
        openCnt += (lines[j].match(/\(/g) || []).length
        openCnt -= (lines[j].match(/\)/g) || []).length
        j++
      }
      // Check if this is a ternary spread
      if (merged.includes("process.env.USER_TYPE === 'ant' ? ") || merged.includes("process.env.USER_TYPE === 'ant' ?\n")) {
        // Find colon at depth 0 in the merged content
        const parenStart = merged.indexOf('(')
        const closeParen = findMatching(merged, parenStart + 1, '(', ')')
        if (closeParen > 0) {
          let depth = 0
          let colonPos = -1
          for (let ci = parenStart + 1; ci < closeParen; ci++) {
            if (merged[ci] === '(' || merged[ci] === '[' || merged[ci] === '{') depth++
            else if (merged[ci] === ')' || merged[ci] === ']' || merged[ci] === '}') depth--
            else if (depth === 0 && merged[ci] === ':') { colonPos = ci; break }
          }
          if (colonPos > 0) {
            const extBranch = merged.slice(colonPos + 1, closeParen).trim()
            result.push(`        ...(${extBranch}),`)
            i = j
            continue
          }
        }
      }
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

// ---------------------------------------------------------------------------
// Pass B: Handle standalone ternaries with USER_TYPE
// ---------------------------------------------------------------------------
function transformTernaries(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Multi-line ternary: condition on this line, ? on next line
    // Pattern: `process.env.USER_TYPE === 'ant'` followed by `?` on a later line
    const condMatch = trimmed.match(/^process\.env\.USER_TYPE\s*===\s*'ant'$/)
    const condMatchExtra = trimmed.match(/^process\.env\.USER_TYPE\s*===\s*'ant'\s*(&&|\|\|)?\s*$/)

    if (condMatch || (condMatchExtra && !condMatchExtra[1])) {
      // The condition ends on this line. Check next line for `?`
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        if (nextLine.startsWith('?')) {
          // Ternary: `process.env.USER_TYPE === 'ant'\n? A : B`
          // Find the `:` on subsequent lines
          let colonLine = -1
          let colonPos = -1
          for (let j = i + 1; j < lines.length; j++) {
            const cl = lines[j]
            const ci = cl.indexOf(':')
            if (ci >= 0 && j > i + 1) {
              // Verify this is the ternary's `:`, not something else
              colonLine = j
              colonPos = ci
              break
            }
            if (j > i + 1 && !cl.trim().startsWith(':') && !cl.trim().startsWith('?') && !cl.trim().startsWith('}') && !cl.trim().startsWith(']')) {
              // Not a continuation of the ternary — probably a different pattern
              colonLine = -2
              break
            }
          }
          if (colonLine >= 0) {
            const colonLineContent = lines[colonLine]
            const afterColon = colonLineContent.slice(colonPos + 1).trim()
            // Check if the colon line has content after it (the external branch)
            result.push(line.match(/^\s*/)?.[0] ?? '' + afterColon)
            i = colonLine + 1
            continue
          }
        }
      }
    }

    // Single-line ternary: `process.env.USER_TYPE === 'ant' ? A : B`
    const simpleTernary = trimmed.match(
      /^process\.env\.USER_TYPE\s*===\s*'ant'\s*\?\s*(.+)\s*:\s*(.+)$/,
    )
    if (simpleTernary) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const externalBranch = simpleTernary[2]!.trim()
      result.push(indent + externalBranch)
      i++
      continue
    }

    // `process.env.USER_TYPE !== 'ant' ? A : B` → A (keep the external branch)
    const negatedTernary = trimmed.match(
      /^process\.env\.USER_TYPE\s*!==\s*'ant'\s*\?\s*(.+)\s*:\s*(.+)$/,
    )
    if (negatedTernary) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const externalBranch = negatedTernary[1]!.trim()
      result.push(indent + externalBranch)
      i++
      continue
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

// ---------------------------------------------------------------------------
// Pass C: Remove `if (process.env.USER_TYPE === 'ant')` blocks
// ---------------------------------------------------------------------------
function removeAntIfBlocks(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Match if (process.env.USER_TYPE === 'ant') — possibly with && extra condition
    const antIf = trimmed.match(/^if\s*\(\s*process\.env\.USER_TYPE\s*===\s*'ant'\s*(&&|\|\|)?/)
    // Match else if (process.env.USER_TYPE === 'ant') — possibly with && extra
    const elseAntIf = trimmed.match(/^\}\s*else\s+if\s*\(\s*process\.env\.USER_TYPE\s*===\s*'ant'\s*(&&|\|\|)?/)
    // Match if (process.env.USER_TYPE !== 'ant') — possibly with || extra
    const notAntIf = trimmed.match(/^if\s*\(\s*process\.env\.USER_TYPE\s*!==\s*'ant'\s*(\|\||&&)?/)

    if (antIf) {
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const extraOp = antIf[1] // && or || or undefined

      if (extraOp === '||') {
        // `if (false || X)` — outcome depends on X. Skip.
        result.push(line); i++; continue
      }

      // Find the close paren of the if-condition
      const parenStart = trimmed.indexOf('(')
      let wholeIfLine = line
      let currentLineIdx = i

      // Find the matching close paren (may span multiple lines)
      let closeParen = -1
      const firstLine = trimmed.slice(parenStart + 1)
      let depth = 0, found = false
      for (let ci = 0; ci < firstLine.length; ci++) {
        if (firstLine[ci] === '(') depth++
        else if (firstLine[ci] === ')') {
          if (depth === 0) { closeParen = firstLine.indexOf(')') + parenStart + (i > 0 ? 0 : 0); found = true; break }
          depth--
        }
      }
      if (!found) {
        // Close paren not on this line — scan ahead
        let merged = line.slice(line.indexOf('(') + 1)
        depth = 0
        // count existing paren depth from first line
        for (const ch of line) {
          if (ch === '(' && line.indexOf('(') <= line.indexOf(ch)) depth++
          else if (ch === ')') depth--
        }
        if (depth < 0) depth = 0

        let j = i + 1
        while (j < lines.length) {
          merged += '\n' + lines[j]
          for (const ch of lines[j]) {
            if (ch === '(') depth++
            else if (ch === ')') {
              depth--
              if (depth === 0) { closeParen = merged.length - 1; currentLineIdx = j; found = true; break }
            }
          }
          if (found) break
          j++
        }
        if (!found) { result.push(line); i++; continue }
      }

      // Find the opening brace after the close paren
      // We need to look at the rest of the line after the close paren
      // Actually let me re-approach this more simply.

      // The if condition is `if (COND)`. After the COND, there's `) { ...`.
      // Let me just find where the block starts.

      // Simple approach: find `) {` near where closeParen would be
      // Re-scan:
      let braceStart = -1
      let braceLine = i

      // On the current line, look for `)` and then `{`
      if (closeParen > 0) {
        // closeParen is relative to the merged string. Map back to a line index.
        // For simplicity, just look at the current progress
        let merged = ''
        let mergedLen = 0
        let closeParenAbs = -1
        let dj = i
        while (dj < lines.length) {
          const prefix = dj > i ? '\n' : ''
          merged += prefix + lines[dj]
          if (merged.includes(')') && closeParenAbs < 0) {
            // Find the last ) in merged
            closeParenAbs = merged.lastIndexOf(')')
          }
          if (closeParenAbs >= 0) {
            const rest = merged.slice(closeParenAbs + 1)
            if (rest.includes('{')) {
              braceStart = merged.indexOf('{', closeParenAbs)
              braceLine = dj
              break
            }
            if (rest.includes('\n') && /\S/.test(rest) && !rest.startsWith(' ') && !rest.startsWith('\n')) {
              // Next line content without brace — might be a non-block if
              break
            }
          }
          dj++
        }
      }

      if (braceStart < 0) {
        // No brace found — this might be `if (cond) statement;` or `if (cond)`
        // For simplicity, skip this case
        result.push(line); i++; continue
      }

      // Skip from if line to end of block
      i = braceLine

      // Now skip to the matching }
      let braceDepthOnLine = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length
      i++
      while (i < lines.length && braceDepthOnLine > 0) {
        braceDepthOnLine += (lines[i].match(/\{/g) || []).length
        braceDepthOnLine -= (lines[i].match(/\}/g) || []).length
        i++
      }

      // Check for else / else-if
      if (i < lines.length) {
        const nx = lines[i].trim()
        if (nx.match(/^\}?\s*else\s+/)) {
          if (nx.includes('else if')) {
            // else-if — skip the whole else-if block
            // The } is on this line
            let eDepth = (nx.match(/\{/g) || []).length - (nx.match(/\}/g) || []).length
            if (eDepth > 0) {
              i++
              while (i < lines.length && eDepth > 0) {
                eDepth += (lines[i].match(/\{/g) || []).length
                eDepth -= (lines[i].match(/\}/g) || []).length
                i++
              }
            } else {
              i++
              if (i < lines.length) {
                eDepth = (lines[i].match(/\{/g) || []).length
                if (eDepth > 0) {
                  i++
                  while (i < lines.length && eDepth > 0) {
                    eDepth += (lines[i].match(/\{/g) || []).length
                    eDepth -= (lines[i].match(/\}/g) || []).length
                    i++
                  }
                }
              }
            }
          } else {
            // plain else — skip block
            let eDepth = (nx.match(/\{/g) || []).length - (nx.match(/\}/g) || []).length
            if (eDepth > 0) {
              i++
              while (i < lines.length && eDepth > 0) {
                eDepth += (lines[i].match(/\{/g) || []).length
                eDepth -= (lines[i].match(/\}/g) || []).length
                i++
              }
            } else {
              i++
              if (i < lines.length) {
                eDepth = (lines[i].match(/\{/g) || []).length
                if (eDepth > 0) {
                  i++
                  while (i < lines.length && eDepth > 0) {
                    eDepth += (lines[i].match(/\{/g) || []).length
                    eDepth -= (lines[i].match(/\}/g) || []).length
                    i++
                  }
                }
              }
            }
          }
        }
      }
      continue
    }

    if (elseAntIf) {
      // else-if for ant — skip this branch
      // The `} else if (process.env.USER_TYPE === 'ant'` is on this line
      // There might be an extra condition after
      const indent = line.match(/^\s*/)?.[0] ?? ''

      // Find the opening brace of the else-if body
      let bracePos = line.indexOf('{')
      let eDepth = 0

      if (bracePos >= 0) {
        // Brace on this line
        eDepth = (line.slice(bracePos + 1).match(/\{/g) || []).length
        eDepth -= (line.slice(bracePos + 1).match(/\}/g) || []).length
        if (eDepth <= 0) {
          // Entire block on one line — just skip
          i++
          continue
        }
        i++
      } else {
        // Brace on next line
        i++
        if (i < lines.length) {
          eDepth = (lines[i].match(/\{/g) || []).length
          i++
        }
      }

      while (i < lines.length && eDepth > 0) {
        eDepth += (lines[i].match(/\{/g) || []).length
        eDepth -= (lines[i].match(/\}/g) || []).length
        i++
      }

      // Check for another else after this else-if
      if (i < lines.length) {
        const nx = lines[i].trim()
        if (nx.match(/^\}?\s*else\s+/)) {
          // Let the next iteration handle it
          // But the `}` belongs to this block, so we need to keep the `else` part
          // If it's `} else {` or `} else if`, we just continue
          // The `} else {` case: this becomes `{` which is invalid. Keep the else.
          if (nx.includes('else if')) {
            // Don't need to do anything special — the else-if will be handled
          } else if (nx.includes('else {')) {
            // The else block is dead too (since the if was always false)
            // Skip it
            i++
            let ed2 = (lines[i].match(/\{/g) || []).length
            if (ed2 > 0) {
              i++
              while (i < lines.length && ed2 > 0) {
                ed2 += (lines[i].match(/\{/g) || []).length
                ed2 -= (lines[i].match(/\}/g) || []).length
                i++
              }
              i--
            }
          }
        }
      }
      continue
    }

    if (notAntIf) {
      // `if (process.env.USER_TYPE !== 'ant')` — always true for external
      const extraOp = notAntIf[1]
      if (extraOp === '&&') {
        // `if (true && X)` — depends on X. Skip.
        result.push(line); i++; continue
      }

      // Find the block and unwrap it
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const parenStart = trimmed.indexOf('(')

      // Find close paren
      let closeParenPos = trimmed.lastIndexOf(')')
      if (closeParenPos <= parenStart) {
        // Multi-line condition — skip
        result.push(line); i++; continue
      }

      const afterParen = trimmed.slice(closeParenPos + 1).trimStart()

      if (afterParen.startsWith('{')) {
        let bodyContent = afterParen.slice(1)
        let braceDepth = 1
        braceDepth += (bodyContent.match(/\{/g) || []).length
        braceDepth -= (bodyContent.match(/\}/g) || []).length

        if (braceDepth <= 0) {
          // Single-line block: `if (cond) { body }`
          const body = bodyContent.replace(/\}\s*$/, '').trim()
          if (body) result.push(indent + body)
          i++
          // Skip else
          if (i < lines.length && lines[i].trim().match(/^\}?\s*else/)) {
            // Check if it's } else { or } else if
            const nx = lines[i].trim()
            i++
            if (nx.includes('{')) {
              let ed = (nx.match(/\{/g) || []).length - (nx.match(/\}/g) || []).length
              if (ed > 0) {
                while (i < lines.length && ed > 0) {
                  ed += (lines[i].match(/\{/g) || []).length
                  ed -= (lines[i].match(/\}/g) || []).length
                  i++
                }
              }
            }
          }
        } else {
          // Multi-line block
          i++
          while (i < lines.length && braceDepth > 0) {
            const cl = lines[i]
            braceDepth += (cl.match(/\{/g) || []).length
            braceDepth -= (cl.match(/\}/g) || []).length
            if (braceDepth > 0) {
              result.push(cl)
            } else {
              const braceIdx = cl.indexOf('}')
              const beforeBrace = cl.slice(0, braceIdx).trim()
              if (beforeBrace) result.push(cl.slice(0, braceIdx))
            }
            i++
          }
          // Skip else
          if (i < lines.length && lines[i].trim().match(/^\}?\s*else/)) {
            const nx = lines[i].trim()
            i++
            if (nx.includes('else if')) {
              // } else if (...) { — skip the block
              let ed = (nx.match(/\{/g) || []).length
              if (ed > 0) {
                i++
                while (i < lines.length && ed > 0) {
                  ed += (lines[i].match(/\{/g) || []).length
                  ed -= (lines[i].match(/\}/g) || []).length
                  i++
                }
              }
            } else if (nx.includes('{')) {
              let ed = 1
              i++
              while (i < lines.length && ed > 0) {
                ed += (lines[i].match(/\{/g) || []).length
                ed -= (lines[i].match(/\}/g) || []).length
                i++
              }
            }
          }
        }
      } else if (afterParen) {
        // Single-line body without braces
        result.push(indent + afterParen)
        i++
      } else {
        i++
      }
      continue
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

// ---------------------------------------------------------------------------
// Pass D: Clean up stale comments and whitespace
// ---------------------------------------------------------------------------
function cleanup(text: string): string {
  // Remove DCE-related comments
  text = text.replace(/^\s*\/\/\s*(Dead code elimination|DCE):.*$/gm, '')
  text = text.replace(/^\s*\/\/\s*biome-ignore lint\/correctness\/useHookAtTopLevel:\s*(process\.env\.)?USER_TYPE is (a )?(build-time|compile-time) constant.*$/gm, '')
  text = text.replace(/^\s*\/\/\s*USER_TYPE is a build-time constant.*$/gm, '')

  // Remove trailing whitespace
  text = text.replace(/[ \t]+$/gm, '')
  // Reduce 3+ blank lines to 2
  text = text.replace(/\n{4,}/g, '\n\n\n')
  return text
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = collectFiles(SRC_DIR)
console.log(`Processing ${files.length} files...`)

let modified = 0
for (const file of files) {
  try {
    const original = readFileSync(file, 'utf-8')
    let content = original

    content = transformSpreads(content)
    content = transformTernaries(content)
    content = removeAntIfBlocks(content)
    content = cleanup(content)

    if (content !== original) {
      writeFileSync(file, content, 'utf-8')
      console.log(`  ${relative(SRC_DIR, file)}`)
      modified++
    }
  } catch (err) {
    console.error(`  ERROR: ${err}  —  ${file}`)
  }
}

console.log(`\nDone. ${modified} files modified.`)
