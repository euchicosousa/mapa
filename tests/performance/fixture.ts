// Fixed breadth-first topology, six children/parent, Unicode and variable text heights.
// Portable UUIDs are deterministic; the server remaps IDs and owns authorship.
export function performanceBackup(count: 200 | 500) {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  return {
    format: 'mapa-mental', version: 1, exportedAt: '2026-10-20T12:00:00.000Z', hasPendingChanges: false,
    map: { title: `Desempenho ${count}` },
    nodes: Array.from({ length: count }, (_, i) => ({
      id: id(i), parentId: i ? id(Math.floor((i - 1) / 6)) : null,
      sortOrder: i ? (i - 1) % 6 : 0,
      text: `Nó ${i}: Ação 🌎\n` + 'Ideias para organizar o trabalho. '.repeat(i % 9 + 1),
    })),
  };
}
