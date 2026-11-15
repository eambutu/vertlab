import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "./components/ui/sonner";
import { Library } from "./components/library/library";
import { ClipPage } from "./components/clip-page";
import {
  SettingsPage,
  SharedLinksPage,
} from "./components/settings/settings-page";
import { SharedPage } from "./components/viewer/shared-page";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen w-full bg-background text-foreground">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/clip/:id" element={<ClipPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/shared" element={<SharedLinksPage />} />
          <Route path="/j/:token" element={<SharedPage kind="clip" />} />
          <Route path="/d/:token" element={<SharedPage kind="day" />} />
          <Route path="/d/:token/:n" element={<SharedPage kind="day" />} />
          <Route path="*" element={<Library />} />
        </Routes>
      </div>
      <Toaster position="top-center" />
    </BrowserRouter>
  );
}
