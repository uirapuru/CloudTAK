import type Config from '../../../common/config.js';
import ProfileOverlayControl from '../../../common/control/profile-overlay.js';

/** Jak długo logowanie czeka na zapis do misji wspólnej, zanim odpowie */
export const SHARED_MISSION_LOGIN_WAIT_MS = 3000;

/**
 * taklab: zapis użytkownika na misję wspólną przy logowaniu
 *
 * Nigdy nie rzuca - błąd (np. brak certyfikatu w tej chwili) trafia do console.warn,
 * a ponowienie następuje przy kolejnym logowaniu. Logowanie czeka najwyżej `wait` ms,
 * żeby klient po zalogowaniu od razu dostał nakładkę misji; dłuższy zapis kończy się w tle.
 */
export async function subscribeSharedMission(
    config: Config,
    username: string,
    wait = SHARED_MISSION_LOGIN_WAIT_MS,
): Promise<void> {
    const work = new ProfileOverlayControl(config).ensureSharedMission(username).catch((err) => {
        console.warn(`Warning: Shared mission subscription failed for ${username} - retrying on next login:`, err instanceof Error ? err.message : err);
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, wait);
    });

    await Promise.race([work, timeout]);
    clearTimeout(timer);
}
