
import { useEffect, useState } from "react";
import axios from "axios";

function App() {
  const [status, setStatus] = useState("Checking backend...");

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const { data } = await axios.get("/api/health");
        setStatus(data.message);
      } catch (error) {
        console.error("Backend health check failed:", error.message);
        setStatus("Backend not reachable");
      }
    };

    checkBackend();
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-white">
      <div className="rounded-xl border border-gray-200 p-8 text-center">
        <h1 className="text-3xl font-bold">Blogify</h1>
        <p className="mt-2 text-gray-600">{status}</p>
      </div>
    </main>
  );
}

export default App;
