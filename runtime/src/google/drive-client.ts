import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { drive_v3 } from "googleapis";
import type { GoogleCredentials } from "./gmail-client.js";
import { Readable } from "stream";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
  webViewLink: string;
  owners: string[];
}

export interface DriveFileContent {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  wordCount: number;
}

/**
 * Google Drive API client for Nova.
 * Supports: list, search, read, upload files, and PDF creation.
 */
export class DriveClient {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;

  constructor(credentials: GoogleCredentials) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      "http://localhost:18790/oauth/callback",
    );
    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
    });
    this.drive = google.drive({ version: "v3", auth: this.oauth2Client });
  }

  async listFiles(params?: {
    query?: string;
    maxResults?: number;
  }): Promise<DriveFile[]> {
    const response = await this.drive.files.list({
      pageSize: params?.maxResults || 15,
      q: params?.query || undefined,
      fields:
        "files(id, name, mimeType, size, modifiedTime, webViewLink, owners)",
      orderBy: "modifiedTime desc",
    });

    return (response.data.files || []).map((f) => this.toFile(f));
  }

  async searchFiles(query: string): Promise<DriveFile[]> {
    // Build Drive search query — search by name and full text
    const driveQuery = `(name contains '${query.replace(/'/g, "\\'")}' or fullText contains '${query.replace(/'/g, "\\'")}') and trashed = false`;
    return this.listFiles({ query: driveQuery, maxResults: 15 });
  }

  async readFile(fileId: string): Promise<DriveFileContent> {
    // Get file metadata
    const meta = await this.drive.files.get({
      fileId,
      fields: "id, name, mimeType",
    });

    const mimeType = meta.data.mimeType || "";
    let content = "";

    if (mimeType === "application/vnd.google-apps.document") {
      // Export Google Docs as plain text
      const res = await this.drive.files.export({
        fileId,
        mimeType: "text/plain",
      });
      content = String(res.data || "");
    } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      // Export Sheets as CSV
      const res = await this.drive.files.export({
        fileId,
        mimeType: "text/csv",
      });
      content = String(res.data || "");
    } else if (mimeType === "application/vnd.google-apps.presentation") {
      // Export Slides as plain text
      const res = await this.drive.files.export({
        fileId,
        mimeType: "text/plain",
      });
      content = String(res.data || "");
    } else if (
      mimeType.startsWith("text/") ||
      mimeType === "application/json"
    ) {
      // Download text-based files directly
      const res = await this.drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" },
      );
      content = String(res.data || "");
    } else {
      content = `[Binary file: ${mimeType}. Cannot display content. Use the webViewLink to open in browser.]`;
    }

    // Truncate large content
    const truncated = content.slice(0, 30_000);

    return {
      id: fileId,
      name: meta.data.name || "",
      mimeType,
      content: truncated,
      wordCount: truncated.split(/\s+/).length,
    };
  }

  async uploadFile(params: {
    name: string;
    content: Buffer;
    mimeType: string;
    folderId?: string;
  }): Promise<DriveFile> {
    const fileMetadata: drive_v3.Schema$File = {
      name: params.name,
    };
    if (params.folderId) {
      fileMetadata.parents = [params.folderId];
    }

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: params.mimeType,
        body: Readable.from(params.content),
      },
      fields: "id, name, mimeType, size, modifiedTime, webViewLink, owners",
    });

    return this.toFile(response.data);
  }

  async createPdf(params: {
    title: string;
    content: string;
    folderId?: string;
  }): Promise<DriveFile> {
    const PDFDocument = (await import("pdfkit")).default;

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        info: { Title: params.title },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Title
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .text(params.title, { align: "center" });
      doc.moveDown(1.5);

      // Content — split by newlines, handle markdown-like headings
      const lines = params.content.split("\n");
      for (const line of lines) {
        if (line.startsWith("## ")) {
          doc.moveDown(0.5);
          doc.fontSize(14).font("Helvetica-Bold").text(line.slice(3));
          doc.moveDown(0.3);
        } else if (line.startsWith("# ")) {
          doc.moveDown(0.5);
          doc.fontSize(16).font("Helvetica-Bold").text(line.slice(2));
          doc.moveDown(0.3);
        } else if (line.trim() === "") {
          doc.moveDown(0.5);
        } else {
          doc.fontSize(11).font("Helvetica").text(line, { align: "left" });
        }
      }

      doc.end();
    });

    const fileName =
      params.title.replace(/[^a-zA-Z0-9\s-_]/g, "").trim() + ".pdf";
    return this.uploadFile({
      name: fileName,
      content: pdfBuffer,
      mimeType: "application/pdf",
      folderId: params.folderId,
    });
  }

  private toFile(file: drive_v3.Schema$File): DriveFile {
    return {
      id: file.id || "",
      name: file.name || "",
      mimeType: file.mimeType || "",
      size: file.size || "0",
      modifiedTime: file.modifiedTime || "",
      webViewLink: file.webViewLink || "",
      owners: (file.owners || [])
        .map((o) => o.emailAddress || "")
        .filter(Boolean),
    };
  }
}
