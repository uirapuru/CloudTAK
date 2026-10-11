/**
 * Polskie nazwy kategorii miejsc -> znaczniki OSM, ktorymi Photon filtruje
 * wyniki (osm_tag=klucz:wartosc). Photon szuka po nazwie obiektu, wiec
 * "stacja benzynowa bielany" bez tego rozbioru zwraca obiekty NAZWANE
 * "Stacja benzynowa" z drugiego konca kraju.
 *
 * Rdzenie sa bez polskich znakow i maloliterowe. Rdzen krotszy niz 4 znaki
 * musi pasowac do calego slowa (inaczej "sor" lapalby "sortownie").
 */
export type CategoryMatch = {
    label: string;
    tags: string[];
    place: string;
};

type Category = {
    label: string;
    tags: string[];
    stems: string[][];
};

export const CATEGORIES: Category[] = [
    { label: 'Stacja paliw', tags: ['amenity:fuel'], stems: [['stacj', 'benzyn'], ['stacj', 'paliw'], ['cpn'], ['paliw'], ['tankowani']] },
    { label: 'Stacja ładowania', tags: ['amenity:charging_station'], stems: [['stacj', 'ladowan'], ['ladowark']] },
    { label: 'Szpital', tags: ['amenity:hospital'], stems: [['szpital'], ['sor']] },
    { label: 'Przychodnia', tags: ['amenity:clinic', 'amenity:doctors'], stems: [['przychodni'], ['osrod', 'zdrowi'], ['lekarz']] },
    { label: 'Apteka', tags: ['amenity:pharmacy'], stems: [['aptek']] },
    { label: 'Weterynarz', tags: ['amenity:veterinary'], stems: [['weterynarz']] },
    { label: 'Policja', tags: ['amenity:police'], stems: [['komisariat'], ['policj'], ['posterun']] },
    { label: 'Straż pożarna', tags: ['amenity:fire_station'], stems: [['straz', 'pozarn'], ['remiz'], ['psp'], ['osp']] },
    { label: 'Urząd', tags: ['amenity:townhall'], stems: [['urzad', 'gmin'], ['urzad', 'miast'], ['starostw'], ['ratusz']] },
    { label: 'Poczta', tags: ['amenity:post_office'], stems: [['poczt']] },
    { label: 'Bankomat', tags: ['amenity:atm'], stems: [['bankomat']] },
    { label: 'Bank', tags: ['amenity:bank'], stems: [['bank']] },
    { label: 'Szkoła', tags: ['amenity:school'], stems: [['szkol']] },
    { label: 'Parking', tags: ['amenity:parking'], stems: [['parking']] },
    { label: 'Sklep', tags: ['shop:supermarket', 'shop:convenience'], stems: [['sklep'], ['market'], ['supermarket']] },
    { label: 'Warsztat', tags: ['shop:car_repair', 'shop:tyres'], stems: [['warsztat'], ['mechanik'], ['wulkaniz']] },
    { label: 'Restauracja', tags: ['amenity:restaurant', 'amenity:fast_food'], stems: [['restaurac'], ['jedzeni']] },
    { label: 'Kawiarnia', tags: ['amenity:cafe'], stems: [['kawiarni']] },
    { label: 'Nocleg', tags: ['tourism:hotel', 'tourism:motel', 'tourism:guest_house', 'tourism:hostel'], stems: [['hotel'], ['motel'], ['nocleg'], ['hostel']] },
    { label: 'Schronienie', tags: ['amenity:shelter', 'tourism:alpine_hut', 'tourism:wilderness_hut'], stems: [['wiat'], ['schron']] },
    { label: 'Woda pitna', tags: ['amenity:drinking_water', 'natural:spring'], stems: [['woda', 'pitn'], ['zrodl']] },
    { label: 'Toaleta', tags: ['amenity:toilets'], stems: [['toalet'], ['wc']] },
    { label: 'Dworzec kolejowy', tags: ['railway:station', 'railway:halt'], stems: [['dworz'], ['dworc'], ['stacj', 'kolej'], ['pkp']] },
    { label: 'Przystanek', tags: ['highway:bus_stop', 'public_transport:platform'], stems: [['przystan']] },
    { label: 'Lotnisko', tags: ['aeroway:aerodrome', 'aeroway:helipad'], stems: [['lotnisk'], ['ladowisk']] },
    { label: 'Kościół', tags: ['amenity:place_of_worship'], stems: [['kosciol'], ['cerkiew'], ['cerkw']] },
    { label: 'Cmentarz', tags: ['landuse:cemetery', 'amenity:grave_yard'], stems: [['cmentarz']] },
    { label: 'Teren wojskowy', tags: ['landuse:military', 'military:barracks'], stems: [['jednostk', 'wojsk'], ['koszar']] },
];

export function fold(text: string): string {
    return text
        .toLowerCase()
        .replace(/ł/g, 'l')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

function stemMatches(token: string, stem: string): boolean {
    return stem.length < 4 ? token === stem : token.startsWith(stem);
}

export function parseCategory(query: string): CategoryMatch | null {
    const original = query.trim().split(/\s+/).filter(Boolean);
    const folded = original.map(fold);

    let best: { category: Category; start: number; length: number } | null = null;

    for (const category of CATEGORIES) {
        for (const stems of category.stems) {
            for (let start = 0; start + stems.length <= folded.length; start++) {
                const hit = stems.every((stem, i) => stemMatches(folded[start + i], stem));
                if (!hit) continue;
                if (!best || stems.length > best.length) {
                    best = { category, start, length: stems.length };
                }
            }
        }
    }

    if (!best) return null;
    const found = best;

    const place = original
        .filter((_, i) => i < found.start || i >= found.start + found.length)
        .filter(token => !['najblizsza', 'najblizszy', 'najblizsze', 'w', 'na', 'przy', 'kolo', 'obok'].includes(fold(token)))
        .join(' ');

    return { label: found.category.label, tags: found.category.tags, place };
}
