import { Routes, Route } from "react-router-dom";
import AuthGate from "./components/AuthGate";
import Layout from "./components/Layout";
import MapView from "./pages/MapView";
import Nodes from "./pages/Nodes";

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MapView />} />
          <Route path="nodes" element={<Nodes />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
