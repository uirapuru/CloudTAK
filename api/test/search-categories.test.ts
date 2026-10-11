import test from 'node:test';
import assert from 'node:assert';
import { parseCategory } from '../stateless/lib/search/categories.js';

test('parseCategory: kategoria na początku, miejsce na końcu', () => {
    assert.deepEqual(parseCategory('stacja benzynowa bielany'), {
        label: 'Stacja paliw', tags: ['amenity:fuel'], place: 'bielany',
    });
});

test('parseCategory: odmiana i brak polskich znaków', () => {
    assert.equal(parseCategory('stacji benzynowej Bielany')?.place, 'Bielany');
    assert.equal(parseCategory('najblizsza apteka')?.tags[0], 'amenity:pharmacy');
});

test('parseCategory: kategoria na końcu zapytania', () => {
    assert.deepEqual(parseCategory('Wołomin szpital'), {
        label: 'Szpital', tags: ['amenity:hospital'], place: 'Wołomin',
    });
});

test('parseCategory: sama kategoria daje puste miejsce', () => {
    assert.equal(parseCategory('apteka')?.place, '');
});

test('parseCategory: krótki rdzeń pasuje tylko w całości', () => {
    assert.equal(parseCategory('sortownia'), null);
    assert.equal(parseCategory('SOR Grochów')?.tags[0], 'amenity:hospital');
});

test('parseCategory: zapytanie bez kategorii', () => {
    assert.equal(parseCategory('Marymoncka 34 Warszawa'), null);
    assert.equal(parseCategory(''), null);
});

test('parseCategory: dłuższe dopasowanie wygrywa', () => {
    // "stacja ładowania" to nie "stacja kolejowa" ani "stacja paliw"
    assert.equal(parseCategory('stacja ładowania Wrocław')?.tags[0], 'amenity:charging_station');
});
