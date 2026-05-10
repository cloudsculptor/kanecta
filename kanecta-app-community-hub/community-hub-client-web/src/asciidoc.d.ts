// Type declaration for AsciiDoc imports — remove alongside the Vite asciidocPlugin
declare module '*.adoc' {
  const html: string;
  export default html;
}
