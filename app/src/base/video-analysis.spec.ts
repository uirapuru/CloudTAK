import { describe, it, expect } from 'vitest';
import { contentRect, isActive, progressDetail, thumbSrc, type Analysis } from './video-analysis.ts';

const BASE: Analysis = {
    id: 1, source: 'recording', label: 'patrol-3', account: 'ola', created_by: 'administrator',
    created_at: '2026-11-26 14:10:00', started_at: null, finished_at: null, state: 'running',
    percent: 41.4, elapsed_s: null, persons: 3, error: null,
};

describe('video analysis helpers', () => {
    it('treats queued and running as active', () => {
        expect(isActive({ state: 'queued' })).toBe(true);
        expect(isActive({ state: 'running' })).toBe(true);
        for (const state of ['done', 'stopped', 'error'] as const) expect(isActive({ state })).toBe(false);
    });

    it('shows percent of a recording and time of a live stream while running', () => {
        expect(progressDetail(BASE)).toBe('41%');
        expect(progressDetail({ ...BASE, source: 'live', percent: null, elapsed_s: 125 })).toBe('2:05');
        expect(progressDetail({ ...BASE, source: 'live', percent: null, elapsed_s: 3725 })).toBe('1:02:05');
        expect(progressDetail({ ...BASE, state: 'done', percent: 100 })).toBeNull();
    });

    it('adds the token to a thumbnail and leaves faces without one empty', () => {
        const face = { id: 3, label: 'Osoba 3', count: 2, thumb_url: '/api/vision/analyses/1/persons/3/thumb.jpg', moments: [] };
        const src = thumbSrc(face, 'abc');
        expect(src).toContain('/api/vision/analyses/1/persons/3/thumb.jpg');
        expect(src).toContain('token=abc');
        expect(thumbSrc({ ...face, thumb_url: '' }, 'abc')).toBe('');
    });
});

describe('contentRect', () => {
    it('letterboxes a wide video in a tall box', () => {
        expect(contentRect({ width: 400, height: 400 }, { width: 1600, height: 900 }))
            .toEqual({ left: 0, top: 87.5, width: 400, height: 225 });
    });
    it('pillarboxes a tall video', () => {
        expect(contentRect({ width: 1000, height: 500 }, { width: 720, height: 1280 }).left).toBeCloseTo(359.375);
    });
    it('falls back to the whole box before metadata', () => {
        expect(contentRect({ width: 300, height: 200 }, { width: 0, height: 0 }))
            .toEqual({ left: 0, top: 0, width: 300, height: 200 });
    });
});
