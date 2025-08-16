// app/page.tsx
import GeneratePanel from './components/GeneratePanel';

export default function Page() {
  return (
    <main className="min-h-screen w-full flex items-start justify-center p-6">
      <GeneratePanel />
    </main>
  );
}
