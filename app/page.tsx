import BuildPanel from './components/BuildPanel';

export default function Page() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">Generate APK</h1>
      <BuildPanel />
    </main>
  );
}
