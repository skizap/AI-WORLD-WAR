// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ErrorBoundary } from '../src/ErrorBoundary';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    status: 503,
    statusText: 'Unavailable',
    json: async () => ({ message: 'API unavailable' }),
  }) as Response));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('app shell accessibility and render recovery', () => {
  it('supports roving tab focus and keyboard section navigation', async () => {
    render(<App />);
    const setup = await screen.findByRole('tab', { name: 'Setup' });
    const replay = screen.getByRole('tab', { name: 'Replay' });

    fireEvent.keyDown(setup, { key: 'End' });
    expect(document.activeElement).toBe(replay);
    expect(replay.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Replay' })).toBeTruthy();

    fireEvent.keyDown(replay, { key: 'ArrowLeft' });
    const analytics = screen.getByRole('tab', { name: 'Analytics' });
    expect(document.activeElement).toBe(analytics);
    expect(analytics.getAttribute('aria-selected')).toBe('true');
  });

  it('provides a recoverable fallback for view render failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function BrokenView(): never {
      throw new Error('fixture render failure');
    }

    render(<ErrorBoundary><BrokenView /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('This view could not be rendered');
    expect(screen.getByText('fixture render failure')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload interface' })).toBeTruthy();
  });
});
