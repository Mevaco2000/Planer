import { Logo } from '../components/Icon';

export function NotConfigured() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo size={48} />
        <h1>Brak konfiguracji Firebase</h1>
        <p>
          Utwórz plik <code>.env</code> na podstawie <code>.env.example</code> i wpisz dane swojego projektu Firebase (instrukcja w <code>README.md</code>), a potem
          uruchom ponownie <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}
