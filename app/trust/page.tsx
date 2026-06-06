import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Trust & Security | Think it Done",
  description: "How Think it Done handles payment, delivery, support, cloud service, and business data.",
};

export default function TrustPage() {
  return (
    <LegalPageShell
      badge="Trust"
      title="Trust & Security"
      description="Think it Done helps local businesses create a branded PWA customer hub with clear payment, delivery, support, and data handling."
    >
      <div className="space-y-8 text-[15px] leading-[1.85] text-[#475569]">
        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            What Think it Done provides
          </h2>
          <p className="mt-3">
            Think it Done helps local businesses create a branded PWA customer hub that customers can open by link or QR code, save to their home screen, and use like a lightweight app.
          </p>
          <p className="mt-3">
            A customer hub can include business information, product or service listings, bookings, announcements, customer chat, and basic customer-facing updates.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Payment and delivery
          </h2>
          <p className="mt-3">
            Paid generation is designed to create a downloadable PWA package and a cloud-connected customer hub setup after successful processing.
          </p>
          <p className="mt-3">
            If generation fails or a payment-related issue occurs, contact support so the issue can be reviewed.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Cloud service
          </h2>
          <p className="mt-3">
            Paid users may receive an initial cloud service period. After that period, the cloud service may need to be renewed to keep cloud features available.
          </p>
          <p className="mt-3">
            If cloud service expires, the app may be limited, and stored cloud data may be deleted after the stated retention period if service is not renewed.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Business data handling
          </h2>
          <p className="mt-3">
            Store data is separated by business account. Uploaded content, customer messages, appointments, announcements, and related records are used to provide customer hub functionality.
          </p>
          <p className="mt-3">
            Think it Done does not sell customer data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Support
          </h2>
          <p className="mt-3">
            For bugs, feature suggestions, payment issues, generation issues, or account questions, contact support at{" "}
            <a className="font-semibold text-[#0f172a] underline underline-offset-4" href="mailto:support@thinkitdoneapp.com">
              support@thinkitdoneapp.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Independent builder notice
          </h2>
          <p className="mt-3">
            Think it Done is currently built and maintained by an independent developer. The product is actively improved based on real business feedback, bug reports, and practical use cases.
          </p>
        </section>
      </div>
    </LegalPageShell>
  );
}