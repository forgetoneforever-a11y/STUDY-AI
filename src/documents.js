const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

async function extractDocument(buffer, filename) {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const data = await pdfParse(buffer);
    return data.text || "";
  }
  if (ext === "docx") {
    const data = await mammoth.extractRawText({ buffer });
    return data.value || "";
  }
  if (ext === "txt" || ext === "md") return buffer.toString("utf8");
  throw new Error("Поддерживаются PDF, DOCX, TXT и MD.");
}
module.exports = { extractDocument };
