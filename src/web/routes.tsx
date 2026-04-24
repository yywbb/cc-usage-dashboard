import { Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview/index.js';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<Overview />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
