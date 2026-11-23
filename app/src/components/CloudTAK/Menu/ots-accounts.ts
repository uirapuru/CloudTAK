// taklab: helpers of the "Konta serwera" menu (OTS accounts with QR codes).

export type OtsAccount = {
    username: string;
    roles: string[];
    active: boolean;
};

export type OtsAccountsStatus = {
    enabled: boolean;
    administrator: boolean;
    atak: boolean;
    icu: boolean;
    reason?: string;
};

export type OtsQrType = 'atak' | 'icu';

export type OtsQr = {
    type: OtsQrType;
    uri: string;
    svg: string;
};

export function filterAccounts(items: OtsAccount[], filter: string): OtsAccount[] {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((a) => a.username.toLowerCase().includes(needle));
}

export function qrButtonState(status: OtsAccountsStatus, type: OtsQrType): { disabled: boolean; title: string } {
    if (type === 'atak') {
        return status.atak
            ? { disabled: false, title: 'Kod QR dla ATAK' }
            : { disabled: true, title: 'Kod ATAK wymaga dostępu po nazwie serwera' };
    }
    return status.icu
        ? { disabled: false, title: 'Kod QR dla OpenTAK ICU' }
        : { disabled: true, title: 'Środowisko nie ma wideo' };
}
