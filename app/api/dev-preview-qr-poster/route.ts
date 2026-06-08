import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { createPrintableQrPoster } from "@/lib/pwa/createPrintableQrPoster";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 },
    );
  }

  const previewUrl = "https://example.com/customer-hub/demo-store";

  const qrCodeBuffer = await QRCode.toBuffer(previewUrl, {
    type: "png",
    margin: 2,
    width: 640,
    errorCorrectionLevel: "M",
  });

  const posterBuffer = await createPrintableQrPoster({
    businessName: "Demo Local Business",
    qrCodeBuffer,
  });

  return new NextResponse(posterBuffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}