/*
* Video links on markers: a YouTube link in the marker remarks or links
* turns into an embeddable player URL, so the radial menu can offer "play"
* for points that carry no <__video> stream.
*/

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_URL = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:shorts\/|watch\?[^\s"'<>]*?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export type VideoLinkSource = {
    remarks?: unknown,
    links?: unknown,
};

/** YouTube video ID from a single URL or free text, null when there is none. */
export function youtubeId(text: string): string | null {
    const match = text.match(YOUTUBE_URL);
    if (!match || !YOUTUBE_ID.test(match[1])) return null;
    return match[1];
}

/** Embed URL that starts playing on open; youtube-nocookie keeps tracking cookies off. */
export function youtubeEmbedUrl(id: string): string {
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
}

/** First YouTube link of a marker: link elements first, then remarks text. */
export function markerVideoLink(properties: VideoLinkSource): string | null {
    if (Array.isArray(properties.links)) {
        for (const link of properties.links) {
            const url = link && typeof link === 'object' ? (link as { url?: unknown }).url : undefined;
            if (typeof url !== 'string') continue;
            const id = youtubeId(url);
            if (id) return youtubeEmbedUrl(id);
        }
    }

    if (typeof properties.remarks === 'string') {
        const id = youtubeId(properties.remarks);
        if (id) return youtubeEmbedUrl(id);
    }

    return null;
}
