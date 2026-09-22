import { useState } from "react";
import { Analyzer } from "./components/analyzer";
import { Home } from "./components/home";

export default function App() {
  const [file, setFile] = useState<File | null>(null);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      {file ? (
        <Analyzer file={file} onReset={() => setFile(null)} />
      ) : (
        <Home onFile={setFile} />
      )}
    </div>
  );
}
