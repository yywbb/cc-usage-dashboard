import { Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview/index.js';
import ProjectsList from './pages/Projects/List.js';
import ProjectDetail from './pages/Projects/Detail.js';
import SessionsList from './pages/Sessions/List.js';
import SessionDetail from './pages/Sessions/Detail.js';
import Cost from './pages/Cost/index.js';
import Settings from './pages/Settings/index.js';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<Overview />} />
      <Route path="/projects" element={<ProjectsList />} />
      <Route path="/projects/:b64" element={<ProjectDetail />} />
      <Route path="/sessions" element={<SessionsList />} />
      <Route path="/sessions/:sessionId" element={<SessionDetail />} />
      <Route path="/cost" element={<Cost />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
