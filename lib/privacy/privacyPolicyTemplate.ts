export type PrivacyPolicyPageModel = {
  appName: string;
  storeId: string;
  merchantEmail: string;
  effectiveDate: string;
};

export const PRIVACY_POLICY_TEMPLATE = `Privacy Policy

Effective Date: {{effectiveDate}}

This mobile application ("{{appName}}", or "the App") is operated by the app owner (the "Merchant", "we", "us", or "our").

We respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how information is collected, used, and managed when you use the App.

The merchant (app owner) is responsible for data collected through this App.

--------------------------------------------------

1. App Structure and User Roles

The App is operated by the merchant and distributed to end users.

There are two types of users:

(1) Merchant (App Owner)
The merchant creates and manages the App and must log in to access management features.

The merchant may:
• Publish products or services
• Post announcements or promotional content
• Manage store information
• Communicate with users via in-app chat
• Send notifications (such as chat replies and announcements)

(2) Guest Users (No Login Required)
End users (guests) can install and use the App without creating an account.

Guest users may:
• Browse store information
• View products or services
• Read announcements
• Communicate with the merchant via in-app chat

--------------------------------------------------

2. Information We Collect

Depending on how you use the App, we may collect:

• Merchant Data
  - Account information (such as email)
  - Store details (name, description, contact info)
  - Products, services, and announcements
  - Chat messages

• Guest User Data
  - Chat messages sent to the merchant

• Device Information
  - Push notification token
  - Basic device and usage data

• Uploaded Content
  - Images or content uploaded by the merchant

--------------------------------------------------

3. How We Use the Information

We use the collected information to:

• Provide core app functionality
• Enable communication between merchant and users
• Display products, services, and announcements
• Send push notifications (chat replies and announcements)
• Maintain and improve app performance

--------------------------------------------------

4. Data Storage

Data is stored securely using cloud services, including:

• Supabase (database and authentication)
• Firebase (push notifications)

These services may process data in accordance with their own privacy policies.

Data is stored only as necessary to provide app functionality.

--------------------------------------------------

5. Data Sharing

We do not sell personal data.

We may share limited data with third-party services only when required to operate the App, including:

• Firebase (push notifications)
• Google Play services (app distribution)

--------------------------------------------------

6. Notifications

The App may send push notifications, including:

• Chat messages from the merchant
• Announcements or promotional updates

Users may disable notifications through device settings.

--------------------------------------------------

7. User Rights

Users may:

• Stop using the App at any time
• Disable notifications
• Contact the merchant to request data deletion (if applicable)

--------------------------------------------------

8. Children's Privacy

The App is not intended for children under 13.

--------------------------------------------------

9. Changes to This Policy

We may update this Privacy Policy from time to time.

--------------------------------------------------

10. Contact

For any questions, please contact the app owner:

{{merchantEmail}}`;

function pickFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildPrivacyPolicyPageModel(input: {
  storeId: string;
  appName: string;
  merchantEmail: string;
  effectiveDate: string;
}): PrivacyPolicyPageModel {
  const appName = input.appName.trim() || "This App";
  const merchantEmail = input.merchantEmail.trim() || "Not provided";
  const effectiveDate = input.effectiveDate.trim() || "2026-04-20";

  return {
    appName,
    storeId: input.storeId.trim(),
    merchantEmail,
    effectiveDate,
  };
}

export function renderPrivacyPolicyText(model: PrivacyPolicyPageModel): string {
  return PRIVACY_POLICY_TEMPLATE
    .replaceAll("{{appName}}", model.appName)
    .replaceAll("{{effectiveDate}}", model.effectiveDate)
    .replaceAll("{{merchantEmail}}", model.merchantEmail);
}

export function renderPrivacyPolicyHtml(model: PrivacyPolicyPageModel): string {
  return escapeHtml(renderPrivacyPolicyText(model)).replace(/\n/g, "<br />");
}