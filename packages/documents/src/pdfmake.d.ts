// Minimal types for pdfmake 0.3 (server build); the package ships none.
declare module 'pdfmake' {
  interface OutputDocument {
    getBuffer(): Promise<Uint8Array>;
  }
  interface PdfMake {
    setFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    setLocalAccessPolicy(callback: (path: string) => boolean): void;
    createPdf(definition: Record<string, unknown>): OutputDocument;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}
