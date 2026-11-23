import { describe, it, expect } from 'vitest';
import { filterAccounts, qrButtonState, type OtsAccount, type OtsAccountsStatus } from './ots-accounts.ts';

const accounts: OtsAccount[] = [
    { username: 'administrator', roles: ['administrator'], active: true },
    { username: 'jan', roles: ['user'], active: true },
    { username: 'jan.k', roles: ['user'], active: false },
];

const status = (atak: boolean, icu: boolean): OtsAccountsStatus => ({ enabled: true, administrator: true, atak, icu });

describe('ots accounts helpers', () => {
    it('filters by username without case', () => {
        expect(filterAccounts(accounts, 'JAN').map((a) => a.username)).toEqual(['jan', 'jan.k']);
        expect(filterAccounts(accounts, '')).toEqual(accounts);
        expect(filterAccounts(accounts, '  ')).toEqual(accounts);
    });

    it('disables unavailable codes with a reason', () => {
        expect(qrButtonState(status(false, true), 'atak')).toEqual({ disabled: true, title: 'Kod ATAK wymaga dostępu po nazwie serwera' });
        expect(qrButtonState(status(true, false), 'icu')).toEqual({ disabled: true, title: 'Środowisko nie ma wideo' });
    });

    it('enables available codes', () => {
        expect(qrButtonState(status(true, true), 'atak')).toEqual({ disabled: false, title: 'Kod QR dla ATAK' });
        expect(qrButtonState(status(true, true), 'icu')).toEqual({ disabled: false, title: 'Kod QR dla OpenTAK ICU' });
    });
});
