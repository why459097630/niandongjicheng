export type PrivacyPolicyPageModel = {
  appName: string;
  storeId: string;
  merchantEmail: string;
  effectiveDate: string;
};

export type PrivacyPolicySection = {
  title: string;
  paragraphs: string[];
};

export const PRIVACY_POLICY_TEMPLATE: PrivacyPolicySection[] = [
  {
    title: "1. Information We Collect",
    paragraphs: [
      "This app may collect information that you voluntarily provide when you contact the merchant, submit a message, or interact with content inside the app.",
      "Depending on the features enabled for this app, that information may include your name, contact details, message content, and basic usage activity related to app content."
    ]
  },
  {
    title: "2. How Information Is Used",
    paragraphs: [
      "The information collected through this app is used to operate the app, respond to customer inquiries, provide merchant services, and improve the user experience.",
      "We do not use your information for unrelated purposes outside the normal operation of this app and the merchant services connected to it."
    ]
  },
  {
    title: "3. Data Sharing",
    paragraphs: [
      "Information may be processed by service providers used to support app hosting, cloud storage, notifications, analytics, or customer communication features.",
      "We do not sell your personal information."
    ]
  },
  {
    title: "4. Data Retention",
    paragraphs: [
      "Information is retained only for as long as necessary to operate the app, comply with legal obligations, resolve disputes, and enforce applicable agreements."
    ]
  },
  {
    title: "5. Your Rights",
    paragraphs: [
      "You may contact the merchant to request access to, correction of, or deletion of your information, subject to applicable law and operational requirements."
    ]
  },
  {
    title: "6. Contact",
    paragraphs: [
      "If you have questions about this Privacy Policy or data handling for this app, please contact the merchant using the contact information shown below."
    ]
  }
];

function pickFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

export function buildPrivacyPolicyPageModel(input: {
  storeId: string;
  appName?: string | string[];
  merchantEmail?: string | string[];
  effectiveDate?: string | string[];
}): PrivacyPolicyPageModel {
  const appName = pickFirst(input.appName).trim() || "This App";
  const merchantEmail = pickFirst(input.merchantEmail).trim();
  const effectiveDate = pickFirst(input.effectiveDate).trim() || "2026-04-20";

  return {
    appName,
    storeId: input.storeId.trim(),
    merchantEmail,
    effectiveDate,
  };
}