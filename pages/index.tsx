import Head from 'next/head'
import GeneratePanel from '../components/GeneratePanel'

export default function Home() {
  return (
    <>
      <Head>
        <title>APK Generator</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-900 p-6">
        <div className="mx-auto max-w-3xl">
          <GeneratePanel />
        </div>
      </main>
    </>
  )
}
