import type ConfigStateless from '../../config.js';
import ProfileOverlayControl from '../../../common/control/profile-overlay.js';
import ConnectionEvents, { ConnectionEventDataType, ConnectionEventAction } from '../connection-events.js';

/** Jak długo logowanie i ładowanie mapy czekają na zapis do misji wspólnej, zanim odpowiedzą */
export const SHARED_MISSION_WAIT_MS = 3000;

/** Odstępy ponowień po 400 „Invalid UID” (OTS nie zna jeszcze urządzenia CloudTAK); testy je skracają */
export const SHARED_MISSION_RETRY_MS = [10_000, 30_000, 90_000];

/** Użytkownicy z zaplanowanym ponowieniem i jego zegar - najwyżej jedna seria na użytkownika */
const retries = new Map<string, NodeJS.Timeout>();

/** OTS odrzuca subskrypcję urządzenia, którego jeszcze nie widział w połączeniu */
export function isInvalidUid(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const status = (err as { status?: number }).status;
    return status === 400 && /invalid uid/i.test(String((err as { message?: string }).message));
}

/**
 * Seria ponowień w procesie: `attempt` po każdym odstępie z `delays`, dopóki rzuca błąd
 * „Invalid UID”. Inny błąd, sukces albo koniec odstępów kończy serię. Drugie wywołanie
 * dla tego samego użytkownika w trakcie serii nic nie robi.
 */
export function scheduleSharedMissionRetries(
    username: string,
    attempt: () => Promise<void>,
    delays: Array<number> = SHARED_MISSION_RETRY_MS,
): boolean {
    if (retries.has(username)) return false;

    const step = (i: number): void => {
        if (i >= delays.length) {
            retries.delete(username);
            console.warn(`Warning: Shared mission subscription for ${username} still failing after ${delays.length} retries - next login retries`);
            return;
        }

        const timer = setTimeout(async () => {
            try {
                await attempt();
                retries.delete(username);
            } catch (err) {
                if (isInvalidUid(err)) {
                    step(i + 1);
                } else {
                    retries.delete(username);
                    console.warn(`Warning: Shared mission retry failed for ${username}:`, err instanceof Error ? err.message : err);
                }
            }
        }, delays[i]);

        // Zegar nie trzyma procesu przy życiu
        timer.unref();
        retries.set(username, timer);
    };

    step(0);
    return true;
}

/** Testy: czy użytkownik ma zaplanowane ponowienie */
export function hasSharedMissionRetry(username: string): boolean {
    return retries.has(username);
}

/** Testy i zamknięcie: anuluje wszystkie zaplanowane ponowienia */
export function cancelSharedMissionRetries(): void {
    for (const timer of retries.values()) clearTimeout(timer);
    retries.clear();
}

/** Zapis na misję wspólną; nowa nakładka trafia do otwartych klientów jak każda zmiana nakładek */
async function ensureAndNotify(config: ConfigStateless, username: string, exclude: () => string | undefined = () => undefined): Promise<void> {
    const overlay = await new ProfileOverlayControl(config).ensureSharedMission(username);

    if (overlay) {
        ConnectionEvents.broadcast(config, username, ConnectionEvents.event(
            ConnectionEventDataType.OVERLAY,
            ConnectionEventAction.CREATE,
            overlay.id,
        ), { exclude: exclude() });
    }
}

/**
 * taklab: zapis użytkownika na misję wspólną przy logowaniu i ładowaniu mapy
 *
 * Nigdy nie rzuca - błąd trafia do console.warn. Po 400 „Invalid UID” (pierwsza sesja,
 * urządzenie jeszcze niepołączone) planuje ponowienia w procesie, poza tym ponowienie
 * następuje przy kolejnym logowaniu albo ładowaniu mapy. Żądanie czeka najwyżej `wait` ms,
 * dłuższy zapis kończy się w tle.
 *
 * @param opts.exclude - sesja, która sama dostanie nakładkę w odpowiedzi (bez zdarzenia)
 */
export async function subscribeSharedMission(
    config: ConfigStateless,
    username: string,
    opts: { wait?: number; exclude?: string } = {},
): Promise<void> {
    // Sesja żądania dostaje nakładkę w odpowiedzi tylko wtedy, gdy zapis zdążył przed nią
    let waiting = true;

    const work = ensureAndNotify(config, username, () => waiting ? opts.exclude : undefined).catch((err) => {
        console.warn(`Warning: Shared mission subscription failed for ${username}:`, err instanceof Error ? err.message : err);

        if (isInvalidUid(err)) {
            scheduleSharedMissionRetries(username, () => ensureAndNotify(config, username));
        }
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, opts.wait ?? SHARED_MISSION_WAIT_MS);
    });

    await Promise.race([work, timeout]);
    waiting = false;
    clearTimeout(timer);
}
