declare module 'pdf-parse' {
  type PdfParseResult = {
    text: string;
  };

  type PdfInput = Uint8Array | ArrayBuffer | Buffer;

  function pdfParse(data: PdfInput): Promise<PdfParseResult>;

  export default pdfParse;
}

