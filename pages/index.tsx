
import { useState } from 'react';

export default function Home() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');

  const generate = async () => {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: input }),
    });
    const data = await res.json();
    setResult(data.code);
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>Build your app with one sentence</h1>
      <input
        type="text"
        value={input}
        placeholder="e.g. A todo list app with dark theme"
        onChange={(e) => setInput(e.target.value)}
        style={{ width: 400, marginRight: 10 }}
      />
      <button onClick={generate}>Generate App</button>
      <pre style={{ marginTop: 20, background: '#f4f4f4', padding: 10 }}>{result}</pre>
    </div>
  );
}
