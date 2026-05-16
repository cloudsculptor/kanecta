// Derives a storage key from a file UUID.
// Format: {uuid[0:2]}/{uuid[2:4]}/{uuid} — e.g. 3c/54/3c54b788-d268-4bec-842f-b4d91f393822
// Original filename is stored as Spaces object metadata ("original-name"), not in the path.
export function uuidToStorageKey(uuid) {
  return `${uuid.slice(0, 2)}/${uuid.slice(2, 4)}/${uuid}`;
}
