// pages/index.tsx
import Head from 'next/head'
import dynamic from 'next/dynamic'

// 你的 GeneratePanel 放在 app/components 下面（前端记得把下拉改成 core/form/simple 三项）
const GeneratePanel = dynamic(() => import('../app/components/GeneratePanel'), { ssr: false })

export default function Home() {
  return (
    <>
      <Head>
        <title>一键生成 APK</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="根据需求与选择的模板，生成 Android APK" />
      </Head>

      <main className="min-h-screen bg-[#0B1020] text-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <h1 className="text-3xl font-bold mb-2">一键生成 APK</h1>
          <p className="text-white/70 mb-6">
            输入需求，并从下拉框<strong>选择模板</strong>（core-template / form-template / simple-template），即可将代码写入仓库并触发 CI。
          </p>

          <GeneratePanel />
        </div>
      </main>
    </>
  )
}
