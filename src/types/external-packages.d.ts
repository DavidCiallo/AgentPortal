/** Type declarations for external packages that are CLI-only */
declare module 'image-processor-napi' {
  export function processImage(data: Buffer, options?: any): Promise<Buffer>
}

declare module 'audio-capture-napi' {
  export function startCapture(): void
  export function stopCapture(): Buffer
}

declare module 'cacache' {
  export function get(cachePath: string, key: string): Promise<any>
  export function put(cachePath: string, key: string, data: any): Promise<void>
}

declare module 'plist' {
  export function parse(xml: string): any
  export function build(obj: any): string
}

declare module '@anthropic-ai/mcpb' {
  export function createClient(config: any): any
}

declare module '@ant/claude-for-chrome-mcp' {
  export function connect(): any
}
