import { Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview/index.js';
import ProjectsList from './pages/Projects/List.js';
import ProjectDetail from './pages/Projects/Detail.js';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<Overview />} />
      <Route path="/projects" element={<ProjectsList />} />
      <Route path="/projects/:b64" element={<ProjectDetail />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
