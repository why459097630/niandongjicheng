import { notFound } from "next/navigation";
import { getPrivacyPageByStoreId } from "@/lib/privacy/getPrivacyPageByStoreId";
import {
  buildPrivacyPolicyPageModel,
  renderPrivacyPolicyText,
} from "@/lib/privacy/privacyPolicyTemplate";

type PrivacyPageProps = {
  params: Promise<{
    storeId: string;
  }>;
};

export default async function Page({ params }: PrivacyPageProps) {
  const { storeId } = await params;
  const privacyPage = await getPrivacyPageByStoreId(storeId);

  if (!privacyPage) {
    notFound();
  }

  const model = buildPrivacyPolicyPageModel({
    storeId: privacyPage.storeId,
    appName: privacyPage.appName,
    merchantEmail: privacyPage.merchantEmail,
    effectiveDate: privacyPage.effectiveDate,
  });

  const policyText = renderPrivacyPolicyText(model);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-[-0.03em]">Privacy Policy</h1>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="text-sm text-slate-500">App Name</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{model.appName}</div>

          <div className="mt-4 text-sm text-slate-500">Contact</div>
          <div className="mt-1 text-sm font-medium text-slate-900">
            {model.merchantEmail || "Not provided"}
          </div>

          <div className="mt-4 text-sm text-slate-500">Effective Date</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{model.effectiveDate}</div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <pre className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 font-sans">
            {policyText}
          </pre>
        </div>
      </div>
    </main>
  );
}