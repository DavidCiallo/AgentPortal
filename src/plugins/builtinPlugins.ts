// Builtin plugins removed — stubs for backward compatibility
export const BUILTIN_MARKETPLACE_NAME = '__builtin__'
export function isBuiltinPluginId(_id: string): boolean {
  return false
}
export function getBuiltinPlugins(): {
  enabled: never[]
  disabled: never[]
} {
  return { enabled: [], disabled: [] }
}
