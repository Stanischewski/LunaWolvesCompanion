export default function HomePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-8">
        <div>
          <h1 className="text-5xl font-bold tracking-tight">Luna Wolves</h1>
          <p className="text-zinc-400 mt-2 text-lg">Guild Companion</p>
        </div>
        <a
          href={`${apiUrl}/auth/bnet`}
          className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
        >
          Mit Battle.net einloggen
        </a>
      </div>
    </main>
  );
}
