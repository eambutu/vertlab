import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "./components/ui/sonner";
import { Library } from "./components/library/library";
import { ClipPage } from "./components/clip-page";
import {
  SettingsPage,
  SharedLinksPage,
} from "./components/settings/settings-page";
import { SharedPage } from "./components/viewer/shared-page";
import { RequireAuth } from "./components/auth/require-auth";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen w-full bg-background text-foreground">
        <Routes>
          <Route path="/" element={<RequireAuth><Library /></RequireAuth>} />
          <Route path="/clip/:id" element={<RequireAuth><ClipPage /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
          <Route
            path="/settings/shared"
            element={<RequireAuth><SharedLinksPage /></RequireAuth>}
          />
          <Route path="/j/:token" element={<SharedPage kind="clip" />} />
          <Route path="/d/:token" element={<SharedPage kind="day" />} />
          <Route path="/d/:token/:n" element={<SharedPage kind="day" />} />
          <Route path="*" element={<RequireAuth><Library /></RequireAuth>} />
        </Routes>
      </div>
      <Toaster position="top-center" />
    </BrowserRouter>
  );
}
