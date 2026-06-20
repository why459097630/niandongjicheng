import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import {
  getBuildRecordByRunId,
  insertOperationLogOnce,
  syncAuthUserProfile,
} from "@/lib/build/storage";
import { createPrintableQrPoster } from "@/lib/pwa/createPrintableQrPoster";

export const runtime = "nodejs";

function getPwaUrlFromRecord(record: {
  artifactUrl: string | null;
  storeId?: string | null;
}) {
  const artifactUrl = String(record.artifactUrl || "").trim();

  if (artifactUrl) {
    return artifactUrl;
  }

  const storeId = String(record.storeId || "").trim();

  if (!storeId) {
    return "";
  }

  const baseUrl =
    process.env.PWA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_PWA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "";

  if (!baseUrl) {
    return "";
  }

  return `${baseUrl.replace(/\/+$/, "")}/pwa/${encodeURIComponent(storeId)}`;
}

function sanitizeFileName(value: string) {
  const normalized = value.trim() || "Think-it-Done-PWA";
  return normalized
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function createContentDispositionFileName(fileName: string) {
  const asciiFallback = fileName
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim() || "Think-it-Done-PWA-Package.zip";

  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error("NDJC download-pwa-package: failed to sync profile", profileError);
    }

    const runId = request.nextUrl.searchParams.get("runId")?.trim() || "";

    if (!runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing runId.",
        },
        { status: 400 },
      );
    }

    const record = await getBuildRecordByRunId(supabase, runId);

    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          error: "Build record not found.",
        },
        { status: 404 },
      );
    }

    if (record.status !== "success") {
      return NextResponse.json(
        {
          ok: false,
          error: "PWA package is not ready yet.",
        },
        { status: 409 },
      );
    }

    const pwaUrl = getPwaUrlFromRecord(record);

    if (!pwaUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "PWA URL is missing.",
        },
        { status: 409 },
      );
    }

    await insertOperationLogOnce(
      supabase,
      {
        userId: user.id,
        buildId: record.id,
        runId,
        eventName: "download_clicked",
        pagePath: "/api/download-pwa-package",
        metadata: {
          source: "download_pwa_package",
          runId,
          storeId: record.storeId || "",
          pwaUrl,
        },
      },
      { dedupeSeconds: 5 },
    ).catch(() => null);

    const qrCodeBuffer = await QRCode.toBuffer(pwaUrl, {
      type: "png",
      margin: 4,
      width: 720,
      errorCorrectionLevel: "Q",
    });

    const printableQrPosterBuffer = await createPrintableQrPoster({
      businessName: record.appName,
      qrCodeBuffer,
    });

    const zip = new JSZip();

    zip.file(
      "START-HERE.txt",
      [
        "START HERE",
        "",
        "Thank you for creating your Customer Hub with Think It Done.",
        "",
        "App Name:",
        record.appName,
        "",
        "Store ID:",
        record.storeId || "",
        "",
        "Customer Hub URL:",
        pwaUrl,
        "",
        "What is this?",
        "",
        "This is your branded Customer Hub. Customers can open it from a link or QR code, browse your services, book appointments, and receive updates.",
        "",
        "What should you do first?",
        "",
        "1. Open the Customer Hub URL and check your business information.",
        "",
        "2. To manage your Customer Hub, open the Home page and tap the admin entry button on the right side of the search box. This opens the admin login page.",
        "",
        "3. Print printable-qr-poster.png and place it at your store, front desk, table, counter, menu, flyer, or window.",
        "",
        "4. Before promoting your Customer Hub, open it yourself and test the main flow: browse as a customer, log in as admin, check business information, create an announcement, test booking, messages, notifications, and app setup.",
        "",
        "5. Share the Customer Hub URL on Google Maps, Instagram, Facebook, WhatsApp, Messenger, TikTok, SMS, email, your website, or printed materials.",
        "",
        "6. For push updates and reminders, customers should follow the platform setup guide in README.txt. iPhone and iPad require iOS / iPadOS 16.4 or later and must be added to the Home Screen for push notifications.",
        "",
        "7. Keep this ZIP package safe. Your Store ID may be needed for support or cloud renewal.",
        "",
        "For app setup, sharing, admin login, and usage notes, please read README.txt.",
        "",
        "For cloud service, renewal, expiration, and data retention rules, please read CLOUD-SERVICE.txt.",
        "",
      ].join("\n"),
    );

    zip.file(
      "README.txt",
      [
        "README",
        "",
        "Thank you for using Think It Done.",
        "",
        "This package contains your generated Customer Hub files.",
        "",
        "==================================================",
        "1. Basic Information",
        "==================================================",
        "",
        "App Name:",
        record.appName,
        "",
        "Store ID:",
        record.storeId || "",
        "",
        "Customer Hub URL:",
        pwaUrl,
        "",
        "Your Customer Hub is a lightweight app-like customer entry. Customers can open it from a link or QR code without downloading from an app store.",
        "",
        "You do not need to understand PWA technology to use it. Just share the link or QR code, manage your content from the admin area, and guide customers to save it to their phone home screen.",
        "",
        "==================================================",
        "2. Files Included",
        "==================================================",
        "",
        "START-HERE.txt",
        "Quick start guide. Please read this first.",
        "",
        "README.txt",
        "Instructions for sharing, admin login, app setup, notifications, home screen installation, and important notes.",
        "",
        "CLOUD-SERVICE.txt",
        "Cloud service, renewal, expiration, and data retention rules.",
        "",
        "customer-hub-qr-code.png",
        "Plain QR code for your Customer Hub. Use it in your own poster, menu, flyer, business card, or social media image.",
        "",
        "printable-qr-poster.png",
        "Ready-to-print QR poster. Print it and place it at your store, front desk, table, counter, menu, flyer, or window.",
        "",
        "==================================================",
        "3. Admin Login",
        "==================================================",
        "",
        "To manage your Customer Hub, open the Customer Hub URL and go to the Home page.",
        "",
        "Tap the admin entry button on the right side of the search box to open the admin login page.",
        "",
        "This entry is for the business owner or staff only.",
        "",
        "==================================================",
        "4. Share with Customers",
        "==================================================",
        "",
        "Share your Customer Hub URL on Google Maps, Instagram, Facebook, WhatsApp, Messenger, TikTok, SMS, email, your website, or printed materials.",
        "",
        "Customers can open the link directly or scan the QR code with their phone camera.",
        "",
        "==================================================",
        "5. App Setup: Install and Notifications",
        "==================================================",
        "",
        "Your Customer Hub works on iPhone, iPad, Android, and desktop browsers.",
        "",
        "Customers do not need to download it from an app store. They can open it from your link or QR code.",
        "",
        "For the best experience, customers should add the Customer Hub to their home screen and allow notifications.",
        "",
        "",
        "iPhone / iPad",
        "",
        "Requirements:",
        "",
        "- iOS / iPadOS 16.4 or later",
        "- Safari",
        "- The Customer Hub must be added to the Home Screen",
        "- The Customer Hub must be opened from the Home Screen icon",
        "- Notifications must be allowed",
        "",
        "Setup steps:",
        "",
        "1. Open the Customer Hub link in Safari.",
        "2. Tap the Share button.",
        "3. Tap Add to Home Screen.",
        "4. Open the Customer Hub from the new Home Screen icon.",
        "5. Tap the notification / app setup button inside the Customer Hub.",
        "6. Allow notifications when prompted.",
        "",
        "Important:",
        "",
        "- Push notifications on iPhone and iPad require iOS / iPadOS 16.4 or later.",
        "- Push notifications require the Customer Hub to be added to the Home Screen.",
        "- Notifications may not work if the Customer Hub is only opened inside Safari without adding it to the Home Screen.",
        "- If notifications are blocked, open iOS Settings and allow notifications for the Customer Hub.",
        "- If the device is running an older iOS / iPadOS version, customers can still open the Customer Hub from the link or QR code, but push notifications may not be available.",
        "",
        "",
        "Android",
        "",
        "Requirements:",
        "",
        "- Android phone or tablet",
        "- Chrome or Edge is recommended",
        "- Notifications must be allowed",
        "",
        "Setup steps:",
        "",
        "1. Open the Customer Hub link in Chrome or Edge.",
        "2. Tap the notification / app setup button inside the Customer Hub.",
        "3. Tap Add or Install if the browser shows an install option.",
        "4. Allow notifications when prompted.",
        "",
        "Important:",
        "",
        "- The Customer Hub can work from the browser link, but adding it to the Home Screen makes it easier to reopen.",
        "- Push notifications require browser notification permission.",
        "- If notifications are blocked, allow notifications in the browser settings or Android system settings.",
        "",
        "",
        "Desktop",
        "",
        "Requirements:",
        "",
        "- Chrome, Edge, or another modern browser that supports web notifications",
        "- Browser notifications must be allowed",
        "- System notifications must not be disabled",
        "",
        "Setup steps:",
        "",
        "1. Open the Customer Hub link on your computer.",
        "2. Tap the notification / app setup button inside the Customer Hub.",
        "3. Allow notifications when prompted.",
        "4. If the browser shows an install option, you can install the Customer Hub as a desktop app.",
        "",
        "Important:",
        "",
        "- Desktop installation is optional.",
        "- Push notifications require browser notification permission.",
        "- Notifications may not appear if browser notifications or system notifications are turned off.",
        "",
        "",
        "If notifications are not allowed, customers can still open and use the Customer Hub from the link or QR code, but push reminders, chat alerts, booking updates, and announcements may not be received.",
        "",
        "==================================================",
        "6. Important Notes",
        "==================================================",
        "",
        "1. The QR code points to your current Customer Hub URL.",
        "",
        "2. If your Customer Hub URL changes in the future, the old QR code may no longer point to the newest address.",
        "",
        "3. Some online features depend on active cloud service, such as appointments, messages, announcements, push notifications, updates, and admin changes. After cloud service expires, online write actions will be disabled. For cloud status, expiration time, renewal, and data retention rules, please read CLOUD-SERVICE.txt.",
        "",
        "4. Keep a copy of this ZIP package.",
        "",
        "5. The printable QR poster is provided for easy promotion. You may print it directly or use the plain QR code in your own design.",
        "",
        "6. Customers can open the Customer Hub from a link or QR code. They do not need to download it from an app store.",
        "",
        "7. Before promoting your Customer Hub, please open it yourself and become familiar with all main operations inside the Customer Hub, including customer browsing, booking, messages, notifications, admin login, business information, announcements, and updates.",
        "",
        "==================================================",
        "7. Support",
        "==================================================",
        "",
        "If you need help, please contact Think It Done support and include your Store ID:",
        "",
        record.storeId || "",
        "",
      ].join("\n"),
    );

    zip.file(
      "CLOUD-SERVICE.txt",
      [
        "CLOUD SERVICE",
        "",
        "This file explains cloud service, renewal, expiration, and data retention rules for your Customer Hub.",
        "",
        "App Name:",
        record.appName,
        "",
        "Store ID:",
        record.storeId || "",
        "",
        "Customer Hub URL:",
        pwaUrl,
        "",
        "==================================================",
        "1. What Cloud Service Supports",
        "==================================================",
        "",
        "Cloud service is important for online features in your Customer Hub.",
        "",
        "It may be used for appointments, messages, announcements, push notifications, updates, customer data, and admin changes.",
        "",
        "Push notifications may include announcements, booking reminders, and message updates.",
        "",
        "After cloud service expires, online write actions will be disabled. This may affect actions such as creating or editing appointments, sending messages, publishing announcements, sending push notifications, updating business information, or making admin changes.",
        "",
        "Existing data may remain readable during the data retention period.",
        "",
        "Your cloud status and expiration time may be shown inside the Customer Hub.",
        "",
        "You can also check cloud status and expiration time on the Think It Done website, in your History page.",
        "",
        "==================================================",
        "2. Free Plan",
        "==================================================",
        "",
        "Free Plan cloud service is available for 7 days.",
        "",
        "When the Free Plan cloud service expires, cloud data will not be deleted immediately.",
        "",
        "After expiration, online write actions will be disabled. Existing data may remain readable during the data retention period.",
        "",
        "Free Plan cloud data may be deleted after 3 days from expiration.",
        "",
        "To upgrade from the Free Plan to a Paid Plan, please go to the Think It Done website and generate a new paid Customer Hub.",
        "",
        "The Free Plan and the new Paid Plan may be separate build records, so please check the new Customer Hub before promoting it.",
        "",
        "==================================================",
        "3. Paid Plan",
        "==================================================",
        "",
        "Paid cloud service is available for 30 days after purchase.",
        "",
        "When paid cloud service expires, cloud data will not be deleted immediately.",
        "",
        "After expiration, online write actions will be disabled. Existing data may remain readable during the data retention period.",
        "",
        "If cloud service is not renewed, paid cloud data may be deleted after 60 days from expiration.",
        "",
        "==================================================",
        "4. Renewal",
        "==================================================",
        "",
        "Cloud renewal is linked to your Store ID:",
        "",
        record.storeId || "",
        "",
        "To renew cloud service:",
        "",
        "1. Go to the Think It Done website.",
        "2. Open your History page.",
        "3. Find this build record.",
        "4. Use the Renew Cloud option.",
        "",
        "Please keep your Store ID and this ZIP package safe. Your Store ID may be needed for support or cloud renewal.",
        "",
        "==================================================",
        "5. Important Notes",
        "==================================================",
        "",
        "1. Cloud service expiration affects online write actions such as appointments, messages, announcements, push notifications, updates, and admin changes.",
        "",
        "2. Existing data may remain readable during the data retention period, but new online changes cannot be saved after cloud service expires.",
        "",
        "3. Data deletion timing may depend on cloud service status, renewal status, and system processing.",
        "",
        "4. If you plan to keep using the Customer Hub, renew cloud service before the data retention period ends.",
        "",
        "5. If you need help with renewal or cloud service status, please contact Think It Done support and include your Store ID.",
        "",
        "==================================================",
        "6. Support",
        "==================================================",
        "",
        "If you need help, please contact Think It Done support and include your Store ID:",
        "",
        record.storeId || "",
        "",
      ].join("\n"),
    );

    zip.file("customer-hub-qr-code.png", qrCodeBuffer);
    zip.file("printable-qr-poster.png", printableQrPosterBuffer);

    const zipArrayBuffer = await zip.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6,
      },
    });

    const fileName = `${sanitizeFileName(record.appName)}-PWA-Package.zip`;

    return new NextResponse(zipArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": createContentDispositionFileName(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to download PWA package.",
      },
      { status: 500 },
    );
  }
}
