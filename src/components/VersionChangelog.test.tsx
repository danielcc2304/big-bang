import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { RELEASE_NOTES } from '../data/releaseNotes';
import { VersionChangelog } from './VersionChangelog';

describe('VersionChangelog', () => {
  it('muestra la versión de package.json y abre los cambios en orden LIFO', () => {
    const view = render(<VersionChangelog />);
    const component = within(view.container);
    fireEvent.click(component.getByRole('button', { name: `VERSIÓN ${packageMetadata.version} · VER CAMBIOS` }));

    const dialog = component.getByRole('dialog', { name: 'Historial de cambios' });
    const versions = within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(versions).toEqual(RELEASE_NOTES.map((release) => `v${release.version}`));
    expect(versions[0]).toBe(`v${packageMetadata.version}`);
  });

  it('se puede cerrar con Escape', () => {
    const view = render(<VersionChangelog />);
    const component = within(view.container);
    fireEvent.click(component.getByRole('button', { name: /VER CAMBIOS/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(component.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
