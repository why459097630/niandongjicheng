import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms of Service | Think it Done",
  description: "Terms of Service for using the Think it Done website, builder, PWA generation, and cloud service.",
};

export default function TermsPage() {
  return (
    <LegalPageShell
      badge="Terms"
      title="Terms of Service"
      description="These Terms of Service describe the basic rules for using Think it Done, including the website, builder, generated PWA packages, and cloud service."
    >
      <div className="space-y-8 text-[15px] leading-[1.85] text-[#475569]">
        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Service overview
          </h2>
          <p className="mt-3">
            Think it Done provides tools for local businesses to create a branded PWA customer hub. Features may include business information, products or services, bookings, announcements, customer chat, downloadable PWA packages, and cloud-connected functionality.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            User responsibilities
          </h2>
          <p className="mt-3">
            You are responsible for the accuracy, legality, and ownership rights of the content you submit, including business names, icons, images, descriptions, products, services, announcements, and customer-facing information.
          </p>
          <p className="mt-3">
            You must not use the service for unlawful, fraudulent, abusive, misleading, infringing, harmful, or prohibited activity.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Generated output
          </h2>
          <p className="mt-3">
            Generated PWA packages and customer hub results depend on the information you provide and the technical availability of the service. You should review generated content before sharing it with customers.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Payments and cloud renewal
          </h2>
          <p className="mt-3">
            Some features may require payment. Cloud-connected features may require renewal after the included service period ends. If cloud service is not renewed, some features may become unavailable or limited.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Service changes
          </h2>
          <p className="mt-3">
            Think it Done may update, improve, limit, suspend, or discontinue parts of the service when needed for maintenance, security, product changes, abuse prevention, or operational reasons.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Support and issue review
          </h2>
          <p className="mt-3">
            For bugs, account issues, generation problems, billing questions, or feature suggestions, contact support. Support requests are reviewed based on the information provided and the available service records.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Limitation of liability
          </h2>
          <p className="mt-3">
            To the fullest extent permitted by law, Think it Done is not responsible for indirect, incidental, special, consequential, or lost-profit damages arising from use of the service, inability to use the service, user-submitted content, third-party services, or business outcomes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Contact
          </h2>
          <p className="mt-3">
            For Terms of Service questions, contact{" "}
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