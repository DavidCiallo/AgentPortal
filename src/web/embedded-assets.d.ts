/**
 * Ambient types for the web/ static assets imported with the Bun
 * "with { type: 'file' }" import attribute in server.ts. At runtime each
 * import resolves to a path string (the real file in dev, a $bunfs virtual
 * path inside the compiled executable), so the default export is typed as
 * string. These patterns are more specific than bun-types' "*.html"
 * wildcard, so they take precedence for the web/ asset paths.
 */
declare module '*/web/index.html' {
  const path: string
  export default path
}
declare module '*/web/style.css' {
  const path: string
  export default path
}
declare module '*/web/favicon.ico' {
  const path: string
  export default path
}
declare module '*/web/js/events.js' {
  const path: string
  export default path
}
declare module '*/web/js/markdown.js' {
  const path: string
  export default path
}
declare module '*/web/js/project.js' {
  const path: string
  export default path
}
declare module '*/web/js/sessions.js' {
  const path: string
  export default path
}
declare module '*/web/js/settings.js' {
  const path: string
  export default path
}
declare module '*/web/js/sidebar.js' {
  const path: string
  export default path
}
declare module '*/web/js/state.js' {
  const path: string
  export default path
}
declare module '*/web/js/tools.js' {
  const path: string
  export default path
}
declare module '*/web/js/utils.js' {
  const path: string
  export default path
}
declare module '*/web/js/websocket.js' {
  const path: string
  export default path
}
