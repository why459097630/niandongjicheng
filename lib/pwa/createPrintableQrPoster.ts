import path from "node:path";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";

const posterFontFamily = "Inter 24pt";

const interFontFiles = [
  path.join(process.cwd(), "assets/fonts/Inter-Regular.ttf"),
  path.join(process.cwd(), "assets/fonts/Inter-Bold.ttf"),
  path.join(process.cwd(), "assets/fonts/Inter-ExtraBold.ttf"),
];

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeBusinessName(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Your Business";
  }

  return trimmed.slice(0, 80);
}

function splitTitle(value: string) {
  const normalized = normalizeBusinessName(value);

  if (normalized.length <= 26) {
    return [normalized];
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= 26) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    return [normalized.slice(0, 26), normalized.slice(26, 52)];
  }

  return lines.slice(0, 2);
}

function renderSvgToPng(svg: string, width: number) {
  return new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: width,
    },
    font: {
      fontFiles: interFontFiles,
      defaultFontFamily: posterFontFamily,
      loadSystemFonts: false,
    },
  })
    .render()
    .asPng();
}

export async function createPrintableQrPoster(options: {
  businessName: string;
  qrCodeBuffer: Buffer;
}) {
  const width = 1080;
  const height = 1600;

  const cardCenterX = width / 2;

  const qrContainerSize = 600;
  const qrContainerX = Math.round((width - qrContainerSize) / 2);
  const qrContainerY = 510;

  const qrSize = 520;
  const qrX = qrContainerX + Math.round((qrContainerSize - qrSize) / 2);
  const qrY = qrContainerY + Math.round((qrContainerSize - qrSize) / 2);

  const titleLines = splitTitle(options.businessName);
  const titleLineHeight = 64;
  const titleStartY = titleLines.length === 1 ? 300 : 268;
  const scanTextY = titleLines.length === 1 ? 420 : 444;

  const badgeWidth = 250;
  const badgeHeight = 44;
  const badgeX = Math.round((width - badgeWidth) / 2);
  const badgeY = 174;

  const titleSvg = titleLines
    .map((line, index) => {
      return `<text x="${cardCenterX}" y="${titleStartY + index * titleLineHeight}" text-anchor="middle" font-family="${posterFontFamily}" font-size="56" font-weight="800" letter-spacing="-1.7" fill="#0f172a">${escapeXml(line)}</text>`;
    })
    .join("");

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>

  <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="22" fill="#f8fafc"/>
  <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="22" stroke="#dbe4ff" stroke-width="2"/>
  <text x="${cardCenterX}" y="203" text-anchor="middle" font-family="${posterFontFamily}" font-size="17" font-weight="800" letter-spacing="3.2" fill="#6366f1">CUSTOMER HUB</text>

  ${titleSvg}

  <text x="${cardCenterX}" y="${scanTextY}" text-anchor="middle" font-family="${posterFontFamily}" font-size="32" font-weight="700" letter-spacing="0.1" fill="#334155">Scan to access our customer hub</text>
  <text x="${cardCenterX}" y="${scanTextY + 48}" text-anchor="middle" font-family="${posterFontFamily}" font-size="23" font-weight="700" letter-spacing="0.1" fill="#818cf8">No app download needed</text>

  <rect x="${qrContainerX}" y="${qrContainerY}" width="${qrContainerSize}" height="${qrContainerSize}" rx="56" fill="#ffffff"/>
  <rect x="${qrContainerX}" y="${qrContainerY}" width="${qrContainerSize}" height="${qrContainerSize}" rx="56" stroke="#e0e7ff" stroke-width="2"/>

  <text x="${cardCenterX}" y="1238" text-anchor="middle" font-family="${posterFontFamily}" font-size="23" font-weight="700" letter-spacing="0.1" fill="#64748b">Scan with your phone camera</text>

  <text x="${cardCenterX}" y="1338" text-anchor="middle" font-family="${posterFontFamily}" font-size="34" font-weight="800" letter-spacing="0.2" fill="#0f172a">Services · Booking · Updates</text>

  <defs>
    <linearGradient id="footerAccentGradient" x1="408" y1="1418" x2="672" y2="1418" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="50%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>

  <rect x="380" y="1418" width="320" height="4" rx="2" fill="url(#footerAccentGradient)"/>

  <text x="${cardCenterX}" y="1492" text-anchor="middle" font-family="${posterFontFamily}" font-size="22" font-weight="700" letter-spacing="0.8" fill="#a8b1c1">Powered by Think It Done</text>
</svg>`;

  const posterBackgroundBuffer = renderSvgToPng(svg, width);

  const posterBuffer = await sharp(posterBackgroundBuffer)
    .composite([
      {
        input: await sharp(options.qrCodeBuffer)
          .resize(qrSize, qrSize, {
            fit: "contain",
            background: "#ffffff",
          })
          .png()
          .toBuffer(),
        left: qrX,
        top: qrY,
      },
    ])
    .png()
    .toBuffer();

  return posterBuffer;
}
