// Status-Konstanten
export const REAL_ESTATE_STATUS = {
  available: 'available',
  reserved: 'reserved',
  sold: 'sold',
  unavailable: 'unavailable'
};

export const REAL_ESTATE_STATUS_LABELS = {
  [REAL_ESTATE_STATUS.available]: 'Verfuegbar',
  [REAL_ESTATE_STATUS.reserved]: 'Reserviert',
  [REAL_ESTATE_STATUS.sold]: 'Verkauft',
  [REAL_ESTATE_STATUS.unavailable]: 'Nicht verfuegbar'
};

export const REAL_ESTATE_STATUS_DOTS = {
  [REAL_ESTATE_STATUS.available]: '🟢',
  [REAL_ESTATE_STATUS.reserved]: '🟠',
  [REAL_ESTATE_STATUS.sold]: '🔴',
  [REAL_ESTATE_STATUS.unavailable]: '⚫'
};

export function parseRealEstateUserIds(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch (error) {
    return [];
  }
}

// Fest codierte Immobilienliste mit Preisen
export const REAL_ESTATE_LIST = [
  { id: 1, name: 'Haus 1', preis: '110.000 €' },
  { id: 2, name: 'Haus 2', preis: '105.000 €' },
  { id: 3, name: 'Haus 3', preis: '115.000 €' },
  { id: 4, name: 'Haus 4', preis: '120.000 €' },
  { id: 5, name: 'Haus 5', preis: '125.000 €' },
  { id: 6, name: 'Haus 6', preis: '130.000 €' },
  { id: 7, name: 'Haus 7', preis: '135.000 €' },
  { id: 8, name: 'Haus 8', preis: '140.000 €' },
  { id: 9, name: 'Haus 9', preis: '145.000 €' },
  { id: 10, name: 'Haus 10', preis: '150.000 €' },
  { id: 11, name: 'Haus 11', preis: '155.000 €' },
  { id: 12, name: 'Haus 12', preis: '165.000 €' },
  { id: 13, name: 'Haus 13', preis: '160.000 €' },
  { id: 14, name: 'Haus 14', preis: '170.000 €' },
  { id: 15, name: 'Haus 15', preis: '175.000 €' },
  { id: 16, name: 'Haus 16', preis: '180.000 €' },
  { id: 17, name: 'Haus 17', preis: '185.000 €' },
  { id: 18, name: 'Haus 18', preis: '190.000 €' },
  { id: 19, name: 'Haus 19', preis: '195.000 €' },
  { id: 20, name: 'Haus 20', preis: '200.000 €' },
  { id: 21, name: 'Haus 21', preis: '205.000 €' },
  { id: 22, name: 'Haus 22', preis: '210.000 €' },
  { id: 23, name: 'Haus 23', preis: '215.000 €' },
  { id: 24, name: 'Haus 24', preis: '220.000 €' },
  { id: 25, name: 'Haus 25', preis: '225.000 €' },
  { id: 26, name: 'Haus 26', preis: '230.000 €' },
  { id: 27, name: 'Haus 27', preis: '235.000 €' },
  { id: 28, name: 'Haus 28', preis: '240.000 €' },
  { id: 29, name: 'Haus 29', preis: '245.000 €' },
  { id: 30, name: 'Haus 30', preis: '250.000 €' },
  { id: 31, name: 'Haus 31', preis: '260.000 €' },
  { id: 32, name: 'Haus 32', preis: '270.000 €' },
  { id: 33, name: 'Haus 33', preis: '280.000 €' },
  { id: 34, name: 'Haus 34', preis: '300.000 €' },
  { id: 35, name: 'Haus 35', preis: '320.000 €' },
  { id: 36, name: 'Haus 36', preis: '350.000 €' },
  { id: 37, name: 'Haus 37', preis: '360.000 €' },
  { id: 38, name: 'Haus 38', preis: '330.000 €' },
  { id: 39, name: 'Haus 39', preis: '340.000 €' },
  { id: '41A', name: 'Haus 41A', preis: '400.000 €' },
  { id: '41B', name: 'Haus 41B', preis: '380.000 €' },
  { id: 42, name: 'Haus 42', preis: '370.000 €' },
  { id: 44, name: 'Haus 44', preis: '350.000 €' },
  { id: 45, name: 'Haus 45', preis: '300.000 €' },
  { id: 46, name: 'Haus 46', preis: '330.000 €' },
  { id: 47, name: 'Haus 47', preis: '280.000 €' }
];

