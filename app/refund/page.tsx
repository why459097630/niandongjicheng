import type { Metadata } from "next";
import LegalPageShell from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Refund Policy | Think it Done",
  description: "Refund Policy for Think it Done PWA generation and cloud renewal payments.",
};

export default function RefundPage() {
  return (
    <LegalPageShell
      badge="Refund"
      title="Refund Policy"
      description="This Refund Policy explains how setup payment, generation issues, duplicate payments, and cloud renewal payments are handled."
    >
      <div className="space-y-8 text-[15px] leading-[1.85] text-[#475569]">
        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Setup payment
          </h2>
          <p className="mt-3">
            If PWA generation fails and the issue cannot be fixed after review, you may request a refund for the setup payment.
          </p>
          <p className="mt-3">
            If the generated PWA package has already been delivered successfully, the setup payment is generally non-refundable.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Generation issues
          </h2>
          <p className="mt-3">
            If you experience a technical issue during generation, contact support with your account email, payment date, and any available order or generation details. The issue will be reviewed based on the available service records.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Cloud renewal
          </h2>
          <p className="mt-3">
            Cloud renewal payments are generally non-refundable once the renewed cloud service period starts.
          </p>
          <p className="mt-3">
            If there is a duplicate payment, billing error, or technical payment issue, contact support for review.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            What to include in a refund request
          </h2>
          <p className="mt-3">
            Please include your account email, payment date, payment provider, order details if available, and a clear description of the issue.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
            Contact
          </h2>
          <p className="mt-3">
            Send refund and billing questions to{" "}
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