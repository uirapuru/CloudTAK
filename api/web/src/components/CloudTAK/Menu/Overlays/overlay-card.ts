import type Overlay from '../../../../base/overlay-class.ts';

export type OverlayBadge = { label: string; variant: string };
export type OverlayStatus = { label: string; variant: string; tooltip?: string };
export type OverlayUpdate = Parameters<Overlay['update']>[0];

/** One row of the Overlays menu */
export type OverlayCard = {
    overlay: Overlay;
    visible: boolean;
    groupId: number | null;
    status: OverlayStatus;
    badges: OverlayBadge[];
    offline: boolean;
};
