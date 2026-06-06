import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy | Think it Done",
  description: "Privacy Policy for the Think it Done website and PWA generation service.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell
      badge="Privacy"
      title="Privacy Policy"
      description="This Privacy Policy explains how Think it Done handles information collected through the website, builder, payment flow, support flow, and PWA generation service."
    >
      <div className="space-y-8 text-[15px] leading-[1.85] text-[#475569]">
        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Information we collect
          </h2>
          <p className="mt-3">
            We may collect account information, contact information, builder form inputs, business details, uploaded icons or images, generation records, payment status, support messages, and technical logs needed to operate the service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            How we use information
          </h2>
          <p className="mt-3">
            We use information to provide the website, generate PWA packages, operate cloud service, process support requests, maintain security, troubleshoot bugs, improve product quality, and communicate service-related updates.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Payment information
          </h2>
          <p className="mt-3">
            Payments may be handled by third-party payment providers. Think it Done does not need to store full payment card details. Payment providers may process payment information according to their own policies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Generated PWA and business data
          </h2>
          <p className="mt-3">
            Information submitted through the builder may be used to create and operate a branded customer hub for the business. Store data is separated by business account.
          </p>
          <p className="mt-3">
            Customer-facing records such as bookings, announcements, messages, and uploaded content are used to provide the related customer hub features.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Data sharing
          </h2>
          <p className="mt-3">
            We do not sell customer data. We may share limited information with service providers only when needed for hosting, storage, payment processing, analytics, security, email, support, or other service operations.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Data retention
          </h2>
          <p className="mt-3">
            We keep information for as long as needed to provide the service, comply with legal obligations, resolve disputes, prevent abuse, and maintain business records. Cloud service data may be deleted after expiration if service is not renewed according to the applicable service rules.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Contact
          </h2>
          <p className="mt-3">
            For privacy questions, contact{" "}
            <a className="font-semibold text-[#0f172a] underline underline-offset-4" href="mailto:support@thinkitdoneapp.com">
              support@thinkitdoneapp.com
            </a>
            .
          </p>
        </section>
      </div>
    </LegalPageShell>
  );
}