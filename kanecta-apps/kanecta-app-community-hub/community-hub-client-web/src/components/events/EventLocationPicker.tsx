import { useState, useEffect, useRef, useCallback } from "react";
import {
  TextField, List, ListItemButton, ListItemText,
  Typography, CircularProgress, Paper, IconButton, Box,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default icon paths break with bundlers — fix them here
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).href,
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).href,
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).href,
});

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export interface LocationValue {
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  value: LocationValue | null;
  onChange: (loc: LocationValue | null) => void;
  disabled?: boolean;
}

// Keeps the map centred when the pin moves
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], map.getZoom()); }, [lat, lng, map]);
  return null;
}

// Handles clicking on the map to move the pin
function ClickHandler({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMove(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function EventLocationPicker({ value, onChange, disabled = false }: Props) {
  const [query, setQuery] = useState(value?.address ?? "");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local query in sync if parent clears the value
  useEffect(() => {
    if (!value) setQuery("");
  }, [value]);

  const search = useCallback((q: string) => {
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=nz`,
      { headers: { "Accept-Language": "en-NZ" } }
    )
      .then((r) => r.json())
      .then((data: NominatimResult[]) => setResults(data))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, []);

  function handleQueryChange(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 400);
    // If user edits after a pin is set, keep the pin but update the address label
    if (value) onChange({ ...value, address: q });
  }

  function handleSelect(result: NominatimResult) {
    const loc: LocationValue = {
      address: result.display_name,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    };
    setQuery(result.display_name);
    setResults([]);
    onChange(loc);
  }

  function handlePinMove(lat: number, lng: number) {
    onChange({ address: value?.address ?? query, lat, lng });
  }

  function handleClear() {
    setQuery("");
    setResults([]);
    onChange(null);
  }

  return (
    <Box className="event-location-picker">
      <Box sx={{ position: "relative" }}>
        <TextField
          label="Venue / address (optional)"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          fullWidth
          disabled={disabled}
          placeholder="Start typing an address…"
          slotProps={{
            input: {
              endAdornment: searching
                ? <CircularProgress size={16} sx={{ mr: 1 }} />
                : value
                  ? <IconButton size="small" onClick={handleClear}><ClearIcon fontSize="small" /></IconButton>
                  : null,
            },
          }}
        />

        {results.length > 0 && (
          <Paper elevation={3} sx={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, maxHeight: 240, overflowY: "auto" }}>
            <List dense disablePadding>
              {results.map((r) => (
                <ListItemButton key={r.place_id} onClick={() => handleSelect(r)}>
                  <ListItemText
                    primary={r.display_name.split(",")[0]}
                    secondary={r.display_name.split(",").slice(1).join(",").trim()}
                    slotProps={{ secondary: { noWrap: true } }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        )}
      </Box>

      {value && (
        <Box className="event-location-picker__map">
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Drag the pin or click the map to fine-tune the location
          </Typography>
          <MapContainer
            center={[value.lat, value.lng]}
            zoom={15}
            style={{ height: 240, borderRadius: 6, border: "1px solid var(--border)" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapRecenter lat={value.lat} lng={value.lng} />
            <ClickHandler onMove={handlePinMove} />
            <Marker
              position={[value.lat, value.lng]}
              draggable
              eventHandlers={{ dragend: (e) => { const { lat, lng } = (e.target as L.Marker).getLatLng(); handlePinMove(lat, lng); } }}
            />
          </MapContainer>
        </Box>
      )}
    </Box>
  );
}
