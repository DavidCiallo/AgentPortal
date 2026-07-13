/**
 * Stub — original CLI Ink barrel export removed. Provides minimal types
 * and no-op implementations for shared code that still references Ink.
 */
import { createElement, type ReactNode } from 'react'

export type RenderOptions = { stdout?: NodeJS.WriteStream; exitOnCtrlC?: boolean }
export type Instance = { unmount: () => void; waitUntilExit: () => Promise<void>; rerender: (node: ReactNode) => void }
export type Root = { render: (node: ReactNode) => void; unmount: () => void; waitUntilExit: () => Promise<void> }
export type Props = { children?: ReactNode; [key: string]: any }

export async function render(_node: ReactNode, _options?: NodeJS.WriteStream | RenderOptions): Promise<Instance> {
  return { unmount: () => {}, waitUntilExit: async () => {}, rerender: () => {} }
}

export async function createRoot(_options?: RenderOptions): Promise<Root> {
  return { render: () => {}, unmount: () => {}, waitUntilExit: async () => {} }
}

export const color = {
  dim: (s: string) => s,
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  blue: (s: string) => s,
  cyan: (s: string) => s,
  magenta: (s: string) => s,
  white: (s: string) => s,
  gray: (s: string) => s,
  grey: (s: string) => s,
  hex: (_c: string) => (s: string) => s,
  bgRed: { bold: (s: string) => s },
}

export type BoxProps = Props & { flexDirection?: string; padding?: number; gap?: number }
export const Box: React.FC<BoxProps> = ({ children }) => createElement('div', null, children)

export type TextProps = Props & { bold?: boolean; dimColor?: boolean; color?: string; wrap?: string }
export const Text: React.FC<TextProps> = ({ children }) => createElement('span', null, children)

export const ThemeProvider: React.FC<{ children?: ReactNode }> = ({ children }) => createElement('div', null, children)
export const usePreviewTheme = () => ({ theme: 'dark' })

export const useApp = () => ({ exit: () => {} })
export const useInput = (_handler: (input: string, key: any) => void) => {}
export const useStdin = () => ({ stdin: process.stdin, setRawMode: () => {} })
export const useStdout = () => ({ stdout: process.stdout })
export const useStderr = () => ({ stderr: process.stderr })
export const useFocus = () => ({ isFocused: true })
export const useIsScreenReaderEnabled = () => false

export type Key = { ctrl?: boolean; meta?: boolean; shift?: boolean; return?: boolean; escape?: boolean; tab?: boolean; backspace?: boolean; delete?: boolean; upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean; pageUp?: boolean; pageDown?: boolean }