// Kanal-ID wo die Liste gepostet wird
export const REAL_ESTATE_CHANNEL_ID = '1535408763966595172';

// DEFAULT_REAL_ESTATES für kompatibilität mit panels.js
export const DEFAULT_REAL_ESTATES = REAL_ESTATE_LIST;

function renderRealEstateLine(house) {
  const status = house.status ?? REAL_ESTATE_STATUS.available;
  const dot = REAL_ESTATE_STATUS_DOTS[status] ?? '▪️';
  const statusLabel = REAL_ESTATE_STATUS_LABELS[status] ?? 'Unbekannt';
  const owners = Array.isArray(house.user_ids)
    ? house.user_ids.map(String).filter(Boolean)
    : parseRealEstateUserIds(house.user_ids);
  const ownerLine = owners.length ? ` — <@${owners.join('>, <@')}>` : '';
  return `**${house.name}:** ${house.preis}\n${dot} ${statusLabel}${ownerLine}`;
}

// Stellt sicher, dass die Häuser immer in der fest definierten Reihenfolge erscheinen,
// auch wenn die Datenbank-Abfrage sie anders sortiert (z. B. 41A/41B).
function orderRowsByCanonicalList(rows) {
  const order = new Map(REAL_ESTATE_LIST.map((house, index) => [String(house.id), index]));
  return [...rows].sort((a, b) => {
    const ai = order.get(String(a.property_id ?? a.id)) ?? 999;
    const bi = order.get(String(b.property_id ?? b.id)) ?? 999;
    return ai - bi;
  });
}

function chunkRealEstateRows(rows, size = 12) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

// Funktion um die Liste als Discord Embed(s) zu formatieren (im alten Design)
export function buildRealEstateEmbed(rows = null) {
  const source = Array.isArray(rows) && rows.length
    ? orderRowsByCanonicalList(rows).map((row) => ({
        id: row.property_id ?? row.id,
        name: row.label ?? row.name,
        preis: row.price_label ?? row.preis,
        status: row.status ?? REAL_ESTATE_STATUS.available,
        user_ids: Array.isArray(row.user_ids)
          ? row.user_ids.map(String)
          : parseRealEstateUserIds(row.user_ids)
      }))
    : REAL_ESTATE_LIST.map((house) => ({ ...house, status: REAL_ESTATE_STATUS.available, user_ids: [] }));

  const chunks = chunkRealEstateRows(source, 12);
  const total = source.length;

  const countByStatus = source.reduce((acc, house) => {
    acc[house.status] = (acc[house.status] ?? 0) + 1;
    return acc;
  }, {});

  const free = countByStatus[REAL_ESTATE_STATUS.available] ?? 0;
  const reserved = countByStatus[REAL_ESTATE_STATUS.reserved] ?? 0;
  const sold = countByStatus[REAL_ESTATE_STATUS.sold] ?? 0;
  const unavailable = countByStatus[REAL_ESTATE_STATUS.unavailable] ?? 0;

  return {
    embeds: chunks.map((chunk, index) => {
      const firstId = chunk[0]?.id ?? 1;
      const lastId = chunk[chunk.length - 1]?.id ?? firstId;

      return {
        color: 0x2ecc71,
        title: index === 0 ? 'Immobilienliste | München RP' : `Immobilienliste | Häuser ${firstId}-${lastId}`,
        description: [
          index === 0 ? 'Hier findest du alle Immobilien, Preise und den aktuellen Status der Häuser.' : null,
          index === 0 ? '🟢 Verfügbar · 🟠 Reserviert · 🔴 Verkauft · ⚫ Nicht verfügbar' : null,
          `**Häuser ${firstId}-${lastId}**`,
          chunk.map(renderRealEstateLine).join('\n\n')
        ].filter(Boolean).join('\n\n'),
        footer: {
          text: index === 0
            ? `Immobilienliste | ${total} Häuser · ${free} frei · ${reserved} reserviert · ${sold} verkauft · ${unavailable} nicht verfügbar`
            : 'Immobilienliste | Automatische Aktualisierung aktiv'
        },
        timestamp: new Date().toISOString()
      };
    })
  };
}