import {
  PRIVACY_POLICY_TEMPLATE,
  buildPrivacyPolicyPageModel,
} from "@/lib/privacy/privacyPolicyTemplate";

type PrivacyPageProps = {
  params: {
    storeId: string;
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function Page({ params, searchParams }: PrivacyPageProps) {
  const model = buildPrivacyPolicyPageModel({
    storeId: params.storeId,
    appName: searchParams?.appName,
    merchantEmail: searchParams?.merchantEmail,
    effectiveDate: searchParams?.effectiveDate,
  });

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold tracking-[-0.03em]">Privacy Policy</h1>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="text-sm text-slate-500">App Name</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{model.appName}</div>

          <div className="mt-4 text-sm text-slate-500">Store ID</div>
          <div className="mt-1 break-all text-sm font-medium text-slate-900">{model.storeId}</div>

          <div className="mt-4 text-sm text-slate-500">Contact</div>
          <div className="mt-1 text-sm font-medium text-slate-900">
            {model.merchantEmail || "Not provided"}
          </div>

          <div className="mt-4 text-sm text-slate-500">Effective Date</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{model.effectiveDate}</div>
        </div>

        <div className="mt-8 space-y-8">
          {PRIVACY_POLICY_TEMPLATE.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-slate-900">
                {section.title}
              </h2>
              <div className="mt-3 space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-slate-700">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}