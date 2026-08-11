import { useEffect, useState } from 'react';
import { APP_VERSION, RELEASE_NOTES } from '../data/releaseNotes';

export const VersionChangelog = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <>
      <button className="version-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
        VERSIÓN {APP_VERSION} · VER CAMBIOS
      </button>
      {open && (
        <div className="modal-backdrop changelog-backdrop" onClick={() => setOpen(false)}>
          <section className="game-modal changelog-modal" role="dialog" aria-modal="true" aria-labelledby="changelog-title" onClick={(event) => event.stopPropagation()}>
            <button className="changelog-close" onClick={() => setOpen(false)} aria-label="Cerrar historial de cambios">×</button>
            <span className="eyebrow">DIARIO DEL SALOON</span>
            <h2 id="changelog-title">Historial de cambios</h2>
            <p>Las novedades más recientes aparecen primero.</p>
            <div className="release-list">
              {RELEASE_NOTES.map((release, index) => (
                <article key={release.version} className="release-entry">
                  <header><h3>v{release.version}</h3>{index === 0 && <span>ACTUAL</span>}</header>
                  <ul>{release.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
};
