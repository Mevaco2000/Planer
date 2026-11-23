import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { Toaster } from './components/Toast';
import { UIProvider } from './components/UIContext';
import { Spinner } from './components/ui';
import { UpdatePrompt } from './components/UpdatePrompt';
import { DataProvider } from './data';
import { firebaseConfigured } from './firebase';
import { Inbox } from './pages/Inbox';
import { Login } from './pages/Login';
import { NotConfigured } from './pages/NotConfigured';
import { Plan } from './pages/Plan';
import { ProjectPage } from './pages/ProjectPage';
import { Projects } from './pages/Projects';
import { Routines } from './pages/Routines';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { TaskPage } from './pages/TaskPage';
import { Calendar } from './pages/Calendar';
import { GraphPage } from './pages/Graph';
import { Today } from './pages/Today';

export function App() {
  if (!firebaseConfigured) return <NotConfigured />;
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
      <Toaster />
      <UpdatePrompt />
    </AuthProvider>
  );
}

/** Osobny stan widoku dla każdego projektu. */
function ProjectRoute() {
  const { id = '' } = useParams();
  return <ProjectPage key={id} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="plan" element={<Plan />} />
        <Route path="rutyny" element={<Routines />} />
        <Route path="kalendarz" element={<Calendar />} />
        <Route path="nadchodzace" element={<Navigate to="/kalendarz?v=lista" replace />} />
        <Route path="graf" element={<GraphPage />} />
        <Route path="skrzynka" element={<Inbox />} />
        <Route path="projekty" element={<Projects />} />
        <Route path="projekty/:id" element={<ProjectRoute />} />
        <Route path="szukaj" element={<Search />} />
        <Route path="ustawienia" element={<Settings />} />
        <Route path="zadanie/:id" element={<TaskPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="splash">
        <Spinner />
      </div>
    );
  if (!user) return <Login />;
  return (
    <DataProvider key={user.uid}>
      <UIProvider>
        <AppRoutes />
      </UIProvider>
    </DataProvider>
  );
}
