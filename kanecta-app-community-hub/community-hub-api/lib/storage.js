// Derives a storage key from a file UUID.
// Format: {hex[0:2]}/{hex[2:4]}/{hex} — e.g. 3c/54/3c54b788d2684bec842fb4d91f393822
// Original filename is stored as Spaces object metadata ("original-name"), not in the path.
export function uuidToStorageKey(uuid) {
  const hex = uuid.replace(/-/g, "");
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}
