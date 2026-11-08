import { describe, expect, it } from 'vitest';
import { markerVideoLink, youtubeEmbedUrl, youtubeId } from './video-link.ts';

describe('youtubeId', () => {
    it('reads shorts, watch, youtu.be and embed links', () => {
        expect(youtubeId('https://youtube.com/shorts/XbpVlQ1uuw8')).toBe('XbpVlQ1uuw8');
        expect(youtubeId('https://www.youtube.com/watch?v=WEwMAI2lshA&t=3')).toBe('WEwMAI2lshA');
        expect(youtubeId('https://www.youtube.com/watch?feature=share&v=WEwMAI2lshA')).toBe('WEwMAI2lshA');
        expect(youtubeId('https://youtu.be/WEwMAI2lshA')).toBe('WEwMAI2lshA');
        expect(youtubeId('https://www.youtube.com/embed/WEwMAI2lshA')).toBe('WEwMAI2lshA');
    });

    it('finds the link inside free text', () => {
        expect(youtubeId('Kamera K01. Film: https://youtube.com/shorts/GouwjrKSf9A (niepubliczny)')).toBe('GouwjrKSf9A');
    });

    it('ignores other hosts and look-alike domains', () => {
        expect(youtubeId('https://vimeo.com/123456789')).toBeNull();
        expect(youtubeId('https://notyoutube.com/shorts/XbpVlQ1uuw8')).toBeNull();
        expect(youtubeId('https://youtube.com.evil.example/shorts/XbpVlQ1uuw8')).toBeNull();
        expect(youtubeId('no link here')).toBeNull();
    });
});

describe('markerVideoLink', () => {
    it('prefers a link element over remarks', () => {
        expect(markerVideoLink({
            links: [{ url: 'https://example.com' }, { url: 'https://youtu.be/AAAAAAAAAAA' }],
            remarks: 'https://youtu.be/BBBBBBBBBBB',
        })).toBe(youtubeEmbedUrl('AAAAAAAAAAA'));
    });

    it('falls back to remarks', () => {
        expect(markerVideoLink({ remarks: 'Wideo: https://youtube.com/shorts/XbpVlQ1uuw8' }))
            .toBe('https://www.youtube-nocookie.com/embed/XbpVlQ1uuw8?autoplay=1&playsinline=1&rel=0');
    });

    it('returns null without a video link or with odd shapes', () => {
        expect(markerVideoLink({})).toBeNull();
        expect(markerVideoLink({ remarks: 42, links: 'x' })).toBeNull();
        expect(markerVideoLink({ links: [null, { url: 7 }] })).toBeNull();
    });
});
